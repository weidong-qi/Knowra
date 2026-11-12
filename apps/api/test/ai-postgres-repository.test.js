import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createPostgresAiRepository } from '../src/modules/ai/postgres-record-repository.ts';
import { createPostgresAiAccessStore } from '../src/modules/ai/postgres-access-store.ts';
import { hashRecord } from '../src/modules/ai/record-contract.ts';
import { createPostgresBudgetAuthority } from '../src/modules/ai/postgres-budget-authority.ts';
import { createAiWorker } from '../src/modules/ai/worker.ts';
import { aiRecords } from './ai-record-fixtures.js';

export const aiPostgresRepositoryTests = process.env.KNOWRA_SYNC_TEST_DATABASE_URL
  ? [
      {
        name: 'AI PostgreSQL repository 在隔离库验证迁移、并发幂等、用量与 epoch 失效',
        async run() {
          const db = new PrismaClient({
            datasources: { db: { url: process.env.KNOWRA_SYNC_TEST_DATABASE_URL } },
            log: []
          });
          try {
            await db.$connect();
            const ownerId = `ai-test-${randomUUID()}`;
            const first = createPostgresAiRepository({ client: db, ownerId });
            const second = createPostgresAiRepository({ client: db, ownerId });
            const records = aiRecords(await first.identity(), randomUUID(), ownerId);
            await first.insert('scopeSnapshot', records.scope);
            assert.deepEqual(await first.identity(), await second.identity());
            assert.equal(
              (await first.get('scopeSnapshot', records.scope.scopeSnapshotId)).scopeHash,
              records.scope.scopeHash
            );
            const anotherOwner = createPostgresAiRepository({ client: db, ownerId: `other-${randomUUID()}` });
            assert.equal(await anotherOwner.get('scopeSnapshot', records.scope.scopeSnapshotId), null);
            assert.deepEqual(await anotherOwner.list('scopeSnapshot'), []);
            await first.insert('contextManifest', records.manifest);
            await first.insert('aiGrant', records.grant);
            const [left, right] = await Promise.all([
              first.insert('aiJob', records.job),
              second.insert('aiJob', records.job)
            ]);
            assert.equal(left.jobId, right.jobId);
            assert.equal((await first.list('aiJob', { ownerId })).length, 1);
            await assert.rejects(
              first.insert('aiJob', {
                ...records.job,
                jobId: `other-${randomUUID()}`,
                requestId: `other-${randomUUID()}`,
                inputHash: '0'.repeat(64)
              }),
              { code: 'AI_IDEMPOTENCY_CONFLICT' }
            );
            await first.insert('aiJobAttempt', records.attempt);
            await first.insert('aiUsageRecord', records.usage);
            await first.appendEvent(records.event);
            assert.equal((await second.get('aiUsageRecord', records.usage.usageId)).usageUnknown, true);
            assert.equal((await second.listEvents(records.job.jobId)).length, 1);
            const oldEpoch = (await first.identity()).datasetEpoch;
            await first.rotateEpoch();
            assert.notEqual((await second.identity()).datasetEpoch, oldEpoch);
            await assert.rejects(
              first.insert('aiJobAttempt', {
                ...records.attempt,
                attemptId: `late-${randomUUID()}`,
                ordinal: 2,
                leaseGeneration: 2
              }),
              { code: 'AI_REFERENCE_INVALID' }
            );
          } finally {
            await db.$disconnect();
          }
        }
      },
      {
        name: 'AI PostgreSQL v2 策略并发收窄采用 CAS，旧运行授权不能跨 epoch 复用',
        async run() {
          const db = new PrismaClient({
            datasources: { db: { url: process.env.KNOWRA_SYNC_TEST_DATABASE_URL } },
            log: []
          });
          try {
            await db.$connect();
            const ownerId = `access-test-${randomUUID()}`;
            const repository = createPostgresAiRepository({ client: db, ownerId });
            const first = createPostgresAiAccessStore({ client: db, repository, ownerId });
            const second = createPostgresAiAccessStore({ client: db, repository, ownerId });
            const identity = await repository.identity();
            const policy = {
              contractVersion: 2,
              kind: 'aiAccessPolicy',
              policyId: randomUUID(),
              revision: 1,
              actorId: ownerId,
              ownerId,
              ...identity,
              spaceId: randomUUID(),
              scope: { kind: 'library' },
              excludedNoteIds: [],
              includeAttachments: false,
              read: true,
              egress: true,
              recipients: ['deepseek'],
              issuedAt: '2026-09-27T00:00:00.000Z',
              expiresAt: '2026-09-28T00:00:00.000Z',
              revokedAt: null
            };
            await first.insert('aiAccessPolicy', policy);
            assert.equal((await second.get('aiAccessPolicy', policy.policyId)).revision, 1);
            const changed = { ...policy, revision: 2, excludedNoteIds: ['excluded-note'] };
            const results = await Promise.allSettled([
              first.replacePolicy(changed, hashRecord(policy)),
              second.replacePolicy(changed, hashRecord(policy))
            ]);
            assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
            assert.equal(results.find(result => result.status === 'rejected').reason.code, 'AI_RECORD_CONFLICT');
            const otherOwnerId = `other-${randomUUID()}`;
            const anotherOwner = createPostgresAiAccessStore({
              client: db,
              repository: createPostgresAiRepository({ client: db, ownerId: otherOwnerId }),
              ownerId: otherOwnerId
            });
            assert.equal(await anotherOwner.get('aiAccessPolicy', policy.policyId), null);
            await repository.rotateEpoch();
            await assert.rejects(first.replacePolicy({ ...changed, revision: 3 }, hashRecord(changed)), {
              code: 'AI_DATASET_STALE'
            });
          } finally {
            await db.$disconnect();
          }
        }
      }
    ]
  : [];

export const aiPostgresBudgetTests = process.env.KNOWRA_SYNC_TEST_DATABASE_URL
  ? [
      {
        name: 'AI PostgreSQL 预算按计费账户串行化，并发设备共用 20 元日额度',
        async run() {
          const db = new PrismaClient({
            datasources: { db: { url: process.env.KNOWRA_SYNC_TEST_DATABASE_URL } },
            log: []
          });
          try {
            await db.$connect();
            const budget = createPostgresBudgetAuthority(db);
            const accountRef = `budget-${randomUUID()}`;
            const requests = Array.from({ length: 11 }, (_, index) =>
              budget.reserve({
                accountRef,
                jobId: `job-${index}`,
                attemptId: `attempt-${index}`,
                priceVersion: 'test-price',
                reservedMicrounits: 2_000_000
              })
            );
            const settled = await Promise.allSettled(requests);
            assert.equal(settled.filter(item => item.status === 'fulfilled').length, 10);
            assert.equal(
              settled.filter(item => item.status === 'rejected' && item.reason.code === 'AI_DAILY_BUDGET_EXCEEDED')
                .length,
              1,
              settled
                .filter(item => item.status === 'rejected')
                .map(item => `${item.reason.code}: ${item.reason.message}`)
                .join('; ')
            );
            const status = await budget.status(accountRef);
            assert.equal(status.heldMicrounits, 20_000_000);
            const first = settled.find(item => item.status === 'fulfilled').value;
            await budget.settle({ accountRef, attemptId: first.attemptId, disposition: 'unknown' });
            assert.equal((await budget.status(accountRef)).availableMicrounits, 0);
            assert.equal(
              (
                await budget.reserve({
                  accountRef,
                  jobId: first.jobId,
                  attemptId: first.attemptId,
                  priceVersion: 'test-price',
                  reservedMicrounits: 2_000_000
                })
              ).reservationId,
              first.reservationId
            );
          } finally {
            await db.$disconnect();
          }
        }
      },
      {
        name: 'AI PostgreSQL 并发 Worker 只有一个领取任务并执行模型调用',
        async run() {
          const db = new PrismaClient({
            datasources: { db: { url: process.env.KNOWRA_SYNC_TEST_DATABASE_URL } },
            log: []
          });
          try {
            await db.$connect();
            const ownerId = `worker-${randomUUID()}`;
            const accountRef = `account-${randomUUID()}`;
            const repository = createPostgresAiRepository({ client: db, ownerId });
            const request = {
              credentialRef: 'credential-reference',
              modelId: 'deepseek-flash',
              messages: [{ role: 'user', content: 'synthetic' }],
              maxTokens: 64,
              tools: []
            };
            const records = aiRecords(await repository.identity(), randomUUID(), ownerId, request);
            for (const [kind, record] of [
              ['scopeSnapshot', records.scope],
              ['contextManifest', records.manifest],
              ['aiGrant', records.grant],
              ['aiJob', records.job]
            ])
              await repository.insert(kind, record);
            let calls = 0;
            const gateway = {
              capabilities: () => ({ provider: 'mock' }),
              async complete() {
                calls++;
                return {
                  content: '合成回答',
                  requestId: 'pg-result',
                  usage: { inputTokens: 1, outputTokens: 1, unknown: false }
                };
              }
            };
            const common = {
              repository,
              budget: createPostgresBudgetAuthority(db),
              gateway,
              accountRef,
              priceProfile: {
                version: 'test',
                expiresAt: '2030-01-01T00:00:00.000Z',
                inputMicrounitsPerMillion: 2_000_000,
                outputMicrounitsPerMillion: 8_000_000
              }
            };
            const results = await Promise.allSettled([
              createAiWorker(common).run(records.job.jobId, request),
              createAiWorker(common).run(records.job.jobId, request)
            ]);
            assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
            assert.equal(calls, 1);
            assert.equal((await repository.list('aiJobAttempt', { jobId: records.job.jobId })).length, 1);
          } finally {
            await db.$disconnect();
          }
        }
      }
    ]
  : [];

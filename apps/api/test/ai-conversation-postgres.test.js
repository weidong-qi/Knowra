import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createPostgresAiRepository } from '../src/modules/ai/postgres-record-repository.ts';
import { createPostgresAiConversationStore } from '../src/modules/ai/postgres-conversation-store.js';
import { emptyAgentCheckpoint } from '../src/modules/ai/agent-checkpoint.ts';

export const aiConversationPostgresTests = process.env.KNOWRA_SYNC_TEST_DATABASE_URL
  ? [
      {
        name: 'R03 PostgreSQL 会话并发幂等、owner 隔离与 epoch 失效',
        async run() {
          const db = new PrismaClient({
            datasources: { db: { url: process.env.KNOWRA_SYNC_TEST_DATABASE_URL } },
            log: []
          });
          try {
            await db.$connect();
            const ownerId = `conversation-${randomUUID()}`;
            const repository = createPostgresAiRepository({ client: db, ownerId });
            const first = createPostgresAiConversationStore({ client: db, repository, ownerId });
            const second = createPostgresAiConversationStore({ client: db, repository, ownerId });
            const conversation = await first.createConversation({
              ownerId,
              actorId: ownerId,
              spaceId: randomUUID(),
              conversationId: randomUUID()
            });
            const input = {
              ownerId,
              conversationId: conversation.conversationId,
              content: '并发问答',
              idempotencyKey: `request-${randomUUID()}`
            };
            const results = await Promise.all([first.submitTurn(input), second.submitTurn(input)]);
            assert.equal(results[0].turnId, results[1].turnId);
            assert.equal((await first.listMessages(conversation.conversationId)).length, 1);
            const running = await first.claimTurn(results[0].turnId);
            const attemptId = randomUUID();
            await first.createModelAttempt(running.turnId, running.leaseGeneration, {
              attemptId,
              modelId: 'deepseek-flash',
              payloadHash: 'a'.repeat(64),
              reservedMicrounits: 1000
            });
            await first.advanceModelAttempt(attemptId, 'reserved', { generation: running.leaseGeneration });
            await first.advanceModelAttempt(attemptId, 'sent', { generation: running.leaseGeneration });
            const modelResult = {
              content: '合成回答',
              json: null,
              toolCalls: [],
              finishReason: 'stop',
              truncated: false,
              refused: false
            };
            await first.advanceModelAttempt(attemptId, 'settled', {
              generation: running.leaseGeneration,
              actualMicrounits: 100,
              modelResult
            });
            const checkpoint = { ...emptyAgentCheckpoint(), nextRound: 1, handledAttemptOrdinal: 1 };
            await first.saveCheckpoint(running.turnId, running.leaseGeneration, checkpoint);
            assert.deepEqual((await second.getTurn(running.turnId)).checkpoint, checkpoint);
            assert.deepEqual((await second.listModelAttempts(running.turnId))[0].modelResult, modelResult);
            const rejectedId = randomUUID();
            await first.createModelAttempt(running.turnId, running.leaseGeneration, {
              attemptId: rejectedId,
              modelId: 'deepseek-flash',
              payloadHash: 'b'.repeat(64),
              reservedMicrounits: 1000
            });
            await first.advanceModelAttempt(rejectedId, 'reserved', { generation: running.leaseGeneration });
            await first.advanceModelAttempt(rejectedId, 'sent', { generation: running.leaseGeneration });
            await first.advanceModelAttempt(rejectedId, 'settled', {
              generation: running.leaseGeneration,
              actualMicrounits: 100,
              modelResult: { ...modelResult, content: '拒绝回答', refused: true }
            });
            await first.rejectModelResult(running.turnId, running.leaseGeneration, 2, 'AI_PROVIDER_REFUSED');
            await first.failTurn(running.turnId, running.leaseGeneration, 'AI_PROVIDER_REFUSED');
            await assert.rejects(second.claimTurn(running.turnId), { code: 'AI_RESPONSE_REJECTED' });
            const retried = await second.claimTurn(running.turnId, 60000, { mode: 'retry' });
            assert.equal(retried.checkpoint.nextRound, 2);
            assert.equal(retried.checkpoint.handledAttemptOrdinal, 2);
            assert.equal(
              (await first.listModelAttempts(running.turnId))[1].responseRejectedCode,
              'AI_PROVIDER_REFUSED'
            );
            await second.failTurn(running.turnId, retried.leaseGeneration, 'AI_TASK_INTERRUPTED');
            const resumed = await first.claimTurn(running.turnId);
            assert.equal(resumed.checkpoint.nextRound, 2);
            assert.equal((await second.listModelAttempts(running.turnId)).length, 2);
            const otherOwner = `other-${randomUUID()}`;
            const otherRepo = createPostgresAiRepository({ client: db, ownerId: otherOwner });
            const isolated = createPostgresAiConversationStore({
              client: db,
              repository: otherRepo,
              ownerId: otherOwner
            });
            assert.equal(await isolated.getConversation(conversation.conversationId), null);
            await assert.rejects(
              isolated.createConversation({
                ownerId: otherOwner,
                actorId: otherOwner,
                spaceId: conversation.spaceId,
                conversationId: conversation.conversationId
              }),
              { code: 'AI_IDEMPOTENCY_CONFLICT' }
            );
            await repository.rotateEpoch();
            await assert.rejects(first.submitTurn({ ...input, idempotencyKey: `request-${randomUUID()}` }), {
              code: 'AI_DATASET_STALE'
            });
            assert.equal(
              (await first.getConversation(conversation.conversationId)).conversationId,
              conversation.conversationId
            );
          } finally {
            await db.$disconnect();
          }
        }
      }
    ]
  : [];

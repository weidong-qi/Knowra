import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPostgresAppContext } from '../src/postgres-app.factory.js';
import { createPostgresAiRepository } from '../src/modules/ai/postgres-record-repository.ts';
import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';
import { aiRecords } from './ai-record-fixtures.js';
import { trainingAssets } from './authoritative-asset-purge.test.js';
import { createKnowledgeExtractionJobFixture } from './fixtures/knowledge-extraction-job.fixture.js';

async function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-authoritative-purge-pg-'));
  const apps = [];
  let database;
  try {
    database = await createPostgresTestDatabase();
    const ownerId = `purge-${randomUUID()}`;
    const start = async () => {
      const app = await createPostgresAppContext({
        databaseUrl: database.databaseUrl,
        ownerId,
        storageRootDir: root,
        uploadsDir: path.join(root, 'uploads')
      });
      apps.push(app);
      return app;
    };
    const app = await start(),
      k = app.modules.knowledge;
    const { item, evidence } = await k.knowledgeItemService.createCandidate({
      id: 'pg-manual-subject',
      title: '合成手工知识',
      canonicalStatement: '合成声明',
      sourceMode: 'manual',
      evidence: [{ id: 'pg-manual-evidence', sourceType: 'manual', quoteText: '合成人工证据' }]
    });
    const deleted = await k.knowledgeItemService.trash(item.id);
    await run({
      app,
      k,
      ownerId,
      start,
      deleted,
      evidence,
      ai: createPostgresAiRepository({ client: app.prisma, ownerId })
    });
  } finally {
    try {
      for (const app of apps.reverse()) await app.close();
    } finally {
      try {
        await database?.close();
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
}
const journal = f => f.app.prisma.syncJournal.findUnique({ where: { ownerId: f.ownerId } });
async function insertNoteTask(f) {
  const records = aiRecords(await f.ai.identity(), 'purge-real-pg', f.ownerId);
  for (const [kind, name] of [
    ['scopeSnapshot', 'scope'],
    ['contextManifest', 'manifest'],
    ['aiGrant', 'grant'],
    ['aiJob', 'job'],
    ['aiJobAttempt', 'attempt']
  ])
    await f.ai.insert(kind, records[name]);
  return records;
}
async function rejectUnverified(f) {
  const before = await journal(f),
    current = await f.app.prisma.knowledgeItem.findUnique({ where: { id: f.deleted.id } });
  const preview = await f.k.inspectKnowledgePurge(f.deleted.id);
  assert.equal(preview.decision, 'requires-dependency-action');
  assert.equal(preview.coverage.runningTasks, 'unverified');
  assert.match(
    preview.references.find(record => record.reasonCode === 'TASK_REFERENCE_COVERAGE_UNAVAILABLE').message,
    /无法确认/
  );
  await assert.rejects(f.k.permanentlyDeleteKnowledgeItem(f.deleted.id, { expectedUpdatedAt: f.deleted.updatedAt }), {
    code: 'KNOWLEDGE_ITEM_PURGE_BLOCKED'
  });
  assert.deepEqual(await f.app.prisma.knowledgeItem.findUnique({ where: { id: f.deleted.id } }), current);
  assert.deepEqual(await journal(f), before);
}

// CI owns a migrated, isolated real PostgreSQL schema; an unset URL means zero executed PG tests.
export const authoritativeAssetPurgePostgresTests = process.env.KNOWRA_SYNC_TEST_DATABASE_URL
  ? [
      {
        name: '权威清理真实PG：AI关闭仍核查实际任务，损坏manifest/旧dataset描述及缺表阻断',
        async run() {
          await fixture(async f => {
            const records = await insertNoteTask(f);
            assert.equal((await f.k.inspectKnowledgePurge(f.deleted.id)).coverage.runningTasks, 'verified');
            await f.app.prisma.$executeRawUnsafe(
              'UPDATE ai_jobs SET manifest_hash = $1 WHERE job_id = $2',
              '0'.repeat(64),
              records.job.jobId
            );
            await rejectUnverified(f);
            await f.app.prisma.$executeRawUnsafe(
              'UPDATE ai_jobs SET manifest_hash = $1 WHERE job_id = $2',
              records.job.manifestHash,
              records.job.jobId
            );
            await f.app.prisma.$executeRawUnsafe(
              'INSERT INTO ai_knowledge_extraction_tasks VALUES ($1,$2,$3,$4)',
              f.ownerId,
              'historical-dataset',
              'damaged-descriptor',
              '{}'
            );
            await rejectUnverified(f);
            await f.app.prisma.$executeRawUnsafe(
              'DELETE FROM ai_knowledge_extraction_tasks WHERE owner_id = $1',
              f.ownerId
            );
            await f.app.prisma.$executeRawUnsafe(
              'ALTER TABLE ai_knowledge_extraction_tasks RENAME TO synthetic_missing_task_table'
            );
            try {
              await rejectUnverified(f);
            } finally {
              await f.app.prisma.$executeRawUnsafe(
                'ALTER TABLE synthetic_missing_task_table RENAME TO ai_knowledge_extraction_tasks'
              );
            }
            const other = await f.start();
            assert.equal(
              (await other.modules.knowledge.inspectKnowledgePurge(f.deleted.id)).coverage.runningTasks,
              'verified'
            );
          });
        }
      },
      {
        name: '权威清理真实PG：五手工资产同事务epoch校验，主体和独占关联发出真实墓碑',
        async run() {
          await fixture(async f => {
            const preview = await f.k.inspectKnowledgePurge(f.deleted.id),
              before = await journal(f);
            assert.equal(preview.expectedDatasetEpoch, before.payload.epoch);
            await assert.rejects(
              f.k.permanentlyDeleteKnowledgeItem(f.deleted.id, {
                expectedUpdatedAt: preview.expectedUpdatedAt,
                expectedDatasetEpoch: 'old-epoch'
              }),
              { code: 'DATASET_CHANGED' }
            );
            assert.deepEqual(await journal(f), before);
            const result = await f.k.permanentlyDeleteKnowledgeItem(f.deleted.id, {
              expectedUpdatedAt: preview.expectedUpdatedAt,
              expectedDatasetEpoch: preview.expectedDatasetEpoch
            });
            assert.equal(result.status, 'subject-purged');
            const purged = await journal(f);
            for (const [collection, id] of [
              ['knowledgeItems', f.deleted.id],
              ['knowledgeEvidence', f.evidence[0].id]
            ]) {
              assert(purged.payload.tombstones[JSON.stringify([collection, id])]);
              assert(
                purged.payload.changes
                  .flatMap(batch => batch.items)
                  .some(change => change.collection === collection && change.id === id && change.value === null)
              );
            }
            await assert.rejects(
              f.k.permanentlyDeleteKnowledgeItem(f.deleted.id, {
                expectedUpdatedAt: preview.expectedUpdatedAt,
                expectedDatasetEpoch: 'old-epoch'
              }),
              { code: 'DATASET_CHANGED' }
            );
            const assets = await trainingAssets(f.k);
            for (const [type, route, asset] of assets) {
              await f.k.trainingAssetLifecycle.trash(type, asset.id);
              const plan = await f.k.trainingAssetLifecycle.inspect(type, asset.id),
                current = await journal(f);
              assert.equal(plan.coverage.runningTasks, 'verified');
              assert.equal(plan.decision, 'can-purge-no-history');
              await assert.rejects(
                f.k.trainingAssetLifecycle.purge(type, asset.id, plan.expectedUpdatedAt, {
                  expectedDatasetEpoch: 'old-epoch'
                }),
                { code: 'DATASET_CHANGED' }
              );
              assert.deepEqual(await journal(f), current);
              assert.equal(
                (
                  await f.k.trainingAssetLifecycle.purge(
                    type,
                    asset.id,
                    plan.expectedUpdatedAt,
                    type === 'examProfile' ? {} : { expectedDatasetEpoch: plan.expectedDatasetEpoch }
                  )
                ).status,
                'subject-purged'
              );
              const next = await journal(f),
                collection = route.replaceAll(/-([a-z])/g, (_, c) => c.toUpperCase());
              assert(next.payload.tombstones[JSON.stringify([collection, asset.id])]);
              if (type === 'question')
                for (const [name, ids] of Object.entries(plan.exclusiveRecords))
                  for (const id of ids) assert(next.payload.tombstones[JSON.stringify([name, id])]);
            }
          });
        }
      },
      {
        name: '权威清理真实PG：真实提炼commit独立保留，损坏receipt阻断，不开放生成资产清理',
        async run() {
          await fixture(async f => {
            const extraction = await createKnowledgeExtractionJobFixture(f.app, f.ai, f.ownerId);
            const receipt = await f.app.knowledgeExtractionCommit.commit(extraction.input);
            assert.equal((await f.k.inspectKnowledgePurge(f.deleted.id)).coverage.runningTasks, 'verified');
            const generatedId = receipt.candidates[0].candidateInput.id;
            const generated = await f.k.knowledgeItemService.trash(generatedId);
            const preview = await f.k.inspectKnowledgePurge(generatedId),
              before = await journal(f);
            await assert.rejects(
              f.k.permanentlyDeleteKnowledgeItem(generatedId, {
                expectedUpdatedAt: generated.updatedAt,
                expectedDatasetEpoch: preview.expectedDatasetEpoch
              }),
              { code: 'PURGE_MANUAL_SCOPE_REQUIRED' }
            );
            assert.deepEqual(await journal(f), before);
            await f.k.permanentlyDeleteKnowledgeItem(generatedId, { expectedUpdatedAt: generated.updatedAt });
            const [row] = await f.app.prisma.$queryRawUnsafe(
              'SELECT receipt_json FROM knowledge_extraction_commits WHERE owner_id = $1',
              f.ownerId
            );
            assert.equal(row.receipt_json, JSON.stringify(receipt));
            await f.app.prisma.$executeRawUnsafe(
              'UPDATE knowledge_extraction_commits SET receipt_hash = $1 WHERE owner_id = $2',
              '0'.repeat(64),
              f.ownerId
            );
            await rejectUnverified(f);
          });
        }
      },
      {
        name: '权威清理真实PG：关联删除和最终journal SQL故障整体回滚，重试后事实才产生',
        async run() {
          for (const table of ['"KnowledgeEvidence"', '"SyncJournal"'])
            await fixture(async f => {
              const plan = await f.k.inspectKnowledgePurge(f.deleted.id),
                before = await journal(f);
              const item = await f.app.prisma.knowledgeItem.findUnique({ where: { id: f.deleted.id } });
              const evidence = await f.app.prisma.knowledgeEvidence.findMany();
              await f.app.prisma
                .$executeRawUnsafe(`CREATE FUNCTION fail_authority_purge() RETURNS trigger LANGUAGE plpgsql AS
        'BEGIN RAISE EXCEPTION ''synthetic authority purge rollback''; END;'`);
              await f.app.prisma.$executeRawUnsafe(
                `CREATE TRIGGER fail_authority_purge BEFORE ${table === '"SyncJournal"' ? 'UPDATE' : 'DELETE'} ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_authority_purge()`
              );
              try {
                await assert.rejects(
                  f.k.permanentlyDeleteKnowledgeItem(f.deleted.id, {
                    expectedUpdatedAt: plan.expectedUpdatedAt,
                    expectedDatasetEpoch: plan.expectedDatasetEpoch
                  }),
                  /PostgreSQL operation failed/
                );
              } finally {
                await f.app.prisma.$executeRawUnsafe(`DROP TRIGGER fail_authority_purge ON ${table}`);
              }
              assert.deepEqual(await f.app.prisma.knowledgeItem.findUnique({ where: { id: f.deleted.id } }), item);
              assert.deepEqual(await f.app.prisma.knowledgeEvidence.findMany(), evidence);
              assert.deepEqual(await journal(f), before);
              assert.equal(
                (
                  await f.k.permanentlyDeleteKnowledgeItem(f.deleted.id, {
                    expectedUpdatedAt: plan.expectedUpdatedAt,
                    expectedDatasetEpoch: plan.expectedDatasetEpoch
                  })
                ).status,
                'subject-purged'
              );
            });
          for (const table of ['"QuestionSource"', '"Question"', '"SyncJournal"'])
            await fixture(async f => {
              const [type, , question] = (await trainingAssets(f.k))[0];
              await f.k.trainingAssetLifecycle.trash(type, question.id);
              const plan = await f.k.trainingAssetLifecycle.inspect(type, question.id),
                before = await journal(f);
              const subject = await f.app.prisma.question.findUnique({ where: { id: question.id } });
              const links = await f.app.prisma.questionObjective.findMany(),
                sources = await f.app.prisma.questionSource.findMany();
              await f.app.prisma
                .$executeRawUnsafe(`CREATE FUNCTION fail_training_purge() RETURNS trigger LANGUAGE plpgsql AS
        'BEGIN RAISE EXCEPTION ''synthetic training purge rollback''; END;'`);
              await f.app.prisma.$executeRawUnsafe(
                `CREATE TRIGGER fail_training_purge BEFORE ${table === '"SyncJournal"' ? 'UPDATE' : 'DELETE'} ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_training_purge()`
              );
              try {
                await assert.rejects(
                  f.k.trainingAssetLifecycle.purge(type, question.id, plan.expectedUpdatedAt, {
                    expectedDatasetEpoch: plan.expectedDatasetEpoch
                  }),
                  /PostgreSQL operation failed/
                );
              } finally {
                await f.app.prisma.$executeRawUnsafe(`DROP TRIGGER fail_training_purge ON ${table}`);
              }
              assert.deepEqual(await f.app.prisma.question.findUnique({ where: { id: question.id } }), subject);
              assert.deepEqual(await f.app.prisma.questionObjective.findMany(), links);
              assert.deepEqual(await f.app.prisma.questionSource.findMany(), sources);
              assert.deepEqual(await journal(f), before);
              assert.equal(
                (
                  await f.k.trainingAssetLifecycle.purge(type, question.id, plan.expectedUpdatedAt, {
                    expectedDatasetEpoch: plan.expectedDatasetEpoch
                  })
                ).status,
                'subject-purged'
              );
            });
        }
      },
      {
        name: '权威清理真实PG：另一实例预检后新增历史引用和恢复，清理重新核查并拒绝旧CAS',
        async run() {
          await fixture(async f => {
            const assets = await trainingAssets(f.k),
              [, , objective] = assets.find(value => value[0] === 'learningObjective');
            const profile = await f.k.examProfileService.create({ id: 'late-pg-profile', name: '合成考试' });
            const deleted = await f.k.trainingAssetLifecycle.trash('examProfile', profile.id);
            assert.equal(
              (await f.k.trainingAssetLifecycle.inspect('examProfile', profile.id)).decision,
              'can-purge-no-history'
            );
            const other = await f.start(),
              stamp = new Date().toISOString();
            await other.repositories.examFocusRepository.save({
              id: 'late-pg-focus',
              examProfileId: profile.id,
              learningObjectiveId: objective.id,
              description: '合成晚到引用',
              priority: 1,
              difficultyHint: null,
              questionTypeSuggestions: [],
              sourceType: 'manual',
              reviewStatus: 'candidate',
              deletedAt: stamp,
              createdAt: stamp,
              updatedAt: stamp
            });
            const before = await journal(f);
            await assert.rejects(f.k.trainingAssetLifecycle.purge('examProfile', profile.id, deleted.updatedAt), {
              code: 'TRAINING_ASSET_PURGE_BLOCKED'
            });
            assert.deepEqual(await journal(f), before);
            await other.modules.knowledge.knowledgeItemService.restoreDeleted(f.deleted.id, {
              expectedUpdatedAt: f.deleted.updatedAt
            });
            await assert.rejects(
              f.k.permanentlyDeleteKnowledgeItem(f.deleted.id, { expectedUpdatedAt: f.deleted.updatedAt }),
              { code: 'KNOWLEDGE_ITEM_UPDATE_CONFLICT' }
            );
            await f.k.trainingAssetLifecycle.trash('learningObjective', objective.id);
            const parent = await f.k.knowledgeItemService.trash(objective.knowledgeItemId);
            assert((await f.k.inspectKnowledgePurge(parent.id)).references.some(ref => ref.id === objective.id));
          });
        }
      }
    ]
  : [];

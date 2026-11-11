import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createAppContext } from '../src/app.factory.js';
import { createFileDataStore } from '../src/infrastructure/file-data-store.ts';
import { createSqliteDataStore } from '../../desktop-runtime/src/sqlite-data-store.mjs';
import { createLocalBudgetAuthority } from '../../desktop-runtime/src/local-budget-authority.mjs';
import { createServer } from '../src/server.js';
import { scopeHash, manifestHash } from '../src/modules/ai/record-contract.ts';
import { aiRecords } from './ai-record-fixtures.js';
import { createAiTranslationService } from '../src/modules/ai/translation-service.ts';
import { createLocalPurgeTaskReader } from '../src/infrastructure/asset-purge-task-state.ts';
import { AI_SQL_DEFINITIONS, encodeAiRow } from '../src/modules/ai/record-sql-map.ts';
import {
  createExtractionTaskSources,
  extractionTaskGateway,
  quietTaskLogger
} from './fixtures/knowledge-extraction-task.fixture.js';

async function fixture(driver, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-authority-purge-api-'));
  const file = path.join(root, driver === 'JSON' ? 'synthetic.json' : 'synthetic.sqlite');
  let store, server, budget;
  const open = () => {
    store = driver === 'JSON' ? createFileDataStore(file) : createSqliteDataStore(file);
    budget =
      driver === 'JSON'
        ? store.aiBudgetAuthority
        : createLocalBudgetAuthority({ filePath: path.join(root, 'ai-budget.json') });
    return createAppContext({
      dataStore: store,
      ownerId: 'demo',
      storageRootDir: root,
      uploadsDir: path.join(root, 'uploads')
    });
  };
  try {
    let app = open();
    const { item } = app.modules.knowledge.knowledgeItemService.createCandidate({
      id: 'synthetic-purge-knowledge',
      title: '合成手工知识',
      canonicalStatement: '合成声明',
      sourceMode: 'manual'
    });
    const deleted = app.modules.knowledge.knowledgeItemService.trash(item.id);
    const reopen = () => {
      store.close?.();
      app = open();
      return app;
    };
    await run({
      root,
      file,
      get app() {
        return app;
      },
      get store() {
        return store;
      },
      deleted,
      get budget() {
        return budget;
      },
      reopen,
      async http() {
        server = createServer({ appContext: app, logger: { error() {} } });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        return async (route, method = 'GET', body) => {
          const response = await fetch(`http://127.0.0.1:${server.address().port}/api/${route}`, {
            method,
            ...(body === undefined
              ? {}
              : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          });
          return { status: response.status, body: await response.json() };
        };
      }
    });
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    store?.close?.();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const snapshot = f => structuredClone({ data: f.store.state, journal: f.store.getSyncJournal?.() });
function insertJob(store, { unknownScope = false } = {}) {
  const records = aiRecords(store.aiRepository.identity(), 'purge-synthetic');
  if (unknownScope) {
    records.scope.scopeKind = records.manifest.scopeKind = 'knowledgeItems';
    records.scope.scopeHash = scopeHash(records.scope);
    records.manifest.scopeHash = records.grant.scopeHash = records.scope.scopeHash;
    records.job.manifestHash = manifestHash(records.manifest);
  }
  store.runTransaction(() => {
    for (const [kind, name] of [
      ['scopeSnapshot', 'scope'],
      ['contextManifest', 'manifest'],
      ['aiGrant', 'grant'],
      ['aiJob', 'job'],
      ['aiJobAttempt', 'attempt']
    ])
      store.aiRepository.insert(kind, records[name]);
  });
  return records;
}

export async function storedTranslation(repository, budget, ownerId = 'demo', failed = false) {
  const translation = createAiTranslationService({
    repository,
    budget,
    ownerId,
    modelSettings: { credentialReference: async () => ({ modelId: 'deepseek-flash', credentialRef: 'synthetic' }) },
    gateway: {
      capabilities: () => ({ provider: 'mock' }),
      async complete() {
        if (failed) throw Object.assign(new Error('合成供应商失败'), { code: 'AI_PROVIDER_UNAVAILABLE' });
        return { content: '合成译文', usage: { unknown: false, inputTokens: 40, outputTokens: 20 } };
      }
    },
    priceProfile: {
      version: 'translation-purge-synthetic-v1',
      expiresAt: '2030-01-01T00:00:00Z',
      inputMicrounitsPerMillion: 2000000,
      outputMicrounitsPerMillion: 8000000
    }
  });
  try {
    const result = translation.translate({ text: 'Synthetic PDF selection.' });
    if (failed) await assert.rejects(result, { code: 'AI_PROVIDER_UNAVAILABLE' });
    else assert.equal((await result).translation, '合成译文');
  } finally {
    await translation.close();
  }
}

export async function trainingAssets(knowledge) {
  const item = (
    await knowledge.knowledgeItemService.createCandidate({
      id: 'synthetic-parent',
      title: '合成父知识',
      canonicalStatement: '合成声明',
      sourceMode: 'manual'
    })
  ).item;
  await knowledge.knowledgeItemService.confirmItem(item.id);
  const objective = await knowledge.learningObjectiveService.createCandidate({
    id: 'synthetic-objective',
    knowledgeItemId: item.id,
    objective: '解释合成声明',
    actionVerb: 'explain',
    cognitiveLevel: 'understand'
  });
  await knowledge.learningObjectiveService.confirmObjective(objective.id);
  const profile = await knowledge.examProfileService.create({ id: 'synthetic-profile', name: '合成考试' });
  const focus = await knowledge.examFocusService.create({
    id: 'synthetic-focus',
    examProfileId: profile.id,
    learningObjectiveId: objective.id
  });
  const question = await knowledge.questionService.createQuestion({
    id: 'synthetic-question',
    stem: '合成问题',
    questionType: 'shortAnswer',
    learningObjectiveIds: [objective.id],
    sources: [{ sourceType: 'manual', quote: '合成人工来源' }]
  });
  return [
    ['question', 'questions', question],
    ['examFocus', 'exam-focuses', focus],
    ['learningObjective', 'learning-objectives', objective],
    ['examProfile', 'exam-profiles', profile]
  ];
}

export const authoritativeAssetPurgeTests = [
  ...['JSON', 'SQLite'].flatMap(driver =>
    [false, true].map(failed => ({
      name: `权威清理 ${driver}：真实翻译${failed ? '失败' : '成功'}并重启后，无关知识及四类训练资产可永久删除`,
      async run() {
        await fixture(driver, async f => {
          await storedTranslation(f.store.aiRepository, f.budget, 'demo', failed);
          const k = f.reopen().modules.knowledge;
          const records = await trainingAssets(k);
          const before = structuredClone(createLocalPurgeTaskReader(f.store)());
          const budget = await f.budget.usage('deepseek-primary');
          assert.equal(before.ai.jobs[0].jobKind, 'translation');
          assert.equal(before.ai.jobs[0].status, failed ? 'failed' : 'succeeded');
          const request = await f.http();
          const route = `knowledge/items/${f.deleted.id}`;
          const preview = (await request(`${route}/purge-preview`)).body.data;
          assert.equal(preview.coverage.runningTasks, 'verified');
          assert.equal(preview.decision, 'can-purge-no-history');
          const purged = await request(`${route}/permanent`, 'DELETE', {
            expectedUpdatedAt: preview.expectedUpdatedAt,
            expectedDatasetEpoch: preview.expectedDatasetEpoch
          });
          assert.equal(purged.status, 200, JSON.stringify(purged.body));
          assert.equal(purged.body.data.status, 'subject-purged');
          for (const [type, , asset] of records) {
            k.trainingAssetLifecycle.trash(type, asset.id);
            const assetPreview = k.trainingAssetLifecycle.inspect(type, asset.id);
            assert.equal(assetPreview.coverage.runningTasks, 'verified');
            assert.equal(assetPreview.decision, 'can-purge-no-history');
            assert.equal(
              k.trainingAssetLifecycle.purge(type, asset.id, assetPreview.expectedUpdatedAt).status,
              'subject-purged'
            );
          }
          assert.deepEqual(createLocalPurgeTaskReader(f.store)(), before);
          assert.deepEqual(await f.budget.usage('deepseek-primary'), budget);
        });
      }
    }))
  ),
  ...['JSON', 'SQLite'].map(driver => ({
    name: `权威清理 ${driver}：翻译任务的损坏绑定、非空来源及工具授权仍阻断删除`,
    async run() {
      for (const corruption of ['manifestBinding', 'nonEmptyScope', 'toolGrant'])
        await fixture(driver, async f => {
          await storedTranslation(f.store.aiRepository, f.budget);
          const state = structuredClone(createLocalPurgeTaskReader(f.store)());
          const job = state.ai.jobs[0],
            manifest = state.ai.contextManifests[0],
            scope = state.ai.scopeSnapshots[0],
            grant = state.ai.grants[0];
          if (corruption === 'manifestBinding') job.manifestHash = '0'.repeat(64);
          else if (corruption === 'toolGrant') grant.allowedTools = ['notes_read'];
          else {
            scope.scopeKind = manifest.scopeKind = 'note';
            scope.scopeHash = scopeHash(scope);
            manifest.scopeHash = grant.scopeHash = scope.scopeHash;
            job.manifestHash = manifestHash(manifest);
          }
          if (driver === 'JSON') {
            const raw = JSON.parse(fs.readFileSync(f.file, 'utf8'));
            Object.assign(raw.aiRuntime, state.ai);
            fs.writeFileSync(f.file, JSON.stringify(raw));
          } else
            f.store.readSync(db => {
              for (const [kind, record] of [
                ['scopeSnapshot', scope],
                ['contextManifest', manifest],
                ['aiGrant', grant],
                ['aiJob', job]
              ]) {
                const row = encodeAiRow(kind, record),
                  definition = AI_SQL_DEFINITIONS[kind];
                const fields = Object.keys(row).filter(field => field !== definition.id);
                db.prepare(
                  `UPDATE ${definition.table} SET ${fields.map(field => `${field} = ?`).join(', ')} WHERE ${definition.id} = ?`
                ).run(...fields.map(field => row[field]), row[definition.id]);
              }
            });
          const k = f.reopen().modules.knowledge,
            before = snapshot(f);
          const preview = k.inspectKnowledgePurge(f.deleted.id);
          assert.equal(preview.coverage.runningTasks, 'unverified', corruption);
          assert(preview.references.some(ref => ref.reasonCode === 'TASK_REFERENCE_COVERAGE_UNAVAILABLE'));
          assert.throws(
            () => k.permanentlyDeleteKnowledgeItem(f.deleted.id, { expectedUpdatedAt: f.deleted.updatedAt }),
            { code: 'KNOWLEDGE_ITEM_PURGE_BLOCKED' }
          );
          assert.deepEqual(snapshot(f), before);
        });
    }
  })),
  ...['JSON', 'SQLite'].map(driver => ({
    name: `权威清理 ${driver}：持久化任务存储不可读时预检和执行均阻断`,
    async run() {
      await fixture(driver, async f => {
        if (driver === 'JSON') {
          const raw = JSON.parse(fs.readFileSync(f.file, 'utf8'));
          raw.aiKnowledgeExtractionTasks = { version: 1, tasks: [{ jobId: 'unreadable-task' }] };
          fs.writeFileSync(f.file, JSON.stringify(raw));
        } else {
          f.store.readSync(db =>
            db
              .prepare('INSERT INTO ai_knowledge_extraction_tasks VALUES (?,?,?,?)')
              .run('demo', 'historical-dataset', 'unreadable-task', '{}')
          );
        }
        const app = f.reopen(),
          knowledge = app.modules.knowledge;
        const before = snapshot(f),
          preview = knowledge.inspectKnowledgePurge(f.deleted.id);
        assert.equal(preview.decision, 'requires-dependency-action');
        assert.equal(preview.coverage.runningTasks, 'unverified');
        assert(preview.references.some(ref => ref.reasonCode === 'TASK_REFERENCE_COVERAGE_UNAVAILABLE'));
        assert.throws(
          () => knowledge.permanentlyDeleteKnowledgeItem(f.deleted.id, { expectedUpdatedAt: f.deleted.updatedAt }),
          { code: 'KNOWLEDGE_ITEM_PURGE_BLOCKED' }
        );
        assert.deepEqual(snapshot(f), before);
        const request = await f.http();
        const response = await request(`knowledge/items/${f.deleted.id}/permanent`, 'DELETE', {
          expectedUpdatedAt: f.deleted.updatedAt
        });
        assert.equal(response.status, 409);
        assert.equal(response.body.error.code, 'KNOWLEDGE_ITEM_PURGE_BLOCKED');
        assert.match(response.body.error.message, /持久化任务.*无法确认/);
        assert.deepEqual(snapshot(f), before);
      });
    }
  })),
  ...['JSON', 'SQLite'].map(driver => ({
    name: `权威清理 ${driver}：实际笔记任务不被误报为手工知识引用`,
    async run() {
      await fixture(driver, async f => {
        insertJob(f.store);
        const app = f.reopen(),
          preview = app.modules.knowledge.inspectKnowledgePurge(f.deleted.id);
        assert.equal(preview.coverage.runningTasks, 'verified');
        assert.equal(preview.decision, 'can-purge-no-history');
        assert.equal(
          app.modules.knowledge.permanentlyDeleteKnowledgeItem(f.deleted.id, { expectedUpdatedAt: f.deleted.updatedAt })
            .status,
          'subject-purged'
        );
      });
    }
  })),
  {
    name: '权威清理 JSON：合同内尚未实现的知识范围保留，不能推断为没有引用',
    async run() {
      await fixture('JSON', async f => {
        insertJob(f.store, { unknownScope: true });
        const app = f.reopen(),
          preview = app.modules.knowledge.inspectKnowledgePurge(f.deleted.id);
        assert.equal(preview.decision, 'requires-dependency-action');
        assert.equal(preview.coverage.runningTasks, 'unverified');
        assert.throws(
          () =>
            app.modules.knowledge.permanentlyDeleteKnowledgeItem(f.deleted.id, {
              expectedUpdatedAt: f.deleted.updatedAt
            }),
          { code: 'KNOWLEDGE_ITEM_PURGE_BLOCKED' }
        );
      });
    }
  },
  {
    name: '权威清理 JSON HTTP：可选epoch同事务拒绝旧世代，旧Web无epoch仍兼容',
    async run() {
      await fixture('JSON', async f => {
        const request = await f.http(),
          route = `knowledge/items/${f.deleted.id}`;
        const preview = await request(`${route}/purge-preview`);
        assert.equal(preview.status, 200);
        assert.equal(preview.body.data.expectedDatasetEpoch, f.store.getSyncJournal().epoch);
        const before = snapshot(f);
        for (const [expectedDatasetEpoch, code] of [
          ['previous-epoch', 'DATASET_CHANGED'],
          [null, 'PURGE_DATASET_EPOCH_INVALID'],
          ['', 'PURGE_DATASET_EPOCH_INVALID']
        ]) {
          const rejected = await request(`${route}/permanent`, 'DELETE', {
            expectedUpdatedAt: f.deleted.updatedAt,
            expectedDatasetEpoch
          });
          assert.equal(rejected.status, 409);
          assert.equal(rejected.body.error.code, code);
          assert.deepEqual(snapshot(f), before);
        }
        const purged = await request(`${route}/permanent`, 'DELETE', { expectedUpdatedAt: f.deleted.updatedAt });
        assert.equal(purged.status, 200);
        assert.equal(purged.body.data.status, 'subject-purged');
        const repeat = await request(`${route}/permanent`, 'DELETE', {
          expectedUpdatedAt: f.deleted.updatedAt,
          expectedDatasetEpoch: 'previous-epoch'
        });
        assert.equal(repeat.status, 409);
        assert.equal(repeat.body.error.code, 'DATASET_CHANGED');
      });
    }
  },
  ...['JSON', 'SQLite'].map(driver => ({
    name: `权威清理 ${driver}：实际孤儿尝试或manifest绑定破坏不能被枚举遗漏`,
    async run() {
      for (const corruption of ['orphanAttempt', 'manifestBinding'])
        await fixture(driver, async f => {
          const records = insertJob(f.store);
          if (driver === 'JSON') {
            const raw = JSON.parse(fs.readFileSync(f.file, 'utf8'));
            if (corruption === 'orphanAttempt') raw.aiRuntime.jobs = [];
            else raw.aiRuntime.jobs[0].manifestHash = '0'.repeat(64);
            fs.writeFileSync(f.file, JSON.stringify(raw));
          } else
            f.store.readSync(db => {
              if (corruption === 'orphanAttempt') {
                // Simulate retained/imported corrupt storage; ordinary FK-protected writes cannot create an orphan.
                db.exec('PRAGMA foreign_keys = OFF');
                try {
                  db.prepare('DELETE FROM ai_jobs WHERE job_id = ?').run(records.job.jobId);
                } finally {
                  db.exec('PRAGMA foreign_keys = ON');
                }
              } else
                db.prepare('UPDATE ai_jobs SET manifest_hash = ? WHERE job_id = ?').run(
                  '0'.repeat(64),
                  records.job.jobId
                );
            });
          const knowledge = f.reopen().modules.knowledge,
            before = snapshot(f);
          assert.equal(knowledge.inspectKnowledgePurge(f.deleted.id).coverage.runningTasks, 'unverified');
          assert.throws(
            () => knowledge.permanentlyDeleteKnowledgeItem(f.deleted.id, { expectedUpdatedAt: f.deleted.updatedAt }),
            { code: 'KNOWLEDGE_ITEM_PURGE_BLOCKED' }
          );
          assert.deepEqual(snapshot(f), before);
        });
    }
  })),
  ...['JSON', 'SQLite'].map(driver => ({
    name: `权威清理 ${driver}：真实提炼任务与提交在AI关闭后仍核查，完整历史独立保留`,
    async run() {
      await fixture(driver, async f => {
        const mock = extractionTaskGateway();
        const taskApp = createAppContext({
          dataStore: f.store,
          ownerId: 'demo',
          storageRootDir: f.root,
          knowledgeExtractionMock: { gateway: mock.gateway, schedule() {}, logger: quietTaskLogger }
        });
        try {
          const sources = await createExtractionTaskSources(taskApp);
          const job = await taskApp.knowledgeExtractionTasks.start(sources.input);
          await taskApp.knowledgeExtractionTasks.idle();
          assert.equal((await taskApp.knowledgeExtractionTasks.get(job.jobId)).status, 'succeeded');
          await taskApp.knowledgeExtractionTasks.close();
          const app = f.reopen();
          assert.equal(app.knowledgeExtractionTasks, null);
          const preview = app.modules.knowledge.inspectKnowledgePurge(f.deleted.id);
          assert.equal(preview.coverage.runningTasks, 'verified');
          const receiptKey = { ...f.store.aiRepository.identity(), ownerId: 'demo', jobId: job.jobId };
          const receipt = f.store.knowledgeExtractionCommitStore.get(receiptKey);
          assert(receipt);
          if (driver === 'JSON') {
            const generatedId = receipt.candidates[0].candidateInput.id;
            const generated = app.modules.knowledge.knowledgeItemService.trash(generatedId);
            const before = snapshot(f);
            assert.throws(
              () =>
                app.modules.knowledge.permanentlyDeleteKnowledgeItem(generatedId, {
                  expectedUpdatedAt: generated.updatedAt,
                  expectedDatasetEpoch: f.store.getSyncJournal().epoch
                }),
              { code: 'PURGE_MANUAL_SCOPE_REQUIRED' }
            );
            assert.deepEqual(snapshot(f), before);
            // Existing Web generated purge stays compatible and keeps the complete independent receipt.
            app.modules.knowledge.permanentlyDeleteKnowledgeItem(generatedId, {
              expectedUpdatedAt: generated.updatedAt
            });
            assert.deepEqual(f.store.knowledgeExtractionCommitStore.get(receiptKey), receipt);
          }
          app.modules.knowledge.permanentlyDeleteKnowledgeItem(f.deleted.id, {
            expectedUpdatedAt: f.deleted.updatedAt
          });
          assert.deepEqual(f.store.knowledgeExtractionCommitStore.get(receiptKey), receipt);
          const parent = (
            await app.modules.knowledge.knowledgeItemService.createCandidate({
              id: 'synthetic-second-manual',
              title: '合成手工',
              canonicalStatement: '合成'
            })
          ).item;
          const deleted = await app.modules.knowledge.knowledgeItemService.trash(parent.id);
          if (driver === 'JSON') {
            const raw = JSON.parse(fs.readFileSync(f.file, 'utf8'));
            raw.knowledgeExtractionCommits.receipts[0].receiptHash = '0'.repeat(64);
            fs.writeFileSync(f.file, JSON.stringify(raw));
          } else
            f.store.readSync(db => db.prepare('UPDATE knowledge_extraction_commits SET receipt_json = ?').run('{}'));
          const reopened = f.reopen().modules.knowledge;
          assert.equal(reopened.inspectKnowledgePurge(deleted.id).coverage.runningTasks, 'unverified');
          assert.throws(
            () => reopened.permanentlyDeleteKnowledgeItem(deleted.id, { expectedUpdatedAt: deleted.updatedAt }),
            { code: 'KNOWLEDGE_ITEM_PURGE_BLOCKED' }
          );
        } finally {
          await taskApp.knowledgeExtractionTasks.close();
        }
      });
    }
  })),
  ...['JSON', 'SQLite'].map(driver => ({
    name: `权威清理 ${driver}：四类训练资产共用持久化任务阻断且正文不改`,
    async run() {
      await fixture(driver, async f => {
        const records = await trainingAssets(f.app.modules.knowledge);
        for (const [type, , asset] of records)
          await f.app.modules.knowledge.trainingAssetLifecycle.trash(type, asset.id);
        if (driver === 'JSON') {
          const raw = JSON.parse(fs.readFileSync(f.file, 'utf8'));
          raw.aiRuntime = null;
          fs.writeFileSync(f.file, JSON.stringify(raw));
        } else
          f.store.readSync(db =>
            db
              .prepare('INSERT INTO ai_knowledge_extraction_tasks VALUES (?,?,?,?)')
              .run('demo', 'old-dataset', 'broken-descriptor', '{}')
          );
        const lifecycle = f.reopen().modules.knowledge.trainingAssetLifecycle,
          before = snapshot(f);
        for (const [type, , asset] of records) {
          const preview = lifecycle.inspect(type, asset.id);
          assert.equal(preview.decision, 'requires-dependency-action');
          assert.equal(preview.coverage.runningTasks, 'unverified');
          assert.throws(() => lifecycle.purge(type, asset.id, preview.expectedUpdatedAt), {
            code: 'TRAINING_ASSET_PURGE_BLOCKED'
          });
        }
        assert.deepEqual(snapshot(f), before);
      });
    }
  })),
  {
    name: '权威清理 JSON HTTP：四类训练资产同世代执行、独占关联墓碑和旧Web兼容',
    async run() {
      await fixture('JSON', async f => {
        const records = await trainingAssets(f.app.modules.knowledge),
          request = await f.http();
        for (const [type, route, asset] of records) {
          await f.app.modules.knowledge.trainingAssetLifecycle.trash(type, asset.id);
          const preview = (await request(`knowledge/${route}/${asset.id}/purge-preview`)).body.data;
          assert.equal(preview.coverage.runningTasks, 'verified');
          assert.equal(preview.decision, 'can-purge-no-history');
          const before = snapshot(f);
          const wrong = await request(`knowledge/${route}/${asset.id}/purge`, 'POST', {
            expectedUpdatedAt: preview.expectedUpdatedAt,
            expectedDatasetEpoch: 'stale-dataset',
            ownerId: 'forged-owner'
          });
          assert.equal(wrong.status, 409);
          assert.equal(wrong.body.error.code, 'DATASET_CHANGED');
          assert.deepEqual(snapshot(f), before);
          const correct = await request(`knowledge/${route}/${asset.id}/purge`, 'POST', {
            expectedUpdatedAt: preview.expectedUpdatedAt,
            ...(type === 'examProfile' ? {} : { expectedDatasetEpoch: preview.expectedDatasetEpoch })
          });
          assert.equal(correct.status, 200, JSON.stringify(correct.body));
          assert.equal(correct.body.data.status, 'subject-purged');
          assert(
            f.store.getSyncJournal().tombstones[
              JSON.stringify([route.replaceAll(/-([a-z])/g, (_, c) => c.toUpperCase()), asset.id])
            ]
          );
          if (type === 'question')
            for (const [collection, ids] of Object.entries(preview.exclusiveRecords))
              for (const id of ids) assert(f.store.getSyncJournal().tombstones[JSON.stringify([collection, id])]);
        }
      });
    }
  },
  ...['JSON', 'SQLite'].map(driver => ({
    name: `权威清理 ${driver}：预检后新引用阻断，恢复或更新后的旧CAS拒绝`,
    async run() {
      await fixture(driver, async f => {
        const k = f.app.modules.knowledge,
          profile = await k.examProfileService.create({ id: 'late-reference-profile', name: '合成考试' });
        const deleted = k.trainingAssetLifecycle.trash('examProfile', profile.id);
        const preview = k.trainingAssetLifecycle.inspect('examProfile', profile.id);
        assert.equal(preview.decision, 'can-purge-no-history');
        const assets = await trainingAssets(k),
          objective = assets.find(value => value[0] === 'learningObjective')[2];
        const stamp = new Date().toISOString();
        k.repositories.examFocusRepository.save({
          id: 'late-reference-focus',
          examProfileId: profile.id,
          learningObjectiveId: objective.id,
          description: '合成晚到引用',
          priority: 1,
          difficultyHint: null,
          questionTypeSuggestions: [],
          sourceType: 'manual',
          reviewStatus: 'candidate',
          deletedAt: null,
          createdAt: stamp,
          updatedAt: stamp
        });
        const before = snapshot(f);
        assert.throws(() => k.trainingAssetLifecycle.purge('examProfile', profile.id, deleted.updatedAt), {
          code: 'TRAINING_ASSET_PURGE_BLOCKED'
        });
        assert.deepEqual(snapshot(f), before);
        k.knowledgeItemService.restoreDeleted(f.deleted.id, { expectedUpdatedAt: f.deleted.updatedAt });
        assert.throws(
          () => k.permanentlyDeleteKnowledgeItem(f.deleted.id, { expectedUpdatedAt: f.deleted.updatedAt }),
          { code: 'KNOWLEDGE_ITEM_UPDATE_CONFLICT' }
        );
        assert(k.repositories.knowledgeItemRepository.findById(f.deleted.id));
      });
    }
  })),
  ...['JSON', 'SQLite'].map(driver => ({
    name: `权威清理 ${driver}：回收站目标仍引用父知识，不得当成独占记录清理`,
    async run() {
      await fixture(driver, async f => {
        const k = f.app.modules.knowledge,
          assets = await trainingAssets(k),
          objective = assets.find(value => value[0] === 'learningObjective')[2];
        k.trainingAssetLifecycle.trash('learningObjective', objective.id);
        const parent = k.knowledgeItemService.trash(objective.knowledgeItemId);
        const preview = k.inspectKnowledgePurge(parent.id);
        assert(
          preview.references.some(
            reference => reference.collection === 'learningObjectives' && reference.id === objective.id
          )
        );
        const before = snapshot(f);
        assert.throws(() => k.permanentlyDeleteKnowledgeItem(parent.id, { expectedUpdatedAt: parent.updatedAt }), {
          code: 'KNOWLEDGE_ITEM_PURGE_BLOCKED'
        });
        assert.deepEqual(snapshot(f), before);
      });
    }
  }))
];

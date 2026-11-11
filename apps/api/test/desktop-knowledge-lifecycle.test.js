import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createAppContext } from '../src/app.factory.ts';
import { createPostgresAppContext } from '../src/postgres-app.factory.ts';
import { createFileDataStore } from '../src/infrastructure/file-data-store.ts';
import { createServer } from '../src/server.ts';
import { syncContract, syncContractQuery } from '../src/modules/sync/protocol-contract.ts';
import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';

// 仅合成资料；真实 PG 用既有 helper 创建并销毁独立 schema，不修改生产 provider。
async function fixture(driver, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-desktop-knowledge-cloud-'));
  let database, app, server;
  try {
    const store = driver === 'JSON' ? createFileDataStore(path.join(root, 'cloud.json')) : null;
    const options = { ownerId: 'demo', storageRootDir: root, uploadsDir: path.join(root, 'uploads') };
    if (store) app = createAppContext({ ...options, dataStore: store });
    else {
      database = await createPostgresTestDatabase();
      app = await createPostgresAppContext({ ...options, databaseUrl: database.databaseUrl });
    }
    const knowledge = app.modules.knowledge;
    await knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
    server = createServer({ appContext: app, logger: { error() {} } });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = async (route, body) => {
      const response = await fetch(
        `${origin}/api/sync/${route}`,
        body === undefined
          ? {}
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            }
      );
      return { status: response.status, body: await response.json() };
    };
    const success = async (route, body) => {
      const response = await request(route, body);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert(response.body.data);
      return response.body.data;
    };
    const snapshot = async () => {
      const start = await success('bootstrap', syncContract());
      const page = await success(`snapshot?${syncContractQuery()}&snapshotId=${start.snapshotId}&limit=200`);
      assert.equal(page.nextOffset, null);
      await success('snapshot-release', { snapshotId: start.snapshotId });
      return { ...start, entries: page.entries };
    };
    let sequence = 0;
    const operation = (boundary, entry, value, action, deviceId = 'synthetic-desktop') => ({
      ...syncContract(),
      protocolVersion: 2,
      datasetEpoch: boundary.datasetEpoch,
      deviceId,
      operationId: `synthetic-lifecycle-${++sequence}`,
      sequence,
      changes: [
        {
          collection: entry.collection,
          id: entry.id,
          baseRevision: entry.revision,
          value,
          ...(action ? { lifecycleAction: action } : {})
        }
      ],
      dependencies: []
    });
    const journal = async () =>
      structuredClone(
        store
          ? store.getSyncJournal()
          : (await app.prisma.syncJournal.findUnique({ where: { ownerId: 'demo' } })).payload
      );
    const capture = async ({ item, objective, question }) =>
      structuredClone({
        item: await knowledge.repositories.knowledgeItemRepository.findById(item.id),
        objective: objective ? await knowledge.repositories.learningObjectiveRepository.findById(objective.id) : null,
        question: question ? await knowledge.questionService.getQuestion(question.id) : null,
        evidence: await knowledge.repositories.knowledgeEvidenceRepository.list({ knowledgeItemId: item.id }),
        journal: await journal()
      });
    await run({ app, knowledge, request, success, snapshot, operation, capture, journal });
  } finally {
    try {
      if (server?.listening) await new Promise(resolve => server.close(resolve));
    } finally {
      try {
        await app?.close?.();
      } finally {
        try {
          await database?.close();
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    }
  }
}

async function seed(knowledge, { downstream = false, archived = false } = {}) {
  const { item: candidate } = await knowledge.knowledgeItemService.createCandidate({
    id: 'synthetic-knowledge',
    title: '合成生命周期知识',
    canonicalStatement: '人工合成的知识声明',
    sourceMode: 'manual'
  });
  let item = await knowledge.knowledgeItemService.confirmItem(candidate.id, { expectedUpdatedAt: candidate.updatedAt });
  let objective, question;
  if (downstream) {
    const proposed = await knowledge.learningObjectiveService.createCandidate({
      id: 'synthetic-objective',
      knowledgeItemId: item.id,
      objective: '能够解释合成知识',
      actionVerb: 'explain',
      cognitiveLevel: 'understand',
      reviewBaseline: { knowledgeUpdatedAt: item.updatedAt }
    });
    objective = await knowledge.learningObjectiveService.confirmObjective(proposed.id, {
      reviewBaseline: { objectiveUpdatedAt: proposed.updatedAt, knowledgeUpdatedAt: item.updatedAt }
    });
    question = await knowledge.questionService.createQuestion({
      id: 'synthetic-question',
      questionType: 'shortAnswer',
      stem: '请解释合成知识',
      referenceAnswer: '人工合成的知识声明',
      learningObjectiveIds: [objective.id],
      sources: [{ sourceType: 'knowledgeItem', sourceId: item.id, quote: item.canonicalStatement }]
    });
    await knowledge.questionService.validateQuestion(question.id);
    question = await knowledge.questionService.confirmQuestion(question.id);
  }
  if (archived) item = await knowledge.knowledgeItemService.archive(item.id, { expectedUpdatedAt: item.updatedAt });
  return { item, objective, question };
}

const entryFor = (boundary, collection, id) => {
  const entry = boundary.entries.find(value => value.collection === collection && value.id === id);
  assert(entry, `${collection}/${id} 必须出现在权威快照`);
  return entry;
};
const trashValue = entry => ({ ...entry.value, deletedAt: '2026-10-03T00:00:00.000Z' });
const assertDownstreamCandidate = state => {
  assert.equal(state.objective.reviewStatus, 'candidate');
  assert.equal(state.question.reviewStatus, 'candidate');
};

function parityTests(driver) {
  return [
    {
      name: `桌面知识云端 ${driver}：显式回收/恢复、修订与目标/题失效作为一个同步组提交`,
      async run() {
        await fixture(driver, async f => {
          const assets = await seed(f.knowledge, { downstream: true });
          const boundary = await f.snapshot();
          const initial = entryFor(boundary, 'knowledgeItems', assets.item.id);
          const missingAction = f.operation(boundary, initial, trashValue(initial));
          const missingRevision = f.operation(boundary, initial, trashValue(initial), 'trash');
          delete missingRevision.changes[0].baseRevision;
          for (const [op, code] of [
            [missingAction, 'SYNC_LIFECYCLE_ACTION_REQUIRED'],
            [missingRevision, 'SYNC_BATCH_INVALID']
          ]) {
            const before = await f.capture(assets);
            const rejected = await f.request('batch', op);
            assert.equal(rejected.status, 422);
            assert.equal(rejected.body.error.code, code);
            assert.deepEqual(await f.capture(assets), before);
          }
          const op = f.operation(boundary, initial, trashValue(initial), 'trash');
          const accepted = await f.success('batch', op);
          assert.equal(accepted.status, 'accepted');
          const trashed = accepted.entries[0];
          assert(trashed.value.deletedAt);
          assert(trashed.revision > initial.revision);
          const state = await f.capture(assets);
          assertDownstreamCandidate(state);
          assert.equal(state.question.sources[0].status, 'stale');
          assert.equal(
            (await f.knowledge.knowledgeItemService.listItems()).some(item => item.id === assets.item.id),
            false
          );
          const changes = await f.success(
            `changes?${syncContractQuery()}&cursor=${encodeURIComponent(boundary.cursor)}&limit=1`
          );
          assert.equal(changes.groups.length, 1);
          assert.equal(changes.hasMore, false);
          for (const [collection, id] of [
            ['knowledgeItems', assets.item.id],
            ['learningObjectives', assets.objective.id],
            ['questions', assets.question.id],
            ['questionSources', state.question.sources[0].id]
          ]) {
            const changed = changes.groups[0].items.find(item => item.collection === collection && item.id === id);
            assert(changed, `同一事务组缺少 ${collection}/${id}`);
            assert(changed.revision > entryFor(boundary, collection, id).revision);
          }
          assert.deepEqual(await f.success('batch', op), accepted, '响应丢失重试返回原回执');
          assert.deepEqual(await f.capture(assets), state, '重试不产生第二个日志组或修订');
          const implicitRestore = f.operation(boundary, trashed, { ...trashed.value, deletedAt: null });
          const rejected = await f.request('batch', implicitRestore);
          assert.equal(rejected.status, 422);
          assert.equal(rejected.body.error.code, 'SYNC_LIFECYCLE_ACTION_REQUIRED');
          assert.deepEqual(await f.capture(assets), state);
          const restored = await f.success(
            'batch',
            f.operation(boundary, trashed, { ...trashed.value, deletedAt: null }, 'restore')
          );
          assert.equal(restored.status, 'accepted');
          assert.equal(restored.entries[0].value.deletedAt, null);
          assert(restored.entries[0].revision > trashed.revision);
          const afterRestore = await f.capture(assets);
          assert.equal(afterRestore.item.reviewStatus, 'confirmed', '有效人工知识保留既有审核语义');
          assertDownstreamCandidate(afterRestore);
          assert.equal(afterRestore.objective.id, assets.objective.id);
          assert.equal(afterRestore.question.id, assets.question.id);
          const late = await f.success(
            'batch',
            f.operation(boundary, initial, trashValue(initial), 'trash', 'synthetic-old-device')
          );
          assert.equal(late.status, 'conflict');
          assert.equal(late.conflicts[0].value.deletedAt, null);
          assert.equal(late.conflicts[0].revision, restored.entries[0].revision);
          const final = await f.capture(assets);
          assert.deepEqual(final.item, afterRestore.item);
          assertDownstreamCandidate(final);
          assert.equal(final.journal.head, afterRestore.journal.head, '旧删除只能留下冲突回执，不能产生业务变更');
        });
      }
    },
    {
      name: `桌面知识云端 ${driver}：归档知识回收后显式恢复保留归档`,
      async run() {
        await fixture(driver, async f => {
          const assets = await seed(f.knowledge, { archived: true });
          const boundary = await f.snapshot(),
            entry = entryFor(boundary, 'knowledgeItems', assets.item.id);
          const deleted = await f.success('batch', f.operation(boundary, entry, trashValue(entry), 'trash'));
          assert.equal(deleted.entries[0].value.reviewStatus, 'archived');
          const restored = await f.success(
            'batch',
            f.operation(boundary, deleted.entries[0], { ...deleted.entries[0].value, deletedAt: null }, 'restore')
          );
          assert.equal(restored.entries[0].value.deletedAt, null);
          assert.equal(restored.entries[0].value.reviewStatus, 'archived');
          assert(restored.entries[0].revision > deleted.entries[0].revision);
          assert.equal((await f.capture(assets)).item.reviewStatus, 'archived');
        });
      }
    },
    {
      name: `桌面知识云端 ${driver}：永久删除墓碑禁止通过恢复或空基线重建原 ID`,
      async run() {
        await fixture(driver, async f => {
          const assets = await seed(f.knowledge);
          const boundary = await f.snapshot(),
            entry = entryFor(boundary, 'knowledgeItems', assets.item.id);
          const deleted = await f.knowledge.knowledgeItemService.trash(assets.item.id, {
            expectedUpdatedAt: assets.item.updatedAt
          });
          assert.equal(
            (await f.knowledge.permanentlyDeleteKnowledgeItem(assets.item.id, { expectedUpdatedAt: deleted.updatedAt }))
              .status,
            'subject-purged'
          );
          const before = await f.capture(assets);
          assert.equal(before.item, null);
          assert(before.journal.tombstones[JSON.stringify(['knowledgeItems', assets.item.id])]);
          for (const baseRevision of [entry.revision, null]) {
            const op = f.operation(
              boundary,
              { ...entry, revision: baseRevision },
              { ...entry.value, deletedAt: null },
              'restore'
            );
            const response = await f.request('batch', op);
            assert.equal(response.status, 409);
            assert.equal(response.body.error.code, 'ENTITY_DELETED');
            assert.deepEqual(await f.capture(assets), before);
          }
          await assert.rejects(async () => f.knowledge.knowledgeItemService.restoreDeleted(assets.item.id), {
            code: 'KNOWLEDGE_ITEM_NOT_IN_TRASH'
          });
          assert.deepEqual(await f.capture(assets), before);
        });
      }
    }
  ];
}

// 三个故障点都由独立 schema 中的真实 SQL trigger 抛错；不替换领域回调或事务实现。
async function withFailureTrigger(app, table, name, predicate, run) {
  await app.prisma.$executeRawUnsafe(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF ${predicate} THEN RAISE EXCEPTION '${name}'; END IF; RETURN NEW; END $$`);
  await app.prisma.$executeRawUnsafe(
    `CREATE TRIGGER ${name} BEFORE INSERT OR UPDATE ON "${table}" FOR EACH ROW EXECUTE FUNCTION ${name}()`
  );
  try {
    await run();
  } finally {
    await app.prisma.$executeRawUnsafe(`DROP TRIGGER ${name} ON "${table}"`);
    await app.prisma.$executeRawUnsafe(`DROP FUNCTION ${name}()`);
  }
}
const injected = marker => error => {
  const seen = new Set();
  for (let cause = error; cause && !seen.has(cause); cause = cause.cause) {
    seen.add(cause);
    if (String(cause.message).includes(marker) || JSON.stringify(cause.meta ?? {}).includes(marker)) return true;
  }
  return false;
};

export const desktopKnowledgeLifecycleTests = parityTests('JSON');
// 无 URL 时为 0 项，必须分别记录；只有 CI 提供 URL + ALLOW_WRITES + 已生成 client 才真实执行。
export const desktopKnowledgeLifecyclePostgresTests = process.env.KNOWRA_SYNC_TEST_DATABASE_URL
  ? [
      ...parityTests('PostgreSQL'),
      ...[
        {
          table: 'Question',
          marker: 'desktop_knowledge_question_failure',
          predicate: 'NEW."reviewStatus" = \'candidate\'',
          callback: false,
          description: '关联题目写入故障回滚父项、目标、来源、修订和幂等回执'
        },
        {
          table: 'SyncJournal',
          marker: 'desktop_knowledge_journal_failure',
          predicate: 'TRUE',
          callback: false,
          description: '日志写入故障回滚业务、修订和幂等回执，同一请求可重试'
        },
        {
          table: 'QuestionSource',
          marker: 'desktop_knowledge_callback_failure',
          predicate: "NEW.\"sourceType\" = 'knowledgeItem' AND NEW.status = 'stale'",
          callback: true,
          description: '领域失效回调中的来源写入故障回滚父项、目标和题目'
        }
      ].map(({ table, marker, predicate, callback, description }) => ({
        name: `桌面知识云端真实 PostgreSQL：${description}`,
        async run() {
          await fixture('PostgreSQL', async f => {
            const assets = await seed(f.knowledge, { downstream: true });
            const boundary = await f.snapshot(),
              entry = entryFor(boundary, 'knowledgeItems', assets.item.id);
            const op = f.operation(boundary, entry, trashValue(entry), 'trash');
            const before = await f.capture(assets);
            const execute = () =>
              callback
                ? f.knowledge.knowledgeItemService.trash(assets.item.id, { expectedUpdatedAt: assets.item.updatedAt })
                : f.app.http.sync.pushBatch(op);
            await withFailureTrigger(f.app, table, marker, predicate, async () => {
              await assert.rejects(execute, injected(marker));
              assert.deepEqual(await f.capture(assets), before, '真实数据库故障后业务、关联、journal及回执完全回滚');
            });
            if (callback) assert((await execute()).deletedAt);
            else {
              const accepted = await f.success('batch', op);
              assert.equal(accepted.status, 'accepted');
              const committed = await f.capture(assets);
              assert.deepEqual(await f.success('batch', op), accepted);
              assert.deepEqual(await f.capture(assets), committed);
            }
            const after = await f.capture(assets);
            assertDownstreamCandidate(after);
            assert.equal(after.question.sources[0].status, 'stale');
            const groups = (
              await f.success(`changes?${syncContractQuery()}&cursor=${encodeURIComponent(boundary.cursor)}&limit=1`)
            ).groups;
            assert.equal(groups.length, 1);
            for (const id of [assets.item.id, assets.objective.id, assets.question.id])
              assert(groups[0].items.some(item => item.id === id));
          });
        }
      }))
    ]
  : [];

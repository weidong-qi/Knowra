import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { temporaryDirectory } from './helpers.mjs';
import { createSqliteDataStore } from '../src/sqlite-data-store.mjs';
import { createAppContext } from '../../api/src/app.factory.ts';
import {
  createExtractionTaskSources,
  extractionTaskGateway,
  quietTaskLogger
} from '../../api/test/fixtures/knowledge-extraction-task.fixture.js';
import {
  startExtractionHttpServer,
  callExtractionHttp as call
} from '../../api/test/fixtures/knowledge-extraction-http.fixture.js';

// 共享 HTTP 的 SQLite 合同，不经过/开放真实 desktop runtime 的 POST 白名单。
async function fixture(t, onCall) {
  const root = temporaryDirectory(t),
    file = path.join(root, 'local.sqlite');
  const mock = extractionTaskGateway(onCall),
    opened = [];
  let now = new Date('2026-10-02T12:00:00.000Z');
  async function open() {
    const store = createSqliteDataStore(file);
    const app = createAppContext({
      dataStore: store,
      ownerId: 'demo',
      storageRootDir: root,
      uploadsDir: path.join(root, 'uploads'),
      knowledgeExtractionMock: { gateway: mock.gateway, clock: () => now, schedule() {}, logger: quietTaskLogger }
    });
    const http = await startExtractionHttpServer(app);
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await http.close();
      await app.knowledgeExtractionTasks?.close();
      store.close();
    };
    opened.push(close);
    return { store, app, ...http, close };
  }
  t.after(async () => {
    for (const close of opened.reverse()) await close();
  });
  const host = await open();
  return {
    ...host,
    open,
    file,
    mock,
    advance: ms => {
      now = new Date(now.getTime() + ms);
    },
    ...(await createExtractionTaskSources(host.app))
  };
}
const list = (spaceId, tail = '') => `/jobs?kind=knowledgeExtraction&spaceId=${encodeURIComponent(spaceId)}${tail}`;

test('02C SQLite真实SQL分页限域、稳定游标与精确key；回读不经全量AIJob列表', async t => {
  const f = await fixture(t),
    ids = [];
  for (let i = 0; i < 5; i++) {
    const job = (
      await call(f.origin, '/jobs', { kind: 'knowledgeExtraction', ...f.input, idempotencyKey: `sqlite-page-${i}` })
    ).data.data;
    ids.push(job.jobId);
    await call(f.origin, `/jobs/${job.jobId}/cancel`, {});
  }
  const other = f.app.http.knowledge.createKnowledgeSpace({ name: '另一空间' });
  const original = f.store.aiRepository.list;
  f.store.aiRepository.list = (kind, ...args) => {
    assert.notEqual(kind, 'aiJob');
    return original(kind, ...args);
  };
  const result = [],
    cursors = [];
  let cursor = null;
  do {
    const page = await call(f.origin, list(f.space.id, `&limit=2${cursor ? `&cursor=${cursor}` : ''}`));
    assert.equal(page.status, 200);
    assert(page.data.data.items.length <= 2);
    result.push(...page.data.data.items.map(row => row.jobId));
    cursor = page.data.data.nextCursor;
    if (cursor) cursors.push(cursor);
  } while (cursor);
  assert.deepEqual(result, ids.sort().reverse());
  const directPage = f.store.knowledgeExtractionTaskStore.listPage({
    ownerId: 'demo',
    ...f.store.aiRepository.identity(),
    spaceId: f.space.id,
    limit: 2
  });
  assert.equal(directPage.length, 3); // SQL只取本页及一个has-more记录。
  assert.equal((await call(f.origin, list(other.id))).data.data.items.length, 0);
  assert.equal((await call(f.origin, list(other.id, `&cursor=${cursors[0]}`))).status, 422);
  assert.equal((await call(f.origin, list(f.space.id, '&idempotencyKey=sqlite-page-2'))).data.data.items.length, 1);
  assert.equal(
    (await call(f.origin, list(f.space.id, '&idempotencyKey=%27%20OR%201%3D1--'))).data.data.items.length,
    0
  );
  f.store.aiRepository.rotateEpoch();
  assert.equal((await call(f.origin, list(f.space.id))).data.data.items.length, 0);
  assert.equal((await call(f.origin, `/jobs/${ids[0]}`)).status, 404);
});

test('02C SQLite HTTP显式重试、时钟推进动作投影和成功候选重启回读', async t => {
  let fail = true;
  const f = await fixture(t, (_request, response) => {
    if (fail) throw new Error('private-response');
    return response;
  });
  const job = (await call(f.origin, '/jobs', { kind: 'knowledgeExtraction', ...f.input })).data.data;
  await assert.rejects(f.app.knowledgeExtractionTasks.run(job.jobId));
  const failed = (await call(f.origin, `/jobs/${job.jobId}`)).data.data;
  assert.equal(failed.actions.canRetry, true);
  assert.equal(JSON.stringify(failed).includes('private-response'), false);
  fail = false;
  assert.equal((await call(f.origin, `/jobs/${job.jobId}/retry`, {})).status, 202);
  await f.app.knowledgeExtractionTasks.idle();
  const done = (await call(f.origin, `/jobs/${job.jobId}`)).data.data;
  assert.equal(done.status, 'succeeded');
  assert.equal(done.actions.retryUnavailableReason, null);
  assert.equal(done.candidateIds.length, 1);
  await f.close();
  const reopened = await f.open();
  assert.deepEqual((await call(reopened.origin, `/jobs/${job.jobId}`)).data.data, done);
  assert.equal(f.mock.calls.length, 2);
  fail = true;
  const another = (
    await call(reopened.origin, '/jobs', { kind: 'knowledgeExtraction', ...f.input, idempotencyKey: 'expiry' })
  ).data.data;
  await assert.rejects(reopened.app.knowledgeExtractionTasks.run(another.jobId));
  f.advance(300_001);
  const expired = (await call(reopened.origin, `/jobs/${another.jobId}`)).data.data;
  assert.equal(expired.actions.canRetry, false);
  assert.equal(expired.actions.retryUnavailableReason.code, 'KNOWLEDGE_EXTRACTION_GRANT_INVALID');
  assert.equal((await call(reopened.origin, `/jobs/${another.jobId}/retry`, {})).status, 409);
});

test('02C SQLite私有描述损坏关闭任务HTTP，普通知识/笔记仍可维护', async t => {
  const f = await fixture(t);
  const job = (await call(f.origin, '/jobs', { kind: 'knowledgeExtraction', ...f.input })).data.data;
  await call(f.origin, `/jobs/${job.jobId}/cancel`, {});
  const raw = new DatabaseSync(f.file);
  try {
    raw.prepare('UPDATE ai_knowledge_extraction_tasks SET descriptor_json = ? WHERE job_id = ?').run('null', job.jobId);
  } finally {
    raw.close();
  }
  const broken = await call(f.origin, `/jobs/${job.jobId}`);
  assert.equal(broken.status, 503);
  assert.equal((await call(f.origin, '/capabilities')).data.data.knowledgeExtraction.canReadJobs, false);
  f.app.http.knowledge.updateNote({ id: f.note.id }, { title: '私有错误旁仍可保存' });
  assert.equal(f.store.state.notes.find(note => note.id === f.note.id).title, '私有错误旁仍可保存');
});

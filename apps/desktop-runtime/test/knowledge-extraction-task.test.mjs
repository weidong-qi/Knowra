import assert from 'node:assert/strict';
import { assertMinimalProvenanceTransport } from '../../api/test/fixtures/knowledge-artifact-provenance.fixture.js';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { temporaryDirectory } from './helpers.mjs';
import { createSqliteDataStore } from '../src/sqlite-data-store.mjs';
import { createRuntimeBackup, restoreRuntimeBackup } from '../src/backup.mjs';
import { createAppContext } from '../../api/src/app.factory.ts';
import { createExtractionTaskSources, extractionTaskGateway, deferredTaskResponse, quietTaskLogger } from '../../api/test/fixtures/knowledge-extraction-task.fixture.js';
import { assertCrossInstanceExtractionRetry, assertSameInstanceExtractionRetry } from '../../api/test/fixtures/knowledge-extraction-retry-scenarios.js';

async function fixture(t, options = {}) {
  const root = temporaryDirectory(t), file = path.join(root, 'local.sqlite'), opened = [];
  const mock = extractionTaskGateway(options.onCall);
  let time = new Date('2026-10-02T12:00:00.000Z');
  const open = (location = root, sharedStore = null) => {
    const store = sharedStore ?? createSqliteDataStore(path.join(location, 'local.sqlite'), options.storeOptions);
    const app = createAppContext({ dataStore: store, ownerId: 'demo', storageRootDir: location, uploadsDir: path.join(location, 'uploads'),
      knowledgeExtractionMock: { gateway: mock.gateway, clock: () => time, ...(options.auto ? {} : { schedule() {} }), logger: quietTaskLogger } });
    let closed = false;
    const close = async () => { if (closed) return; closed = true; await app.knowledgeExtractionTasks?.close(); if (!sharedStore) store.close(); };
    opened.push(close); return { app, store, service: app.knowledgeExtractionTasks, close };
  };
  t.after(async () => { for (const close of opened.reverse()) await close(); });
  const workspace = open();
  return { root, file, open, mock, ...workspace, advance: ms => { time = new Date(time.getTime() + ms); },
    ...await createExtractionTaskSources(workspace.app) };
}

test('02B SQLite start到接纳同库持久化；重启和完整备份保留描述及首份结果', async t => {
  const f = await fixture(t), job = await f.service.start(f.input);
  assert.equal(f.store.aiRepository.list('aiGrant').length, 1); assert.equal(f.store.state.knowledgeItems.length, 0);
  assert.deepEqual(await f.service.start(f.input), job);
  await f.service.idle(); const result = await f.service.get(job.jobId);
  assert.equal(result.status, 'succeeded'); assert.equal(f.mock.calls.length, 1);
  const queue = f.store.readOutbox();
  assertMinimalProvenanceTransport(queue, f.store.state.knowledgeArtifactProvenance[0]);
  const backup = createRuntimeBackup(f.store, f.root), restored = path.join(f.root, 'restored');
  restoreRuntimeBackup(backup, restored);
  const copy = f.open(restored); assert.deepEqual(await copy.service.start(f.input), result);
  assert.deepEqual(copy.store.readOutbox(), queue);
  assert.equal(await copy.service.recover(), 0);
  await f.close(); const reopened = f.open(); assert.deepEqual(await reopened.service.get(job.jobId), result);
  assert.equal(reopened.store.state.knowledgeItems.length, 1); assert.equal(reopened.store.state.knowledgeEvidence.length, 1);
});

test('02B SQLite 创建SQL/最终commit故障无孤儿，领取失败job与attempt一起回滚', async t => {
  for (const target of ['ai_grants', 'ai_knowledge_extraction_tasks', 'ai_job_attempts', 'commit']) await t.test(target, async t => {
    let failCommit = false;
    const f = await fixture(t, { storeOptions: { beforeCommit() { if (failCommit) throw new Error('injected task commit'); } } });
    const raw = new DatabaseSync(f.file); t.after(() => raw.close());
    const before = raw.prepare('SELECT count(*) AS count FROM sync_outbox').get().count;
    if (target !== 'commit') raw.exec(`CREATE TRIGGER fail_task BEFORE INSERT ON ${target} BEGIN SELECT RAISE(ABORT, 'injected task SQL'); END;`);
    if (target === 'ai_job_attempts') {
      const job = await f.service.start(f.input);
      const transact = f.store.knowledgeExtractionTaskStore.runTransaction;
      let rollbackObserved = false;
      f.store.knowledgeExtractionTaskStore.runTransaction = (...args) => {
        try { return transact(...args); } catch (error) {
          rollbackObserved = raw.prepare('SELECT status FROM ai_jobs WHERE job_id = ?').get(job.jobId).status === 'pending';
          throw error;
        }
      };
      await assert.rejects(f.service.run(job.jobId), /injected/);
      assert(rollbackObserved); assert.equal(f.store.aiRepository.list('aiJobAttempt').length, 0);
      assert.equal((await f.service.get(job.jobId)).status, 'failed');
    } else {
      if (target === 'commit') failCommit = true;
      await assert.rejects(f.service.start(f.input), /injected/);
      failCommit = false;
      for (const table of ['ai_scope_snapshots', 'ai_context_manifests', 'ai_grants', 'ai_jobs', 'ai_knowledge_extraction_tasks']) {
        assert.equal(raw.prepare(`SELECT count(*) AS count FROM ${table}`).get().count, 0);
      }
    }
    assert.equal(f.mock.calls.length, 0); assert.equal(f.store.state.knowledgeItems.length, 0);
    assert.equal(raw.prepare('SELECT count(*) AS count FROM sync_outbox').get().count, before);
  });
});

test('02B SQLite 双worker领取与取消提交失败回滚；持久取消拒绝晚到结果', async t => {
  const deferred = deferredTaskResponse(); let fail = false;
  const f = await fixture(t, { onCall: deferred.onCall, storeOptions: { beforeCommit() { if (fail) throw new Error('injected cancel'); } } });
  const job = await f.service.start(f.input), other = f.open(f.root, f.store);
  const running = f.service.run(job.jobId); const failed = assert.rejects(running);
  await deferred.called;
  await assert.rejects(other.service.run(job.jobId), { code: 'KNOWLEDGE_EXTRACTION_NOT_RUNNABLE' });
  fail = true; await assert.rejects(other.service.cancel(job.jobId), /injected cancel/); fail = false;
  assert.equal((await other.service.get(job.jobId)).status, 'running');
  assert.equal(f.store.aiRepository.list('aiJobAttempt')[0].status, 'sent');
  assert.equal((await other.service.cancel(job.jobId)).status, 'cancelled');
  deferred.release(); await failed;
  assert.equal(f.store.state.knowledgeItems.length, 0); assert.equal(f.mock.calls.length, 1);
});

test('02B SQLite 重启恢复与显式retry不重建grant，过期/旧epoch失去执行权', async t => {
  const f = await fixture(t), job = await f.service.start(f.input);
  await f.close(); const reopened = f.open();
  assert.equal(await reopened.service.recover(), 1); assert.equal(f.mock.calls.length, 0);
  await reopened.service.retry(job.jobId); await reopened.service.idle();
  assert.equal((await reopened.service.get(job.jobId)).status, 'succeeded');
  assert.equal(reopened.store.aiRepository.list('aiGrant').length, 1);
  const second = await createExtractionTaskSources(reopened.app, '-second');
  const pending = await reopened.service.start(second.input);
  f.advance(300001); await reopened.service.idle(); assert.equal((await reopened.service.get(pending.jobId)).status, 'failed');
  await assert.rejects(reopened.service.retry(pending.jobId), { code: 'KNOWLEDGE_EXTRACTION_GRANT_INVALID' });
  reopened.store.importSnapshot(reopened.store.exportSnapshot());
  await assert.rejects(reopened.service.get(job.jobId), { code: 'KNOWLEDGE_EXTRACTION_TASK_STALE' });
  assert.equal(await reopened.service.recover(), 0);
});

test('02B SQLite 恢复事务最后故障回滚job/attempt，活租约保留，过期后原子收尾', async t => {
  const deferred = deferredTaskResponse(); let fail = false;
  const f = await fixture(t, { onCall: deferred.onCall, storeOptions: { beforeCommit() { if (fail) throw new Error('injected recover'); } } });
  const job = await f.service.start(f.input), running = f.service.run(job.jobId), failed = assert.rejects(running);
  await deferred.called; assert.equal(await f.service.recover(), 0); f.advance(120001);
  fail = true; await assert.rejects(f.service.recover(), /injected recover/); fail = false;
  assert.equal((await f.service.get(job.jobId)).status, 'running'); assert.equal(f.store.aiRepository.list('aiJobAttempt')[0].status, 'sent');
  assert.equal(await f.service.recover(), 1); await failed; deferred.release();
  assert.equal((await f.service.get(job.jobId)).status, 'failed'); assert.equal(f.store.aiRepository.list('aiJobAttempt')[0].status, 'timedOut');
});

test('02B SQLite 提炼任务独立版本升级前备份；未来/损坏描述不阻断普通笔记', async t => {
  const f = await fixture(t), job = await f.service.start(f.input); await f.close();
  const raw = new DatabaseSync(f.file);
  const version = raw.prepare('PRAGMA user_version').get().user_version;
  raw.exec("UPDATE ai_knowledge_extraction_tasks SET descriptor_json = 'null'"); raw.close();
  const corrupt = f.open(); assert.equal(corrupt.service, null);
  corrupt.app.modules.knowledge.noteService.updateNote(f.note.id, { rawMarkdown: '仍然可以编辑' }); await corrupt.close();
  const check = new DatabaseSync(f.file);
  assert.equal(check.prepare('SELECT descriptor_json FROM ai_knowledge_extraction_tasks').get().descriptor_json, 'null');
  check.exec("DROP TABLE ai_knowledge_extraction_tasks; DELETE FROM metadata WHERE key = 'aiKnowledgeExtractionTasksVersion';"); check.close();
  const upgraded = f.open(); assert(upgraded.service); await upgraded.close();
  assert(fs.readdirSync(f.root).some(name => name.includes('.before-knowledge-extraction-tasks-v1-')));
  const future = new DatabaseSync(f.file); assert.equal(future.prepare('PRAGMA user_version').get().user_version, version);
  future.exec("UPDATE metadata SET value = '99' WHERE key = 'aiKnowledgeExtractionTasksVersion'"); future.close();
  assert.equal(f.open().service, null);
  assert(job.jobId);
});

test('02B SQLite 跨实例恢复/重试不被旧代迟到失败覆盖', async t => {
  const deferred = deferredTaskResponse(), f = await fixture(t, { onCall: deferred.onCall });
  try { await assertCrossInstanceExtractionRetry({ ...f, deferred, other: f.open(f.root, f.store).service }); }
  finally { deferred.release(); }
});

test('02B SQLite 默认调度保留同实例重试唤醒，取消不误重发', async t => {
  for (const cancel of [false, true]) await t.test(cancel ? 'cancel' : 'retry', async t => {
    const deferred = deferredTaskResponse(), f = await fixture(t, { auto: true, onCall: deferred.onCall });
    try { await assertSameInstanceExtractionRetry({ ...f, deferred, cancel }); }
    finally { deferred.release(); }
  });
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { createFileDataStore } from '../../apps/api/src/infrastructure/file-data-store.ts';
import { createAppContext } from '../../apps/api/src/app.factory.ts';
import { createServer } from '../../apps/api/src/server.ts';
import { ContentAnnotation } from '../../apps/api/src/modules/knowledge/domain/content-annotation.ts';
import { calculateContentHash } from '../../apps/api/src/modules/knowledge/domain/note-version.ts';
import { planHistoryRetention } from '../../apps/api/src/modules/knowledge/domain/history-retention.ts';
import { temporaryDirectory, openWorkspace } from '../../apps/desktop-runtime/test/helpers.mjs';
import { readRetirementInspection } from '../inspect-inline-annotation-retirement.mjs';
import { planV1AnnotationMaintenance, prepareV1AnnotationMaintenance } from '../prepare-v1-annotation-maintenance.mjs';

const DAY = 86400000;
async function fixture(t) {
  const root = temporaryDirectory(t);
  const cloudSource = path.join(root, 'cloud.json');
  const store = createFileDataStore(cloudSource);
  const context = createAppContext({ dataStore: store, storageRootDir: root, uploadsDir: path.join(root, 'uploads') });
  const knowledge = context.modules.knowledge;
  const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const note = knowledge.noteService.createNote({ title: '秘密笔记', rawMarkdown: '甲乙\n', spaceId: space.id });
  const version = knowledge.noteVersionService.listVersions({ noteId: note.id })[0];
  knowledge.noteService.deleteNote(note.id);
  const row = new ContentAnnotation({
    id: 'sensitive-v1-id',
    noteId: note.id,
    noteVersionId: version.id,
    spaceId: space.id,
    schemaVersion: 1,
    status: 'stale',
    revision: 3,
    quoteText: '甲乙',
    fromPosition: 1,
    toPosition: 3,
    anchorFingerprint: 'old-v1',
    noteContentHash: version.contentHash,
    idempotencyKey: 'old-v1'
  });
  const now = Date.now();
  const oldVersion = {
    ...version,
    id: 'sensitive-old-version',
    content: '更早的原文',
    contentHash: calculateContentHash('更早的原文'),
    createdAt: new Date(now - 31 * DAY).toISOString()
  };
  const oldRevision = {
    id: 'annotation-revision-sensitive-old',
    annotationId: row.id,
    revision: 1,
    operation: 'metadataUpdated',
    oldAnchor: null,
    newAnchor: null,
    rangeSummary: { scopeType: 'selection', quoteText: row.quoteText },
    reason: null,
    createdAt: new Date(now - 8 * DAY).toISOString()
  };
  // 仅在合成 fixture 中绕过保留策略，重现正常同步带回的过期历史。
  store.runSyncBatchTransaction(() => {
    store.state.contentAnnotations.push(row);
    store.state.noteVersions.push(oldVersion);
    store.state.annotationRevisions.push(oldRevision);
  });
  const localRoot = path.join(root, 'local');
  const local = openWorkspace(localRoot);
  t.after(() => local.store.close());
  local.store.runTransaction(
    () => {
      for (const key of ['spaces', 'notes', 'noteVersions', 'contentAnnotations', 'annotationRevisions'])
        local.store.state[key].splice(0, local.store.state[key].length, ...structuredClone(store.state[key]));
    },
    { origin: 'sync-resolution' }
  );
  local.store.syncTransaction(db => db.prepare('UPDATE sync_outbox SET state = ?').run('acknowledged'));
  const cloud = await readRetirementInspection('local-json', cloudSource);
  const device = await readRetirementInspection('sqlite', path.join(localRoot, 'local.sqlite'));
  return { root, cloudSource, localRoot, local, cloud, device, row, now, oldVersion, oldRevision, store, context };
}

test('完整 JSON/SQLite 快照的过期历史阻塞请求；预演与标准 HTTP DELETE 的裁剪结果一致', async t => {
  const f = await fixture(t);
  const before = structuredClone([f.cloud, f.device]);
  const cloudBytes = fs.readFileSync(f.cloudSource);
  const sqliteBytes = fs.readFileSync(path.join(f.localRoot, 'local.sqlite'));
  const outputDirectory = path.join(f.root, 'bundle');
  const report = await prepareV1AnnotationMaintenance({
    cloudSource: f.cloudSource,
    localRoot: f.localRoot,
    outputDirectory
  });
  assert.equal(report.status, 'blocked');
  assert.deepEqual(report.blockers, ['history-retention-side-effects']);
  assert.deepEqual(report.retentionPreview, {
    annotationRevisions: 0,
    noteVersions: 1,
    contentAnnotations: 0,
    annotationExclusions: 0
  });
  assert.equal(JSON.parse(fs.readFileSync(path.join(outputDirectory, 'plan.json'))).request, null);
  assert.deepEqual(fs.readFileSync(f.cloudSource), cloudBytes);
  assert.deepEqual(fs.readFileSync(path.join(f.localRoot, 'local.sqlite')), sqliteBytes);
  assert.deepEqual(structuredClone([f.cloud, f.device]), before);
  const saved = await readRetirementInspection('sqlite', path.join(outputDirectory, 'local.sqlite'));
  assert.deepEqual(saved.state.noteVersions, f.device.state.noteVersions);
  assert.deepEqual(saved.state.annotationRevisions, f.device.state.annotationRevisions);
  for (const secret of [f.row.id, f.oldVersion.id, f.oldRevision.id, '秘密笔记', '更早的原文', f.root])
    assert.equal(JSON.stringify(report).includes(secret), false);

  // 只向合成资料的临时 HTTP 服务发送原本会生成的请求，验证实际危险副作用。
  const server = createServer({ appContext: f.context, logger: { error: console.error } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/knowledge/annotations/${f.row.id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision: f.row.revision })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.revision, f.row.revision + 1);
  const persisted = await readRetirementInspection('local-json', f.cloudSource);
  for (const collection of Object.keys(report.retentionPreview)) {
    const remaining = new Set(persisted.state[collection].map(row => row.id));
    assert.equal(
      f.cloud.state[collection].filter(row => !remaining.has(row.id)).length,
      report.retentionPreview[collection]
    );
  }
  assert.deepEqual(persisted.state.notes, f.cloud.state.notes);
});

test('取消旧重点后仍保全原修订，不把留存到期当成删除许可', async t => {
  const f = await fixture(t);
  for (const inspection of [f.cloud, f.device]) {
    inspection.state.noteVersions = inspection.state.noteVersions.filter(row => row.id !== f.oldVersion.id);
    inspection.state.annotationRevisions[0].revision = f.row.revision;
  }
  assert.equal(planHistoryRetention(f.cloud.state, { now: f.now }).removedRevisions.size, 0);
  const result = planV1AnnotationMaintenance(f.cloud, f.device, f.now);
  assert.equal(result.report.status, 'ready-for-maintenance-window');
  assert.equal(result.report.retentionPreview.annotationRevisions, 0);
  assert.equal(result.request.method, 'DELETE');
});

test('预演保全同笔记其他已取消旧重点及其修订、排除区间', async t => {
  const f = await fixture(t);
  for (const inspection of [f.cloud, f.device]) {
    inspection.state.contentAnnotations.push({
      ...f.row,
      id: 'expired-sibling',
      lifecycleStatus: 'deleted',
      deletedAt: new Date(f.now - 8 * DAY).toISOString()
    });
    inspection.state.annotationRevisions.push({
      ...f.oldRevision,
      id: 'expired-sibling-revision',
      annotationId: 'expired-sibling'
    });
    (inspection.state.annotationExclusions ??= []).push({
      id: 'expired-sibling-exclusion',
      parentAnnotationId: 'expired-sibling'
    });
  }
  const result = planV1AnnotationMaintenance(f.cloud, f.device, f.now);
  assert.equal(result.request, null);
  assert.deepEqual(result.report.retentionPreview, {
    annotationRevisions: 0,
    noteVersions: 1,
    contentAnnotations: 0,
    annotationExclusions: 0
  });
});

test('只预演本次提交涉及的笔记，不因其他笔记过期历史而误阻塞', async t => {
  const f = await fixture(t);
  for (const inspection of [f.cloud, f.device]) {
    inspection.state.annotationRevisions = [];
    inspection.state.notes.push({ ...inspection.state.notes[0], id: 'unrelated-note' });
    inspection.state.noteVersions.find(row => row.id === f.oldVersion.id).noteId = 'unrelated-note';
  }
  const result = planV1AnnotationMaintenance(f.cloud, f.device, f.now);
  assert.equal(result.report.status, 'ready-for-maintenance-window');
  assert.equal(result.request.method, 'DELETE');
  assert(Object.values(result.report.retentionPreview).every(count => count === 0));
});

test('复用保留期限的严格边界，时间变化后须重新预检', async t => {
  const f = await fixture(t);
  for (const inspection of [f.cloud, f.device]) {
    inspection.state.noteVersions.find(row => row.id === f.oldVersion.id).createdAt = new Date(
      f.now - 30 * DAY
    ).toISOString();
    inspection.state.annotationRevisions[0].createdAt = new Date(f.now - 7 * DAY).toISOString();
  }
  assert.equal(planV1AnnotationMaintenance(f.cloud, f.device, f.now).report.status, 'ready-for-maintenance-window');
  const result = planV1AnnotationMaintenance(f.cloud, f.device, f.now + 1);
  assert.equal(result.report.status, 'blocked');
  assert.equal(result.report.retentionPreview.noteVersions, 1);
  assert.equal(result.report.retentionPreview.annotationRevisions, 0);
  assert.equal(result.request, null);
});

test('云端私有引用遵循持久化保留根，任务工作区副本不能掩盖实际裁剪', async t => {
  const f = await fixture(t);
  const records = [{ noteVersionId: f.oldVersion.id, annotationRevisionId: f.oldRevision.id }];
  f.cloud.privateSources = [{ name: 'json.aiRuntime', records }];
  const before = structuredClone(f.cloud);
  assert.equal(planV1AnnotationMaintenance(f.cloud, f.device, f.now).report.status, 'ready-for-maintenance-window');
  assert.deepEqual(f.cloud, before);
  f.cloud.privateSources = [{ name: 'json.taskWorkspaces', records }];
  assert.equal(planV1AnnotationMaintenance(f.cloud, f.device, f.now).request, null);
});

test('旧重点的原修订超过普通数量上限也保全，取消后不额外裁剪', async t => {
  const f = await fixture(t);
  for (const inspection of [f.cloud, f.device]) {
    inspection.state.noteVersions = inspection.state.noteVersions.filter(row => row.id !== f.oldVersion.id);
    inspection.state.contentAnnotations[0].revision = 11;
    inspection.state.annotationRevisions = Array.from({ length: 11 }, (_, index) => ({
      ...f.oldRevision,
      id: `annotation-revision-count-${index}`,
      revision: index + 1,
      createdAt: new Date(f.now - (index + 1) * 60000).toISOString()
    }));
  }
  assert.equal(planHistoryRetention(f.cloud.state, { now: f.now }).removedRevisions.size, 0);
  const result = planV1AnnotationMaintenance(f.cloud, f.device, f.now);
  assert.equal(result.report.retentionPreview.annotationRevisions, 0);
  assert.equal(result.request.method, 'DELETE');
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createFileDataStore } from '../../apps/api/src/infrastructure/file-data-store.js';
import { createAppContext } from '../../apps/api/src/app.factory.js';
import { ContentAnnotation } from '../../apps/api/src/modules/knowledge/domain/content-annotation.ts';
import { temporaryDirectory, openWorkspace } from '../../apps/desktop-runtime/test/helpers.mjs';
import { readRetirementInspection } from '../inspect-inline-annotation-retirement.mjs';
import { planV1AnnotationMaintenance, prepareV1AnnotationMaintenance } from '../prepare-v1-annotation-maintenance.mjs';

const cli = fileURLToPath(new URL('../prepare-v1-annotation-maintenance.mjs', import.meta.url));
const now = Date.parse('2026-11-06T12:00:00Z');
async function fixture(t) {
  const root = temporaryDirectory(t);
  const cloudSource = path.join(root, 'cloud.json');
  const store = createFileDataStore(cloudSource);
  const {
    modules: { knowledge }
  } = createAppContext({ dataStore: store, storageRootDir: root, uploadsDir: path.join(root, 'uploads') });
  const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const note = knowledge.noteService.createNote({ title: '秘密笔记', rawMarkdown: '甲乙\n', spaceId: space.id });
  const version = knowledge.noteVersionService.listVersions({ noteId: note.id })[0];
  knowledge.noteService.deleteNote(note.id);
  const row = {
    ...new ContentAnnotation({
      id: 'sensitive-v1-id',
      noteId: note.id,
      noteVersionId: version.id,
      spaceId: space.id,
      schemaVersion: 1,
      status: 'stale',
      quoteText: '甲乙',
      fromPosition: 1,
      toPosition: 3,
      anchorFingerprint: 'old-v1',
      noteContentHash: version.contentHash,
      idempotencyKey: 'old-v1'
    })
  };
  delete row.lifecycleStatus;
  delete row.anchorStatus;
  knowledge.repositories.contentAnnotationRepository.save(row);
  const localRoot = path.join(root, 'local');
  const local = openWorkspace(localRoot);
  t.after(() => local.store.close());
  local.store.runTransaction(() => {
    for (const key of ['spaces', 'notes', 'noteVersions', 'contentAnnotations', 'annotationRevisions']) {
      local.store.state[key].splice(0, local.store.state[key].length, ...structuredClone(store.state[key]));
    }
  });
  const cloud = await readRetirementInspection('local-json', cloudSource);
  const device = await readRetirementInspection('sqlite', path.join(localRoot, 'local.sqlite'));
  // 本地造数据的 outbox 在真实同步前并未确认；纯计划用例显式清空扫描上下文。
  device.pendingSyncSources = [];
  return { root, cloudSource, localRoot, local, cloud, device, row };
}

test('单条回收站 v1 的双端完整快照生成标准取消请求，不改写原记录或公开私有内容', async t => {
  const f = await fixture(t);
  const before = JSON.stringify([f.cloud, f.device]);
  const { report, request } = planV1AnnotationMaintenance(f.cloud, f.device, now);
  assert.equal(report.status, 'ready-for-maintenance-window');
  assert.deepEqual(request, {
    method: 'DELETE',
    path: '/api/knowledge/annotations/sensitive-v1-id',
    body: { expectedRevision: 1 }
  });
  assert.equal(report.diagnosis.versionProjectedRangeMatches, false);
  for (const secret of ['sensitive-v1-id', '秘密笔记', '甲乙'])
    assert.equal(JSON.stringify(report).includes(secret), false);
  assert.equal(JSON.stringify([f.cloud, f.device]), before);
});

for (const [name, change, expected] of [
  [
    '任何待同步请求',
    f => {
      f.device.pendingSyncSources.push({ name: 'sqlite.sync_outbox', records: [{ unrelated: true }] });
    },
    'pending-sync'
  ],
  [
    '覆盖不完整',
    f => {
      f.device.coverage.privateRecords = 'unavailable-private-contract';
    },
    'incomplete-coverage'
  ],
  [
    '双端 revision 不同',
    f => {
      f.device.state.contentAnnotations[0].revision++;
    },
    'cloud-local-mismatch'
  ],
  [
    '父笔记移出回收站',
    f => {
      f.cloud.state.notes[0].deleted = false;
    },
    'source-evidence-changed'
  ],
  [
    '版本正文损坏',
    f => {
      f.cloud.state.noteVersions[0].content = '变化';
    },
    'source-evidence-changed'
  ],
  [
    '增加备注',
    f => {
      f.cloud.state.contentAnnotations[0].comment = '需要保留的备注';
    },
    'source-evidence-changed'
  ],
  [
    '重复摘录',
    f => {
      f.cloud.state.notes[0].rawMarkdown = '甲乙甲乙\n';
    },
    'source-evidence-changed'
  ],
  [
    '修复了范围',
    f => {
      f.cloud.state.contentAnnotations[0].fromPosition = 0;
      f.cloud.state.contentAnnotations[0].toPosition = 2;
    },
    'source-evidence-changed'
  ],
  [
    '多个活跃 v1',
    f => {
      f.cloud.state.contentAnnotations.push({ ...f.row, id: 'other-v1' });
    },
    'expected-one-active-v1'
  ],
  [
    '已取消 v1',
    f => {
      f.cloud.state.contentAnnotations[0].lifecycleStatus = 'deleted';
      f.cloud.state.contentAnnotations[0].deletedAt = new Date(now).toISOString();
    },
    'expected-one-active-v1'
  ],
  [
    '子修订受分析范围保护',
    f => {
      f.cloud.state.annotationRevisions = [{ id: 'protected-revision', annotationId: f.row.id, revision: 1 }];
      f.device.state.annotationRevisions = structuredClone(f.cloud.state.annotationRevisions);
      f.cloud.state.analysisScopeSnapshots = [{ annotationRevisionId: 'protected-revision' }];
    },
    'protected-core-reference'
  ]
])
  test(`${name}时不提供可执行请求`, async t => {
    const f = await fixture(t);
    change(f);
    const result = planV1AnnotationMaintenance(f.cloud, f.device, now);
    assert.equal(result.report.status, 'blocked');
    assert(result.report.blockers.includes(expected), JSON.stringify(result.report));
    assert.equal(result.request, null);
  });

test('历史引用和副本保留在原位置，不为通过预检而清空', async t => {
  const f = await fixture(t);
  f.device.privateSources.push({ name: 'sqlite.sync_recovery', records: [{ local: f.row }] });
  const before = structuredClone(f.device.privateSources);
  const result = planV1AnnotationMaintenance(f.cloud, f.device, now);
  assert.equal(result.report.status, 'ready-for-maintenance-window');
  assert.equal(result.report.privateHistory.localLegacyCopies, 1);
  assert.deepEqual(f.device.privateSources, before);
});

test('在线 SQLite 备份包含 WAL、待同步与私有历史，来源及活动指针不变，阻塞计划不含请求', async t => {
  const f = await fixture(t);
  f.local.store.syncTransaction(db =>
    db.prepare('INSERT INTO sync_recovery VALUES (?, ?)').run('saved-v1', JSON.stringify({ local: f.row }))
  );
  const source = path.join(f.localRoot, 'local.sqlite');
  const bytes = fs.readFileSync(source),
    cloudBytes = fs.readFileSync(f.cloudSource);
  const outputDirectory = path.join(f.root, 'bundle');
  const report = await prepareV1AnnotationMaintenance({
    cloudSource: f.cloudSource,
    localRoot: f.localRoot,
    outputDirectory
  });
  assert.equal(report.status, 'blocked');
  assert(report.blockers.includes('pending-sync'));
  assert.equal(report.privateHistory.localLegacyCopies, 1);
  assert.deepEqual(fs.readFileSync(source), bytes);
  assert.deepEqual(fs.readFileSync(f.cloudSource), cloudBytes);
  assert.equal(fs.existsSync(path.join(f.localRoot, 'active-dataset.json')), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(outputDirectory, 'plan.json')));
  assert.equal(manifest.request, null);
  for (const file of ['cloud.json', 'local.sqlite', 'plan.json', 'report.json']) {
    assert.equal(fs.statSync(path.join(outputDirectory, file)).mode & 0o777, 0o600);
  }
  assert.equal(fs.statSync(outputDirectory).mode & 0o777, 0o700);
  const saved = await readRetirementInspection('sqlite', path.join(outputDirectory, 'local.sqlite'));
  assert.deepEqual(saved.state.contentAnnotations, f.device.state.contentAnnotations);
  await assert.rejects(
    prepareV1AnnotationMaintenance({ cloudSource: f.cloudSource, localRoot: f.localRoot, outputDirectory })
  );
});

test('活动目录按恢复指针选择；CLI 阻塞返回 2，未知版本返回 1 且不打印私有值', async t => {
  const f = await fixture(t);
  const root = path.join(f.root, 'managed');
  fs.mkdirSync(root);
  fs.mkdirSync(path.join(root, 'restored'));
  fs.symlinkSync(f.localRoot, path.join(root, 'not-used')); // 不被选择的目录不影响指针。
  fs.mkdirSync(path.join(root, 'restored', 'abc-123'));
  f.local.store.backupTo(path.join(root, 'restored', 'abc-123', 'local.sqlite'));
  const pointer = JSON.stringify({ version: 1, directory: 'restored/abc-123' });
  fs.writeFileSync(path.join(root, 'active-dataset.json'), pointer);
  const run = output =>
    spawnSync(
      process.execPath,
      [cli, `--cloud-source=${f.cloudSource}`, `--local-root=${root}`, `--output-dir=${path.join(f.root, output)}`],
      { encoding: 'utf8' }
    );
  const blocked = run('blocked-cli');
  assert.equal(blocked.status, 2, blocked.stderr);
  assert.equal(JSON.parse(blocked.stdout).status, 'blocked');
  assert.equal(fs.readFileSync(path.join(root, 'active-dataset.json'), 'utf8'), pointer);
  const document = JSON.parse(fs.readFileSync(f.cloudSource));
  document.schemaVersion = 999;
  fs.writeFileSync(f.cloudSource, JSON.stringify(document));
  const bad = run('bad-cli');
  assert.equal(bad.status, 1);
  for (const secret of ['sensitive-v1-id', '秘密笔记', '甲乙'])
    assert.equal((bad.stdout + bad.stderr + blocked.stdout).includes(secret), false);
  assert.equal(fs.existsSync(path.join(f.root, 'bad-cli', 'plan.json')), false);
});

test('对象键和关联修订存储顺序不同时，双端仍能比对；未知私有版本不能生成计划', async t => {
  const f = await fixture(t);
  const revisions = [
    { id: 'rev-b', annotationId: f.row.id, revision: 2 },
    { id: 'rev-a', annotationId: f.row.id, revision: 1 }
  ];
  f.cloud.state.annotationRevisions = revisions;
  f.device.state.annotationRevisions = structuredClone(revisions.toReversed());
  f.device.state.contentAnnotations[0] = Object.fromEntries(
    Object.entries(f.device.state.contentAnnotations[0]).reverse()
  );
  assert.equal(planV1AnnotationMaintenance(f.cloud, f.device, now).report.status, 'ready-for-maintenance-window');
  f.local.store.syncTransaction(db =>
    db.prepare('INSERT INTO metadata VALUES (?, ?)').run('futurePrivateHistoryVersion', '999')
  );
  const outputDirectory = path.join(f.root, 'future-private');
  await assert.rejects(
    prepareV1AnnotationMaintenance({ cloudSource: f.cloudSource, localRoot: f.localRoot, outputDirectory })
  );
  assert.equal(fs.existsSync(path.join(outputDirectory, 'plan.json')), false);
  assert.equal(fs.existsSync(path.join(outputDirectory, 'local.sqlite')), true);
});

test('无待同步的 CLI 预检返回 0，但只在私有计划保存请求，并不调用 API', async t => {
  const f = await fixture(t);
  // 仅在合成资料中模拟已正常确认的队列，生产工具没有清空/确认队列能力。
  f.local.store.syncTransaction(db => db.prepare('UPDATE sync_outbox SET state = ?').run('acknowledged'));
  const outputDirectory = path.join(f.root, 'ready-cli');
  const result = spawnSync(
    process.execPath,
    [cli, `--cloud-source=${f.cloudSource}`, `--local-root=${f.localRoot}`, `--output-dir=${outputDirectory}`],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'ready-for-maintenance-window');
  assert.equal(result.stdout.includes('sensitive-v1-id'), false);
  const plan = JSON.parse(fs.readFileSync(path.join(outputDirectory, 'plan.json')));
  assert.equal(plan.request.body.expectedRevision, 1);
  assert.equal(plan.scope, 'two-snapshots-only');
  const unchanged = await readRetirementInspection('local-json', f.cloudSource);
  assert.deepEqual(unchanged.state.contentAnnotations, f.cloud.state.contentAnnotations);
  assert.equal(f.local.store.state.contentAnnotations[0].lifecycleStatus, undefined);
});

test('真实 v1 没有 revision 时沿用仓储只读默认 1，未知 revision 仍阻塞，不回写默认值', async t => {
  const f = await fixture(t);
  delete f.cloud.state.contentAnnotations[0].revision;
  delete f.device.state.contentAnnotations[0].revision;
  const result = planV1AnnotationMaintenance(f.cloud, f.device, now);
  assert.equal(result.report.status, 'ready-for-maintenance-window');
  assert.equal(result.request.body.expectedRevision, 1);
  assert.equal(Object.hasOwn(f.cloud.state.contentAnnotations[0], 'revision'), false);
  for (const invalid of [0, -1, '1', 1.5, 'future']) {
    f.cloud.state.contentAnnotations[0].revision = invalid;
    const rejected = planV1AnnotationMaintenance(f.cloud, f.device, now);
    assert.equal(rejected.report.status, 'blocked');
    assert.equal(rejected.request, null);
  }
});

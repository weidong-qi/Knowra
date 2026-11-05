import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { inspectAnnotationRetirement, readRetirementSource } from '../inspect-inline-annotation-retirement.mjs';
import { planHistoryRetention } from '../../apps/api/src/modules/knowledge/domain/history-retention.ts';
import { LOCAL_DATABASE_VERSION } from '../../apps/desktop-runtime/src/sqlite-schema.mjs';
import { LOCAL_DATA_SCHEMA_VERSION } from '../../apps/api/src/infrastructure/local-data-schema.js';

const cli = fileURLToPath(new URL('../inspect-inline-annotation-retirement.mjs', import.meta.url));
const now = Date.parse('2026-11-06T00:00:00Z');
const sample = () => ({
  notes: [
    { id: 'note-trash', deleted: true },
    { id: 'note-active', deleted: false }
  ],
  contentAnnotations: [
    { id: 'old-active', noteId: 'note-trash', status: 'stale' },
    {
      id: 'old-deleted',
      noteId: 'note-active',
      schemaVersion: 2,
      lifecycleStatus: 'deleted',
      deletedAt: '2026-11-01T00:00:00Z'
    },
    { id: 'new-mark', noteId: 'note-active', schemaVersion: 3 }
  ],
  knowledgeEvidence: [{ annotationId: 'old-active', quoteText: '秘密摘录' }],
  analysisScopeSnapshots: [{ segments: [{ annotationId: 'old-deleted' }] }],
  annotationRevisions: [{ id: 'annotation-revision-old', annotationId: 'old-active' }],
  annotationExclusions: [{ id: 'exclusion-old', parentAnnotationId: 'old-deleted' }]
});

function createSqliteSource(
  source,
  state,
  {
    databaseVersion = LOCAL_DATABASE_VERSION,
    schemaVersion = String(LOCAL_DATA_SCHEMA_VERSION),
    omitSchema = false
  } = {}
) {
  const db = new DatabaseSync(source);
  try {
    db.exec(
      `CREATE TABLE entities(collection TEXT, payload TEXT); CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT); PRAGMA user_version = ${databaseVersion}`
    );
    if (!omitSchema) db.prepare('INSERT INTO metadata VALUES (?, ?)').run('localDataSchemaVersion', schemaVersion);
    const insert = db.prepare('INSERT INTO entities VALUES (?, ?)');
    for (const [collection, rows] of Object.entries(state))
      for (const row of rows) insert.run(collection, JSON.stringify(row));
  } finally {
    db.close();
  }
}

function runCli(driver, source) {
  return spawnSync(process.execPath, [cli, `--driver=${driver}`, `--source=${source}`], { encoding: 'utf8' });
}

test('旧行过了七天仍然阻止删字段，未取消的回收站重点不被视为已回收', () => {
  const state = sample();
  const before = structuredClone(state);
  const report = inspectAnnotationRetirement(state, now);
  assert.equal(report.status, 'legacy-rows-remain');
  assert.equal(report.legacy.total, 2);
  assert.equal(report.legacy.lifecycle.active, 1);
  assert.equal(report.legacy.inDeletedNotes, 1);
  assert.equal(report.legacy.retentionNotDue, 1);
  assert.equal(report.legacy.latestRetentionEnd, '2026-11-08T00:00:00.000Z');
  assert.equal(report.legacy.referencesByCollection.knowledgeEvidence, 1);
  assert.equal(report.legacy.referencesByCollection.analysisScopeSnapshots, 1);
  assert.equal(report.legacy.revisions, 1);
  assert.equal(report.legacy.exclusions, 1);
  assert.equal(JSON.stringify(report).includes('秘密摘录'), false);
  const overdue = inspectAnnotationRetirement(state, now + 10 * 86400000);
  assert.equal(overdue.legacy.retentionElapsed, 1);
  assert.equal(overdue.status, 'legacy-rows-remain');
  assert.deepEqual(state, before);
});

test('正文和版本中的迁移来源标识不被误算为回收保护引用', () => {
  const state = sample();
  state.knowledgeEvidence = [];
  state.analysisScopeSnapshots = [];
  state.notes[1].rawMarkdown = '<!--k new legacy-id=old-active-->正文';
  state.noteVersions = [{ content: 'old-deleted' }];
  assert.deepEqual(Object.keys(inspectAnnotationRetirement(state, now).legacy.referencesByCollection), []);
});

for (const driver of ['local-json', 'sqlite']) {
  test(`${driver} 使用原始只读源，CLI 报告与源字节均稳定且不发布业务写入`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-retirement-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, driver === 'sqlite' ? 'local.sqlite' : 'data.json');
    const state = sample();
    if (driver === 'local-json') fs.writeFileSync(source, JSON.stringify({ data: state }));
    else createSqliteSource(source, state);
    const bytes = fs.readFileSync(source);
    assert.equal(inspectAnnotationRetirement(await readRetirementSource(driver, source), now).legacy.total, 2);
    const result = spawnSync(process.execPath, [cli, `--driver=${driver}`, `--source=${source}`], { encoding: 'utf8' });
    assert.equal(result.status, 2, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, 'legacy-rows-remain');
    assert.equal(result.stdout.includes('秘密摘录'), false);
    assert.deepEqual(fs.readFileSync(source), bytes);
    assert.deepEqual(fs.readdirSync(root), [path.basename(source)]);
  });
}

test('缺集合、重复身份或未知格式不生成可继续清理的结论', () => {
  assert.throws(() => inspectAnnotationRetirement({}, now));
  const state = sample();
  state.contentAnnotations.push({ id: 'unknown', schemaVersion: 4 });
  assert.throws(() => inspectAnnotationRetirement(state, now));
  state.contentAnnotations.pop();
  state.contentAnnotations.push(state.contentAnnotations[0]);
  assert.throws(() => inspectAnnotationRetirement(state, now));
  const clear = inspectAnnotationRetirement({ notes: [], contentAnnotations: [] }, now);
  assert.equal(clear.status, 'no-legacy-rows');
  assert.equal(clear.scope, 'core-entities-only');
});

for (const [field, target] of [
  ['exclusionId', 'exclusion-old'],
  ['annotationRevisionId', 'annotation-revision-old'],
  ['annotationRevisionId', 'historical/revision/1']
]) {
  test(`分析范围只引用 ${field} (${target}) 时，存量检查与回收规划都识别保护关系`, () => {
    const state = {
      notes: [{ id: 'note-active', rawMarkdown: '正文' }],
      contentAnnotations: [
        {
          id: 'old-deleted',
          noteId: 'note-active',
          schemaVersion: 2,
          lifecycleStatus: 'deleted',
          deletedAt: '2026-10-01T00:00:00Z',
          revision: 1
        }
      ],
      annotationExclusions: [{ id: 'exclusion-old', parentAnnotationId: 'old-deleted' }],
      annotationRevisions: [
        {
          id: field === 'annotationRevisionId' ? target : 'annotation-revision-old',
          annotationId: 'old-deleted',
          revision: 1,
          createdAt: '2026-10-01T00:00:00Z'
        }
      ]
    };
    assert.equal(planHistoryRetention(state, { now }).removedAnnotations.has('old-deleted'), true);
    const references = [{ [field]: target }, { payload: JSON.stringify({ [field]: target }) }];
    if (!target.includes('/')) references.push({ text: target });
    for (const reference of references) {
      const referenced = { ...state, analysisScopeSnapshots: [{ segments: [reference] }] };
      assert.equal(planHistoryRetention(referenced, { now }).removedAnnotations.has('old-deleted'), false);
      const report = inspectAnnotationRetirement(referenced, now);
      assert.equal(report.legacy.referencesByCollection.analysisScopeSnapshots, 1);
      assert.equal(JSON.stringify(report).includes(target), false);
    }
  });
}

for (const [name, document] of [
  ['正文存储 schema', { schemaVersion: 999, notes: [], contentAnnotations: [] }],
  ['快照外层 schema', { schemaVersion: 999, data: { notes: [], contentAnnotations: [] } }],
  ['快照内层 schema', { data: { schemaVersion: 999, notes: [], contentAnnotations: [] } }],
  ['快照版本', { version: 'v999-local-json', data: { notes: [], contentAnnotations: [] } }]
]) {
  test(`JSON ${name} 未知时退出 1，不输出成功结论且源字节不变`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-retirement-version-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, 'data.json');
    fs.writeFileSync(source, JSON.stringify(document));
    const bytes = fs.readFileSync(source);
    const result = runCli('local-json', source);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '');
    assert.deepEqual(fs.readFileSync(source), bytes);
    assert.deepEqual(fs.readdirSync(root), ['data.json']);
  });
}

for (const [name, versions] of [
  ['物理库版本', { databaseVersion: 999 }],
  ['未标记物理库', { databaseVersion: 0 }],
  ['业务 schema', { schemaVersion: '999' }],
  ['非法业务 schema', { schemaVersion: '08' }]
]) {
  test(`SQLite ${name} 不支持时退出 1，不读取为无旧行且不迁移`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-retirement-version-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, 'local.sqlite');
    createSqliteSource(source, { notes: [], contentAnnotations: [] }, versions);
    const bytes = fs.readFileSync(source);
    const result = runCli('sqlite', source);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '');
    assert.deepEqual(fs.readFileSync(source), bytes);
    assert.deepEqual(fs.readdirSync(root), ['local.sqlite']);
  });
}

test('已知 JSON 版本、历史无版本 JSON 与受支持 SQLite 仍可只读核对，不进行迁移', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-retirement-supported-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const empty = { notes: [], contentAnnotations: [] };
  const source = path.join(root, 'data.json');
  for (const version of [undefined, ...Array.from({ length: LOCAL_DATA_SCHEMA_VERSION }, (_, i) => i + 1)]) {
    fs.writeFileSync(source, JSON.stringify({ ...empty, schemaVersion: version }));
    assert.equal(
      inspectAnnotationRetirement(await readRetirementSource('local-json', source), now).status,
      'no-legacy-rows'
    );
  }
  for (const version of ['v1-local-json', 'v2-local-json']) {
    fs.writeFileSync(source, JSON.stringify({ version, schemaVersion: LOCAL_DATA_SCHEMA_VERSION, data: empty }));
    const result = runCli('local-json', source);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, 'no-legacy-rows');
  }
  for (const [index, versions] of [
    { databaseVersion: 1, schemaVersion: '1' },
    {},
    { databaseVersion: 3, omitSchema: true }
  ].entries()) {
    const sqlite = path.join(root, `supported-${index}.sqlite`);
    createSqliteSource(sqlite, empty, versions);
    const bytes = fs.readFileSync(sqlite);
    const state = await readRetirementSource('sqlite', sqlite);
    if (versions.omitSchema) assert.equal(state.schemaVersion, 6);
    const result = runCli('sqlite', sqlite);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, 'no-legacy-rows');
    assert.deepEqual(fs.readFileSync(sqlite), bytes);
  }
});

test('不存在的 SQLite 不会被只读检查创建，错误 JSON 不输出原文', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-retirement-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const missing = path.join(root, 'missing.sqlite');
  await assert.rejects(readRetirementSource('sqlite', missing));
  assert.equal(fs.existsSync(missing), false);
  const source = path.join(root, 'invalid.json');
  fs.writeFileSync(source, '{秘密正文');
  const result = spawnSync(process.execPath, [cli, '--driver=local-json', `--source=${source}`], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal((result.stderr + result.stdout).includes('秘密正文'), false);
});

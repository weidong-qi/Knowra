import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { inspectAnnotationRetirement, readRetirementSource } from '../inspect-inline-annotation-retirement.mjs';

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
  analysisScopes: [{ segments: [{ annotationId: 'old-deleted' }] }],
  annotationRevisions: [{ annotationId: 'old-active' }],
  annotationExclusions: [{ parentAnnotationId: 'old-deleted' }]
});

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
  assert.equal(report.legacy.referencesByCollection.analysisScopes, 1);
  assert.equal(report.legacy.revisions, 1);
  assert.equal(report.legacy.exclusions, 1);
  assert.equal(JSON.stringify(report).includes('秘密摘录'), false);
  const overdue = inspectAnnotationRetirement(state, now + 10 * 86400000);
  assert.equal(overdue.legacy.retentionElapsed, 1);
  assert.equal(overdue.status, 'legacy-rows-remain');
  assert.deepEqual(state, before);
});

for (const driver of ['local-json', 'sqlite']) {
  test(`${driver} 使用原始只读源，CLI 报告与源字节均稳定且不发布业务写入`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-retirement-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, driver === 'sqlite' ? 'local.sqlite' : 'data.json');
    const state = sample();
    if (driver === 'local-json') fs.writeFileSync(source, JSON.stringify({ data: state }));
    else {
      const db = new DatabaseSync(source);
      db.exec('CREATE TABLE entities(collection TEXT, payload TEXT)');
      const insert = db.prepare('INSERT INTO entities VALUES (?, ?)');
      for (const [collection, rows] of Object.entries(state))
        for (const row of rows) insert.run(collection, JSON.stringify(row));
      db.close();
    }
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

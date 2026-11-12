import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createEmptyLocalState } from '../../apps/api/src/infrastructure/local-data-schema.ts';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(workspace, 'scripts/check-attachments.mjs');
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-attachment-check-'));
  const source = path.join(root, 'storage/data/knowledge-base.json');
  const uploads = path.join(root, 'storage/uploads');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.mkdirSync(uploads, { recursive: true });
  const file = path.join(uploads, 'f-file.txt'),
    content = '附件😀';
  fs.writeFileSync(file, content);
  const document = { schemaVersion: 7, ...createEmptyLocalState() };
  document.spaces.push({ id: 's', userId: 'demo', name: '空间' });
  document.notes.push({ id: 'n', spaceId: 's', title: '笔记', rawMarkdown: '正文', tagIds: [] });
  document.attachments.push({
    id: 'f',
    noteId: 'n',
    fileName: 'file.txt',
    storagePath: 'storage/uploads/f-file.txt',
    size: Buffer.byteLength(content),
    sha256: createHash('sha256').update(content).digest('hex'),
    status: 'ready',
    verifiedAt: '2026-10-08T00:00:00Z'
  });
  const save = () => fs.writeFileSync(source, JSON.stringify(document));
  save();
  const run = args =>
    spawnSync(process.execPath, [script, '--source', source, '--storage-root', root, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, STORAGE_UPLOADS_DIR: uploads },
      timeout: 30000
    });
  return { root, source, file, document, save, run, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('部署附件只读检查与完整检查得到相同附件核验结果，并标明范围', () => {
  const f = fixture();
  try {
    const original = fs.readFileSync(f.source);
    const full = f.run([]),
      light = f.run(['--attachments-only']);
    assert.equal(full.status, 0, full.stderr);
    assert.equal(light.status, 0, light.stderr);
    const a = JSON.parse(full.stdout),
      b = JSON.parse(light.stdout);
    assert.equal(a.validationScope, 'complete-library');
    assert.equal(b.validationScope, 'attachment-integrity');
    assert.deepEqual(a.counts, b.counts);
    for (const key of ['expectedSize', 'actualSize', 'expectedSha256', 'actualSha256', 'observedStatus'])
      assert.equal(a.items[0][key], b.items[0][key]);
    assert.deepEqual(fs.readFileSync(f.source), original);
  } finally {
    f.cleanup();
  }
});

test('附件轻量检查仍阻止缺失、哈希错误和错误归属，报告可落盘', () => {
  const f = fixture();
  try {
    const report = path.join(f.root, 'report.json');
    fs.writeFileSync(f.file, '损坏');
    let result = f.run(['--attachments-only', '--report', report]);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(JSON.parse(fs.readFileSync(report)).errors[0].code, 'ATTACHMENT_HASH_MISMATCH');
    fs.rmSync(f.file);
    result = f.run(['--attachments-only']);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(JSON.parse(result.stdout).errors[0].code, 'ATTACHMENT_FILE_MISSING');
    f.document.attachments[0].noteId = 'missing';
    f.save();
    assert.equal(f.run(['--attachments-only']).status, 1);
  } finally {
    f.cleanup();
  }
});

test('默认检查仍验证历史领域数据，轻量模式不能修复或操作 PostgreSQL', () => {
  const f = fixture();
  try {
    f.document.noteVersions.push({ id: 'broken-history' });
    f.save();
    const original = fs.readFileSync(f.source);
    assert.equal(f.run([]).status, 1);
    assert.equal(f.run(['--attachments-only']).status, 0);
    for (const args of [
      ['--attachments-only', '--repair'],
      ['--attachments-only', '--driver', 'postgres']
    ]) {
      const result = f.run(args);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /仅用于 local-json 的只读附件检查/);
    }
    assert.deepEqual(fs.readFileSync(f.source), original);
    fs.writeFileSync(f.source, JSON.stringify(f.document).slice(0, -1));
    assert.equal(f.run(['--attachments-only']).status, 1);
  } finally {
    f.cleanup();
  }
});

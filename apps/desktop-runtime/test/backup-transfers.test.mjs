import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { createAppContext } from '../../api/src/app.factory.ts';
import { createRuntimeBackup, inspectRuntimeBackup, listRuntimeBackups } from '../src/backup.mjs';
import { exportRuntimeBackup, importRuntimeBackup } from '../src/backup-transfers.mjs';
import { exportLocalRecovery } from '../src/recovery-export.mjs';
import {
  backupTransferDigest,
  captureBackupDirectory,
  createOwnedBackupDirectory
} from '../src/backup-transfer-files.mjs';
import { temporaryDirectory, openWorkspace, createNote } from './helpers.mjs';

const selection = directory => {
  const stat = fs.lstatSync(directory);
  return { path: directory, dev: stat.dev, ino: stat.ino };
};
function fixture(t) {
  const root = temporaryDirectory(t);
  const dataRoot = path.join(root, 'source');
  const workspace = openWorkspace(dataRoot);
  let closed = false;
  const close = () => {
    if (!closed) {
      workspace.store.close();
      closed = true;
    }
  };
  t.after(close);
  const note = createNote(workspace, '独立备份的真实 SQLite 正文');
  const context = createAppContext({
    dataStore: workspace.store,
    uploadsDir: path.join(dataRoot, 'uploads'),
    storageRootDir: dataRoot,
    ownerId: 'demo'
  });
  const bytes = Buffer.from('合成附件\0真实字节\n', 'utf8');
  const attachment = context.http.storage.uploadAttachment({
    noteId: note.id,
    fileName: '合成附件.bin',
    contentBase64: bytes.toString('base64')
  });
  const draft = markdown => ({
    version: 1,
    drafts: {
      [`knowra:note-draft:v1:${JSON.stringify([workspace.space.id, note.id])}`]: {
        markdown,
        baseMarkdown: note.rawMarkdown
      }
    }
  });
  fs.writeFileSync(path.join(dataRoot, 'recovery-drafts.json'), JSON.stringify(draft('原生未保存草稿')));
  const archived = Buffer.from(JSON.stringify(draft('归档草稿')));
  const archiveId = backupTransferDigest(archived);
  fs.mkdirSync(path.join(dataRoot, 'recovery-draft-archives'));
  fs.writeFileSync(path.join(dataRoot, 'recovery-draft-archives', `${archiveId}.json`), archived);
  fs.writeFileSync(path.join(dataRoot, 'ai-provider.json'), '仅合成私有设置，不应复制');
  const backup = createRuntimeBackup(workspace.store, dataRoot);
  const external = path.join(root, 'independent');
  fs.mkdirSync(external);
  const second = path.join(root, 'second');
  fs.mkdirSync(second);
  return {
    root,
    dataRoot,
    workspace,
    note,
    attachment,
    bytes,
    archiveId,
    backup,
    id: path.basename(backup),
    external,
    second,
    close
  };
}

function resign(directory, name, bytes) {
  fs.writeFileSync(path.join(directory, name), bytes);
  const manifestFile = path.join(directory, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const item = manifest.files.find(item => item.path === name);
  item.sha256 = backupTransferDigest(bytes);
  item.size = bytes.length;
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
}

test('完整导出及第二独立根导入保留数据库、附件、队列、原生草稿和归档，仅复制支持文件', t => {
  const f = fixture(t);
  const queue = f.workspace.store.readOutbox();
  const exported = exportRuntimeBackup(f.dataRoot, f.id, selection(f.external));
  assert.equal(exported.inspection.noteCount, 1);
  assert.equal(exported.inspection.attachmentCount, 1);
  assert.equal(exported.inspection.draftCount, 2);
  assert(exported.inspection.pendingOperations > 0);
  const imported = importRuntimeBackup(f.second, selection(exported.directory));
  assert.equal(imported.inspection.purpose, 'imported');
  assert.equal(imported.inspection.draftCount, 2);
  assert.equal(listRuntimeBackups(f.second)[0].id, imported.id);
  const database = new DatabaseSync(path.join(imported.directory, 'local.sqlite'), { readOnly: true });
  try {
    assert.equal(
      JSON.parse(
        database.prepare("SELECT payload FROM entities WHERE collection='notes' AND id=?").get(f.note.id).payload
      ).rawMarkdown,
      f.note.rawMarkdown
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS n FROM sync_outbox WHERE state != 'acknowledged'").get().n,
      queue.filter(item => item.state !== 'acknowledged').length
    );
  } finally {
    database.close();
  }
  assert.deepEqual(
    fs.readFileSync(path.join(imported.directory, 'uploads', `${f.attachment.id}-${f.attachment.fileName}`)),
    f.bytes
  );
  assert.deepEqual(
    fs.readFileSync(path.join(imported.directory, 'recovery-draft-archives', `${f.archiveId}.json`)),
    fs.readFileSync(path.join(f.backup, 'recovery-draft-archives', `${f.archiveId}.json`))
  );
  assert.equal(fs.existsSync(path.join(imported.directory, 'ai-provider.json')), false);
  assert.deepEqual(f.workspace.store.readOutbox(), queue);
  assert.equal(fs.existsSync(path.join(f.second, 'active-dataset.json')), false);
});

test('真实旧 CLI 救援导出缺少文件 size 时仍能检查和导入，新清单补实际大小', async t => {
  const f = fixture(t);
  f.close();
  const legacy = path.join(f.external, 'legacy-recovery');
  await exportLocalRecovery(f.dataRoot, legacy);
  const original = fs.readFileSync(path.join(legacy, 'manifest.json'));
  const inventory = (root, relative = '') =>
    fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(entry => {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      return entry.isDirectory()
        ? inventory(root, name)
        : [{ path: name, sha256: backupTransferDigest(fs.readFileSync(path.join(root, name))) }];
    });
  const originalTree = inventory(legacy);
  assert(JSON.parse(original).files.every(item => item.size === undefined));
  assert.equal(inspectRuntimeBackup(legacy).valid, true);
  const imported = importRuntimeBackup(f.second, selection(legacy));
  assert.equal(imported.inspection.noteCount, 1);
  assert.equal(imported.inspection.draftCount, 2);
  assert(
    JSON.parse(fs.readFileSync(path.join(imported.directory, 'manifest.json'), 'utf8')).files.every(item =>
      Number.isSafeInteger(item.size)
    )
  );
  assert.deepEqual(fs.readFileSync(path.join(legacy, 'manifest.json')), original);
  assert.deepEqual(inventory(legacy), originalTree, '检查和导入不得改变旧救援来源的文件列表或字节');
});

test('所选目录被替换、managed 目录、目录链接及既有空目录均拒绝，已有文件不变', t => {
  const f = fixture(t);
  for (const directory of [f.dataRoot, path.join(f.dataRoot, 'backups'), f.backup, f.root]) {
    assert.throws(() => exportRuntimeBackup(f.dataRoot, f.id, selection(directory)), /资料目录/);
  }
  const prior = selection(f.external);
  fs.renameSync(f.external, `${f.external}-old`);
  fs.mkdirSync(f.external);
  assert.throws(() => exportRuntimeBackup(f.dataRoot, f.id, prior), /变化/);
  assert.deepEqual(fs.readdirSync(f.external), []);
  const alias = path.join(f.root, 'alias');
  fs.symlinkSync(f.external, alias);
  assert.throws(() => exportRuntimeBackup(f.dataRoot, f.id, selection(alias)), /变化|符号链接/);
  fs.mkdirSync(path.join(f.external, 'child'));
  assert.throws(() => exportRuntimeBackup(f.dataRoot, f.id, selection(path.join(alias, 'child'))), /符号链接/);
  fs.rmdirSync(path.join(f.external, 'child'));
  const existing = path.join(f.external, `Knowra-完整备份-${f.id}`);
  fs.mkdirSync(existing);
  assert.throws(() => exportRuntimeBackup(f.dataRoot, f.id, selection(f.external)), /已存在/);
  assert.deepEqual(fs.readdirSync(existing), []);
  assert.deepEqual(fs.readdirSync(f.external), [path.basename(existing)]);
  fs.writeFileSync(path.join(existing, '原有文件'), '原有字节');
  assert.throws(() => exportRuntimeBackup(f.dataRoot, f.id, selection(f.external)), /已存在/);
  assert.equal(fs.readFileSync(path.join(existing, '原有文件'), 'utf8'), '原有字节');
});

test('链接文件、额外私有文件和清单 traversal 在复制前拒绝，第二根及原库不变', t => {
  const f = fixture(t);
  const exported = exportRuntimeBackup(f.dataRoot, f.id, selection(f.external)).directory;
  const source = path.join(exported, 'uploads', `${f.attachment.id}-${f.attachment.fileName}`);
  fs.linkSync(source, path.join(exported, 'uploads/hardlink'));
  assert.throws(() => importRuntimeBackup(f.second, selection(exported)), /硬链接/);
  fs.unlinkSync(path.join(exported, 'uploads/hardlink'));
  fs.symlinkSync(source, path.join(exported, 'uploads/symlink'));
  assert.throws(() => importRuntimeBackup(f.second, selection(exported)), /符号链接/);
  fs.unlinkSync(path.join(exported, 'uploads/symlink'));
  fs.writeFileSync(path.join(exported, 'ai-provider.json'), '合成私有设置');
  assert.throws(() => importRuntimeBackup(f.second, selection(exported)), /完整性/);
  fs.unlinkSync(path.join(exported, 'ai-provider.json'));
  const manifestFile = path.join(exported, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.files.push({ path: '../outside', sha256: 'a'.repeat(64), size: 0 });
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  assert.throws(() => importRuntimeBackup(f.second, selection(exported)), /路径/);
  assert.deepEqual(listRuntimeBackups(f.second), []);
  assert.equal(f.workspace.store.state.notes[0].rawMarkdown, f.note.rawMarkdown);
});

test('损坏哈希、重新签名的附件、SQLite 和非法草稿/归档均拒绝完整导入', async t => {
  for (const kind of ['hash', 'attachment', 'sqlite', 'draft', 'archive'])
    await t.test(kind, t => {
      const f = fixture(t);
      const exported = exportRuntimeBackup(f.dataRoot, f.id, selection(f.external)).directory;
      const attachmentName = `uploads/${f.attachment.id}-${f.attachment.fileName}`;
      if (kind === 'hash') fs.appendFileSync(path.join(exported, attachmentName), '损坏');
      if (kind === 'attachment') resign(exported, attachmentName, Buffer.from('重新签名的错误附件'));
      if (kind === 'sqlite') resign(exported, 'local.sqlite', Buffer.from('不是 SQLite'));
      if (kind === 'draft')
        resign(
          exported,
          'recovery-drafts.json',
          Buffer.from(JSON.stringify({ version: 1, drafts: { 坏键: { markdown: '正文', baseMarkdown: '' } } }))
        );
      if (kind === 'archive') {
        const bytes = Buffer.from(
          JSON.stringify({ version: 1, drafts: { 坏键: { markdown: '正文', baseMarkdown: '' } } })
        );
        const oldName = `recovery-draft-archives/${f.archiveId}.json`;
        const nextName = `recovery-draft-archives/${backupTransferDigest(bytes)}.json`;
        fs.renameSync(path.join(exported, oldName), path.join(exported, nextName));
        const file = path.join(exported, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
        manifest.files.find(item => item.path === oldName).path = nextName;
        fs.writeFileSync(file, JSON.stringify(manifest));
        resign(exported, nextName, bytes);
      }
      assert.throws(() => importRuntimeBackup(f.second, selection(exported)));
      assert.deepEqual(listRuntimeBackups(f.second), []);
      assert.equal(f.workspace.store.state.notes[0].rawMarkdown, f.note.rawMarkdown);
    });
});

test('复制中替换 owned 子项时放弃清理，绝不删除外部替换文件', t => {
  const root = temporaryDirectory(t);
  const owned = createOwnedBackupDirectory(captureBackupDirectory(root), '.pending');
  owned.write('local.sqlite', Buffer.from('本次临时文件'));
  const file = path.join(owned.root, 'local.sqlite');
  fs.renameSync(file, path.join(root, 'moved-own-file'));
  fs.writeFileSync(file, '外部替换文件');
  assert.equal(owned.cleanup(), false);
  assert.equal(fs.readFileSync(file, 'utf8'), '外部替换文件');
});

for (const level of ['staging', 'final'])
  test(`${level} 独占创建前普通移动并替换目录，写资料前拒绝且保留原有文件列表`, t => {
    const f = fixture(t);
    const foreign = path.join(f.root, 'replacement');
    fs.mkdirSync(foreign);
    const sentinel = Buffer.from('替换目录原有合成文件');
    fs.writeFileSync(path.join(foreign, 'sentinel.txt'), sentinel);
    const sourceNames = [
      'manifest.json',
      ...JSON.parse(fs.readFileSync(path.join(f.backup, 'manifest.json'), 'utf8')).files.map(item => item.path)
    ];
    const sourceInventory = () =>
      sourceNames.map(name => [name, backupTransferDigest(fs.readFileSync(path.join(f.backup, name)))]);
    const before = sourceInventory();
    const sourceDatabase = fs.readFileSync(path.join(f.backup, 'local.sqlite'));
    const original = fs.openSync;
    let replaced = false,
      replacedRoot;
    fs.openSync = (file, flags, ...args) => {
      const parent = typeof file === 'string' ? path.dirname(file) : '';
      const matching =
        level === 'staging'
          ? path.basename(parent).startsWith('.knowra-transfer-')
          : path.basename(parent) === `Knowra-完整备份-${f.id}`;
      if (
        !replaced &&
        matching &&
        path.basename(file) === 'local.sqlite' &&
        typeof flags === 'number' &&
        flags & fs.constants.O_CREAT &&
        flags & fs.constants.O_EXCL
      ) {
        replaced = true;
        replacedRoot = parent;
        fs.renameSync(parent, `${parent}-original-owned`);
        fs.renameSync(foreign, parent); // 两次真实普通目录移动，不使用链接。
      }
      return original(file, flags, ...args);
    };
    try {
      assert.throws(() => exportRuntimeBackup(f.dataRoot, f.id, selection(f.external)), /复制已中断/);
    } finally {
      fs.openSync = original;
    }
    assert.equal(replaced, true);
    const unexpected = path.join(replacedRoot, 'local.sqlite');
    const bytes = fs.existsSync(unexpected) ? fs.readFileSync(unexpected) : Buffer.alloc(0);
    const unchangedSource = JSON.stringify(sourceInventory()) === JSON.stringify(before);
    t.diagnostic(
      JSON.stringify({
        level,
        replacementFiles: fs.readdirSync(replacedRoot),
        unexpectedBytes: bytes.length,
        copiedSourceBytes: bytes.equals(sourceDatabase),
        sourceDatabaseBytes: sourceDatabase.length,
        unchangedSource
      })
    );
    assert.equal(unchangedSource, true);
    assert.deepEqual(fs.readFileSync(path.join(replacedRoot, 'sentinel.txt')), sentinel);
    assert.equal(fs.existsSync(path.join(replacedRoot, 'manifest.json')), false);
    assert.deepEqual(fs.readdirSync(replacedRoot), ['sentinel.txt']);
    assert.equal(bytes.length, 0, '替换目录不能留下完整数据库或任何资料字节');
  });

test('读取前文件被换成符号链接时 O_NOFOLLOW 阻止复制并清理本次 staging', t => {
  const f = fixture(t);
  const exported = exportRuntimeBackup(f.dataRoot, f.id, selection(f.external)).directory;
  const file = path.join(exported, 'uploads', `${f.attachment.id}-${f.attachment.fileName}`);
  const foreign = path.join(f.root, 'foreign');
  fs.writeFileSync(foreign, '不得读取或删除的合成外部文件');
  const original = fs.openSync;
  let replaced = false;
  fs.openSync = (candidate, flags, ...args) => {
    if (!replaced && candidate === file && typeof flags === 'number' && flags & fs.constants.O_NOFOLLOW) {
      replaced = true;
      fs.renameSync(file, `${file}.original`);
      fs.symlinkSync(foreign, file);
    }
    return original(candidate, flags, ...args);
  };
  try {
    assert.throws(() => importRuntimeBackup(f.second, selection(exported)));
  } finally {
    fs.openSync = original;
  }
  assert.equal(replaced, true);
  assert.equal(fs.readFileSync(foreign, 'utf8'), '不得读取或删除的合成外部文件');
  assert.deepEqual(fs.readdirSync(path.join(f.second, 'backups')), []);
});

test('FIFO 等特殊文件在读取前拒绝，避免复制挂起', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t);
  const exported = exportRuntimeBackup(f.dataRoot, f.id, selection(f.external)).directory;
  execFileSync('mkfifo', [path.join(exported, 'uploads/fifo')]);
  assert.throws(() => importRuntimeBackup(f.second, selection(exported)), /特殊文件/);
  assert.deepEqual(listRuntimeBackups(f.second), []);
});

test('多附件文件复制的 stat 次数随文件数近似线性增长', t => {
  const measure = count => {
    const f = fixture(t);
    for (let i = 0; i < count; i++) fs.writeFileSync(path.join(f.dataRoot, 'uploads', `extra-${i}.bin`), `合成-${i}`);
    const backup = createRuntimeBackup(f.workspace.store, f.dataRoot);
    const original = fs.lstatSync;
    let calls = 0;
    fs.lstatSync = (...args) => {
      calls++;
      return original(...args);
    };
    try {
      exportRuntimeBackup(f.dataRoot, path.basename(backup), selection(f.external));
    } finally {
      fs.lstatSync = original;
    }
    return calls;
  };
  const small = measure(16),
    large = measure(64);
  assert(large > small);
  assert(large < small * 5, `16 文件 ${small} 次，64 文件 ${large} 次`);
  t.diagnostic(`单次导出 stat 次数：16 文件 ${small}，64 文件 ${large}`);
});

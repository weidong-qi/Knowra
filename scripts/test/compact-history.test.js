import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { compactHistory, fileDigest } from '../compact-history.mjs';
import { createFileDataStore } from '../../apps/api/src/infrastructure/file-data-store.js';
import { acquireDataFileWriteLock } from '../../apps/api/src/infrastructure/data-file-write-lock.ts';
import { createAppContext } from '../../apps/api/src/app.factory.js';
import { NoteVersion } from '../../apps/api/src/modules/knowledge/domain/note-version.ts';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../compact-history.mjs', import.meta.url));
const lockModule = new URL('../../apps/api/src/infrastructure/data-file-write-lock.ts', import.meta.url).href;

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-history-maintenance-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'library.json'),
    preview = path.join(root, 'preview.json'),
    backupDirectory = path.join(root, 'backups');
  const store = createFileDataStore(file);
  const context = createAppContext({ dataStore: store, storageRootDir: root });
  const k = context.modules.knowledge;
  const space = k.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const note = k.noteService.createNote({ title: '不清理当前正文', rawMarkdown: '当前正文', spaceId: space.id });
  store.runSyncBatchTransaction(() => {
    for (let i = 0; i < 35; i++)
      store.state.noteVersions.push(
        new NoteVersion({
          id: `old-${i}`,
          noteId: note.id,
          content: `旧正文${i}`,
          createdAt: new Date(Date.now() - (40 + i) * 86400000).toISOString()
        })
      );
  });
  return { root, file, preview, backupDirectory, store, note };
}

test('清理预览只读，应用先备份并在同一提交中生成墓碑，当前内容完整保留', async t => {
  const f = fixture(t),
    original = await fileDigest(f.file);
  const report = await compactHistory({ file: f.file });
  assert.equal(report.summary.noteVersions.removed, 35);
  assert.equal(await fileDigest(f.file), original);
  fs.writeFileSync(f.preview, JSON.stringify(report));
  const result = await compactHistory({ ...f, apply: true });
  assert.equal(result.mode, 'applied');
  assert.equal(await fileDigest(result.backupPath), original);
  const next = createFileDataStore(f.file);
  assert.deepEqual(next.state.notes, structuredClone(f.store.state.notes));
  assert.equal(next.state.noteVersions.length, 1);
  assert.equal(
    Object.values(next.getSyncJournal().tombstones).filter(item => item.collection === 'noteVersions').length,
    35
  );
  assert.throws(
    () =>
      f.store.runTransaction(() => {
        f.store.state.notes[0].title = '旧进程';
        f.store.flush();
      }),
    error => error.cause?.code === 'STORAGE_EXTERNAL_CHANGE',
    '清理后仍持有旧内存的进程也不能覆盖新文件'
  );
  assert.ok(fs.statSync(f.file).size < result.beforeBytes + 20000, '同步墓碑有空间成本，但不保留旧正文');
});

test('预览后发生修改或规则摘要被改动时拒绝清理，不生成删除结果', async t => {
  const f = fixture(t);
  const report = await compactHistory({ file: f.file });
  fs.writeFileSync(f.preview, JSON.stringify({ ...report, planHash: 'wrong' }));
  const original = await fileDigest(f.file);
  await assert.rejects(compactHistory({ ...f, apply: true }), /规则或引用与预览不一致/);
  assert.equal(await fileDigest(f.file), original);
  fs.writeFileSync(f.preview, JSON.stringify(report));
  await assert.rejects(compactHistory({ ...f, apply: true, now: Date.now() + 25 * 3600000 }), /超过 24 小时/);
  assert.equal(await fileDigest(f.file), original);
  f.store.runTransaction(() => {
    f.store.state.notes[0].title = '清理预览后的修改';
    f.store.flush();
  });
  const updated = await fileDigest(f.file);
  await assert.rejects(compactHistory({ ...f, apply: true }), /预览后已变化/);
  assert.equal(await fileDigest(f.file), updated);
});

test('原子替换失败时主体和墓碑均不落盘，完整备份仍在并能安全重试', async t => {
  const f = fixture(t),
    original = await fileDigest(f.file);
  fs.writeFileSync(f.preview, JSON.stringify(await compactHistory({ file: f.file })));
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to === f.file) throw new Error('injected history replacement failure');
    return rename(from, to);
  };
  try {
    await assert.rejects(compactHistory({ ...f, apply: true }), /persist local data safely/);
  } finally {
    fs.renameSync = rename;
  }
  assert.equal(await fileDigest(f.file), original);
  const backup = path.join(f.backupDirectory, fs.readdirSync(f.backupDirectory)[0]);
  assert.equal(await fileDigest(backup), original);
  assert.equal(createFileDataStore(f.file).state.noteVersions.length, 36);
  assert.equal((await compactHistory({ ...f, apply: true })).mode, 'applied');
});

test('维护锁阻止另一数据存储实例写入，锁释放后事务可重试', async t => {
  const f = fixture(t),
    original = await fileDigest(f.file);
  const competing = createFileDataStore(f.file),
    lock = acquireDataFileWriteLock(f.file);
  try {
    assert.throws(
      () =>
        competing.runTransaction(() => {
          competing.state.notes[0].title = '并发保存';
          competing.flush();
        }),
      error => error.code === 'STORAGE_WRITE_FAILED' && error.cause?.code === 'STORAGE_MAINTENANCE_BUSY'
    );
    assert.equal(await fileDigest(f.file), original);
    assert.equal(competing.state.notes[0].title, f.note.title);
  } finally {
    lock.release();
  }
  competing.runTransaction(() => {
    competing.state.notes[0].title = '重试成功';
    competing.flush();
  });
  assert.equal(createFileDataStore(f.file).state.notes[0].title, '重试成功');
});

test('已退出进程遗留的写锁可回收，存活进程持锁不被接管', t => {
  const f = fixture(t);
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      'import {acquireDataFileWriteLock} from "./apps/api/src/infrastructure/data-file-write-lock.ts"; acquireDataFileWriteLock(process.argv[1]);',
      f.file
    ],
    { encoding: 'utf8' }
  );
  assert.equal(child.status, 0, child.stderr);
  const lock = acquireDataFileWriteLock(f.file);
  try {
    assert.throws(() => acquireDataFileWriteLock(f.file), { code: 'STORAGE_MAINTENANCE_BUSY' });
  } finally {
    lock.release();
  }
});

test('报告拒绝资料库和预览的符号链接、硬链接及目录别名，应用前也拒绝', async t => {
  const f = fixture(t),
    original = await fileDigest(f.file);
  fs.writeFileSync(f.preview, JSON.stringify(await compactHistory({ file: f.file })));
  const previewDigest = await fileDigest(f.preview);
  for (const input of [f.file, f.preview]) {
    for (const kind of ['symlink', 'hardlink', 'directory-alias']) {
      const alias = path.join(f.root, `${path.basename(input)}-${kind}`);
      let report = alias;
      if (kind === 'directory-alias') {
        fs.symlinkSync(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
        report = path.join(alias, path.basename(input));
      } else if (kind === 'symlink') fs.symlinkSync(input, alias);
      else fs.linkSync(input, alias);
      for (const mode of [
        ['--preview', f.preview],
        ['--apply', '--preview', f.preview, '--backup-dir', f.backupDirectory]
      ]) {
        const child = spawnSync(process.execPath, [cli, '--file', f.file, '--report', report, ...mode], {
          encoding: 'utf8'
        });
        assert.equal(child.status, 1, `${input} ${kind} ${mode}: ${child.stderr}`);
        assert.match(child.stderr, /独立|符号链接/);
        assert.equal(await fileDigest(f.file), original);
        assert.equal(await fileDigest(f.preview), previewDigest);
        assert.equal(fs.existsSync(f.backupDirectory), false, '无效报告路径必须在清理前拒绝');
      }
    }
  }
});

test('报告原子替换不跟随校验后插入的符号链接，正常预览可写出并替换报告', async t => {
  const f = fixture(t),
    original = await fileDigest(f.file),
    report = path.join(f.root, 'report.json');
  const run = () => spawnSync(process.execPath, [cli, '--file', f.file, '--report', report], { encoding: 'utf8' });
  assert.equal(run().status, 0);
  assert.equal(run().status, 0);
  assert.equal(JSON.parse(fs.readFileSync(report)).mode, 'preview');
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import fs from 'node:fs';
    const [cliPath, source, reportPath] = process.argv.slice(1);
    const rename = fs.renameSync, write = fs.writeFileSync;
    const inject = () => { fs.unlinkSync(reportPath); fs.symlinkSync(source, reportPath); };
    fs.writeFileSync = (file, ...args) => {
      if (file === reportPath) inject();
      return write(file, ...args);
    };
    fs.renameSync = (from, to) => {
      if (to === reportPath) inject();
      return rename(from, to);
    };
    process.argv = [process.execPath, cliPath, '--file', source, '--report', reportPath];
    await import(${JSON.stringify(new URL('../compact-history.mjs', import.meta.url).href)});
  `,
      cli,
      f.file,
      report
    ],
    { encoding: 'utf8' }
  );
  assert.equal(child.status, 0, child.stderr);
  assert.equal(await fileDigest(f.file), original);
  assert.equal(fs.lstatSync(report).isSymbolicLink(), false);
  assert.equal(JSON.parse(fs.readFileSync(report)).mode, 'preview');
});

test('写锁在准备文件创建后、发布前或发布后崩溃，重启均可保存且无空公开锁', t => {
  for (const stage of ['create-public', 'prepare', 'before-publish', 'after-publish']) {
    const f = fixture(t);
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import fs from 'node:fs';
      import { acquireDataFileWriteLock } from ${JSON.stringify(lockModule)};
      const stage = process.argv[2];
      const write = fs.writeFileSync, link = fs.linkSync, open = fs.openSync;
      fs.openSync = (file, ...args) => {
        const descriptor = open(file, ...args);
        if (stage === 'create-public' && String(file).endsWith('.write-lock')) process.exit(91);
        return descriptor;
      };
      fs.writeFileSync = (file, ...args) => {
        if (stage === 'prepare' && String(file).endsWith('.tmp')) {
          fs.closeSync(fs.openSync(file, 'wx', 0o600)); process.exit(91);
        }
        return write(file, ...args);
      };
      fs.linkSync = (from, to) => {
        if (stage === 'before-publish') process.exit(91);
        link(from, to); process.exit(91);
      };
      acquireDataFileWriteLock(process.argv[1]);
      process.exit(91);
    `,
        f.file,
        stage
      ],
      { encoding: 'utf8' }
    );
    assert.equal(child.status, 91, child.stderr);
    const target = `${f.file}.write-lock`;
    if (stage === 'after-publish' || stage === 'create-public') {
      const record = JSON.parse(fs.readFileSync(target, 'utf8'));
      assert.ok(Number.isSafeInteger(record.pid) && record.pid > 0);
      assert.equal(typeof record.token, 'string');
    } else assert.equal(fs.existsSync(target), false);
    for (let restart = 0; restart < 2; restart++) {
      const store = createFileDataStore(f.file);
      store.runTransaction(() => {
        store.state.notes[0].title = `重启保存${restart}`;
        store.flush();
      });
      assert.equal(createFileDataStore(f.file).state.notes[0].title, `重启保存${restart}`);
      assert.equal(fs.existsSync(target), false);
    }
  }
});

test('多个进程竞争原子发布的写锁，任意时刻只允许一个持有者', async t => {
  const f = fixture(t),
    marker = path.join(f.root, 'critical-section');
  const script = `
    import fs from 'node:fs';
    import { setTimeout as sleep } from 'node:timers/promises';
    import { acquireDataFileWriteLock } from ${JSON.stringify(lockModule)};
    for (let i = 0; i < 12; i++) {
      let lock;
      for (let retry = 0; !lock && retry < 1000; retry++) {
        try { lock = acquireDataFileWriteLock(process.argv[1]); }
        catch (error) { if (error.code !== 'STORAGE_MAINTENANCE_BUSY') throw error; await sleep(1); }
      }
      if (!lock) throw new Error('lock acquisition timed out');
      try {
        const descriptor = fs.openSync(process.argv[2], 'wx');
        await sleep(3);
        fs.closeSync(descriptor); fs.unlinkSync(process.argv[2]);
      } finally { lock.release(); }
    }
  `;
  const results = await Promise.all(
    Array.from(
      { length: 4 },
      () =>
        new Promise(resolve => {
          const child = spawn(process.execPath, ['--input-type=module', '-e', script, f.file, marker]);
          let stderr = '';
          child.stderr.on('data', chunk => {
            stderr += chunk;
          });
          child.on('error', error => resolve({ code: -1, stderr: error.message }));
          child.on('exit', code => resolve({ code, stderr }));
        })
    )
  );
  for (const result of results) assert.equal(result.code, 0, result.stderr);
  assert.equal(fs.existsSync(`${f.file}.write-lock`), false);
  assert.equal(fs.existsSync(marker), false);
});

test('临时锁文件清理一次 EACCES 不丢失公开锁句柄，同进程连续保存可成功', t => {
  const f = fixture(t),
    target = `${f.file}.write-lock`;
  const remove = fs.rmSync,
    warn = console.warn;
  let prepared,
    injected = 0;
  const warnings = [];
  fs.rmSync = (file, ...args) => {
    if (!injected && String(file).startsWith(`${target}.`) && String(file).endsWith('.tmp')) {
      assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).pid, process.pid, '删除失败发生在公开锁已取得之后');
      prepared = file;
      injected++;
      throw Object.assign(new Error('injected cleanup EACCES'), { code: 'EACCES' });
    }
    return remove(file, ...args);
  };
  console.warn = (...args) => warnings.push(args);
  try {
    f.store.runTransaction(() => {
      f.store.state.notes[0].title = '清理失败时仍完成保存';
      f.store.flush();
    });
  } finally {
    fs.rmSync = remove;
    console.warn = warn;
  }
  assert.equal(injected, 1);
  assert.equal(fs.existsSync(prepared), true, '未删掉的独立临时文件不影响互斥锁');
  assert.equal(fs.existsSync(target), false, '保存结束必须释放公开锁');
  assert.equal(createFileDataStore(f.file).state.notes[0].title, '清理失败时仍完成保存');
  assert.equal(warnings.length, 1);
  for (let retry = 0; retry < 2; retry++) {
    f.store.runTransaction(() => {
      f.store.state.notes[0].title = `同进程再次保存${retry}`;
      f.store.flush();
    });
    assert.equal(createFileDataStore(f.file).state.notes[0].title, `同进程再次保存${retry}`);
    assert.equal(fs.existsSync(target), false);
  }
});

test('获取锁失败且临时文件清理也失败时，保留原始异常及其他持有者的锁', t => {
  const f = fixture(t),
    target = `${f.file}.write-lock`;
  for (const mode of ['busy', 'publish-error']) {
    const held = mode === 'busy' ? acquireDataFileWriteLock(f.file) : null;
    const remove = fs.rmSync,
      link = fs.linkSync,
      warn = console.warn;
    const publishError = Object.assign(new Error('injected publication failure'), { code: 'EIO' });
    let injected = 0;
    fs.rmSync = (file, ...args) => {
      if (String(file).startsWith(`${target}.`) && String(file).endsWith('.tmp')) {
        injected++;
        throw Object.assign(new Error('injected cleanup EACCES'), { code: 'EACCES' });
      }
      return remove(file, ...args);
    };
    if (mode === 'publish-error')
      fs.linkSync = () => {
        throw publishError;
      };
    console.warn = () => {};
    try {
      assert.throws(
        () => acquireDataFileWriteLock(f.file),
        error => (mode === 'busy' ? error.code === 'STORAGE_MAINTENANCE_BUSY' : error === publishError)
      );
      assert.equal(injected, 1);
      if (held) assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).token, held.token);
      else assert.equal(fs.existsSync(target), false);
    } finally {
      fs.rmSync = remove;
      fs.linkSync = link;
      console.warn = warn;
      held?.release();
    }
    const next = acquireDataFileWriteLock(f.file);
    next.release();
    assert.equal(fs.existsSync(target), false);
  }
});

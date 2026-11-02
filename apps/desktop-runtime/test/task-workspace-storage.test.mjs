import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { createSqliteTaskWorkspaceStore, readTaskWorkspaceSnapshot } from '../src/task-workspaces/sqlite-store.mjs';
import { createTaskWorkspaceFiles, verifyTaskImage } from '../src/task-workspaces/files.mjs';
import { createTaskWorkspaceService } from '../../api/src/modules/task-workspaces/service.ts';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-task-storage-'));
  const file = path.join(root, 'local.sqlite');
  const databases = [];
  function open() {
    const db = new DatabaseSync(file);
    databases.push(db);
    db.exec('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.prepare('INSERT OR IGNORE INTO metadata VALUES (?, ?)').run('datasetId', randomUUID());
    return { db, store: createSqliteTaskWorkspaceStore(db) };
  }
  t.after(() => {
    for (const db of databases) {
      try {
        db.close();
      } catch {}
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const first = open();
  const files = createTaskWorkspaceFiles({ uploadsDirectory: path.join(root, 'uploads') });
  const service = createTaskWorkspaceService({ store: first.store, files, authorize: () => true });
  const user = { ...first.store.identity(), actor: { kind: 'user', id: 'synthetic-user' }, guard: () => true };
  const agent = { ...user, actor: { kind: 'mcp', id: 'synthetic-agent' } };
  const workspace = service.createWorkspace(user, { operationId: randomUUID(), name: '合成测试' }).data.workspace;
  const document = service.createDocument(user, {
    operationId: randomUUID(),
    workspaceId: workspace.id,
    title: '合成说明',
    markdown: '测试内容'
  }).data.document;
  return { ...first, root, file, files, service, user, agent, workspace, document, open };
}
const png = () =>
  sharp({ create: { width: 3, height: 2, channels: 4, background: '#125588' } })
    .png()
    .toBuffer();

function ready(f) {
  let task = f.service.createTask(f.user, { operationId: randomUUID(), workspaceId: f.workspace.id, title: '合成任务' })
    .data.task;
  return f.service.publishTask(f.user, {
    operationId: randomUUID(),
    workspaceId: f.workspace.id,
    taskId: task.id,
    expectedRevision: task.revision,
    description: { documentId: f.document.id, versionId: f.document.version.id },
    acceptanceCriteria: ['通过合成测试'],
    inScope: '测试',
    outOfScope: ''
  }).data.task;
}

test('SQLite 重启、双实例实时读取、CAS和事务回滚不污染索引', t => {
  const f = fixture(t),
    second = f.open();
  const secondService = createTaskWorkspaceService({ store: second.store, authorize: () => true });
  assert.equal(
    secondService.getDocument(f.user, { workspaceId: f.workspace.id, documentId: f.document.id }).title,
    '合成说明'
  );
  const input = {
    operationId: randomUUID(),
    workspaceId: f.workspace.id,
    documentId: f.document.id,
    expectedRevision: 1,
    title: '第一次更新'
  };
  f.service.updateDocument(f.user, input);
  assert.throws(() => secondService.updateDocument(f.user, { ...input, operationId: randomUUID(), title: '旧CAS' }), {
    code: 'TASK_WORKSPACE_CONFLICT'
  });
  assert.equal(
    secondService.getDocument(f.user, { workspaceId: f.workspace.id, documentId: f.document.id }).title,
    '第一次更新'
  );
  assert.throws(
    () =>
      f.store.runTransaction(tx => {
        const d = tx.get('documents', f.document.id);
        d.title = '不会落库';
        tx.replace('documents', d);
        throw new Error('injected');
      }),
    /injected/
  );
  assert.throws(
    () =>
      f.store.runTransaction(tx => {
        const d = tx.get('documents', f.document.id);
        d.currentVersionId = randomUUID();
        tx.replace('documents', d);
      }),
    /校验失败/
  );
  assert.equal(readTaskWorkspaceSnapshot(f.db).documents[0].title, '第一次更新');
  const restarted = f.open();
  assert.equal(readTaskWorkspaceSnapshot(restarted.db).documents[0].revision, 2);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='sync_outbox'").get().n, 0);
});

test('两实例claim仅一成功，重放不新增attempt，恢复epoch拒旧lease和receipt', t => {
  const f = fixture(t),
    task = ready(f),
    second = f.open();
  const other = createTaskWorkspaceService({ store: second.store, authorize: () => true });
  const input = {
    operationId: randomUUID(),
    workspaceId: f.workspace.id,
    taskId: task.id,
    expectedRevision: task.revision
  };
  const first = f.service.claimTask(f.agent, input);
  assert.throws(() => other.claimTask(f.agent, { ...input, operationId: randomUUID() }), {
    code: 'TASK_WORKSPACE_CONFLICT'
  });
  assert.equal(other.claimTask(f.agent, input).reused, true);
  assert.equal(readTaskWorkspaceSnapshot(f.db).attempts.length, 1);
  f.store.rotateEpoch();
  assert.throws(() => f.service.claimTask(f.agent, input), { code: 'TASK_WORKSPACE_FORBIDDEN' });
  const fresh = { ...f.agent, ...f.store.identity() };
  assert.throws(() => f.service.claimTask(fresh, input), { code: 'TASK_WORKSPACE_CONFLICT' });
  assert.equal(readTaskWorkspaceSnapshot(f.db).attempts[0].status, 'expired');
  assert.equal(readTaskWorkspaceSnapshot(f.db).attempts[0].leaseExpiresAt, null);
  const snapshot = readTaskWorkspaceSnapshot(f.db);
  assert.equal(snapshot.tasks[0].activeAttemptId, null);
  assert.throws(
    () =>
      f.service.renewTask(fresh, {
        operationId: randomUUID(),
        workspaceId: f.workspace.id,
        taskId: task.id,
        attemptId: first.data.attempt.id,
        generation: first.data.attempt.generation
      }),
    { code: 'TASK_WORKSPACE_LEASE_EXPIRED' }
  );
});

test('真实PNG上传/重启读取同一hash，精确version引用和workspace边界', async t => {
  const f = fixture(t),
    bytes = await png();
  const uploaded = await f.service.uploadAttachment(f.user, {
    operationId: randomUUID(),
    workspaceId: f.workspace.id,
    documentId: f.document.id,
    expectedRevision: 1,
    fileName: '示例.png',
    mimeType: 'image/png',
    bytes
  });
  assert.equal(uploaded.data.documentRevision, 2);
  assert.equal(JSON.stringify(uploaded).includes('storageKey'), false);
  const input = {
    workspaceId: f.workspace.id,
    documentId: f.document.id,
    versionId: f.document.version.id,
    attachmentId: uploaded.data.attachment.id
  };
  await assert.rejects(f.service.readAttachment(f.agent, input), { code: 'TASK_WORKSPACE_FORBIDDEN' });
  const saved = f.service.updateDocument(f.user, {
    operationId: randomUUID(),
    workspaceId: f.workspace.id,
    documentId: f.document.id,
    expectedRevision: 2,
    markdown: `![测试](${uploaded.data.imageUri})`
  }).data.document;
  const fresh = f.open();
  const service = createTaskWorkspaceService({ store: fresh.store, files: f.files, authorize: () => true });
  const read = await service.readAttachment(f.agent, { ...input, versionId: saved.version.id });
  assert.deepEqual(read.bytes, bytes);
  assert.equal(read.width * read.height, 6);
  assert.equal(read.attachment.sha256, uploaded.data.attachment.sha256);
  await assert.rejects(
    service.readAttachment(f.agent, { ...input, workspaceId: randomUUID(), versionId: saved.version.id }),
    { code: 'TASK_WORKSPACE_FORBIDDEN' }
  );
  const a = readTaskWorkspaceSnapshot(f.db).documents[0].attachments[0];
  fs.writeFileSync(path.join(f.root, 'uploads', a.storageKey), Buffer.from('corrupt'));
  await assert.rejects(service.readAttachment(f.agent, { ...input, versionId: saved.version.id }), {
    code: 'TASK_WORKSPACE_FORBIDDEN'
  });
});

test('附件限额、MIME伪装、损坏流、符号链接和失败事务清理', async t => {
  const f = fixture(t),
    bytes = await png();
  await assert.rejects(verifyTaskImage(bytes, 'image/jpeg'));
  await assert.rejects(verifyTaskImage(bytes.subarray(0, bytes.length - 12), 'image/png'));
  await assert.rejects(verifyTaskImage(Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png'), {
    code: 'TASK_WORKSPACE_LIMIT'
  });
  const huge = await sharp({ create: { width: 4001, height: 4000, channels: 3, background: '#ffffff' } })
    .png()
    .toBuffer();
  await assert.rejects(verifyTaskImage(huge, 'image/png'));
  await assert.rejects(
    f.service.uploadAttachment(f.user, {
      operationId: randomUUID(),
      workspaceId: f.workspace.id,
      documentId: f.document.id,
      expectedRevision: 99,
      fileName: 'bad.png',
      mimeType: 'image/png',
      bytes
    }),
    { code: 'TASK_WORKSPACE_CONFLICT' }
  );
  assert.equal(readTaskWorkspaceSnapshot(f.db).documents[0].attachments.length, 0);
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'uploads', 'task-workspaces', f.workspace.id, f.document.id)), []);
  fs.rmSync(path.join(f.root, 'uploads', 'task-workspaces', f.workspace.id, f.document.id), { recursive: true });
  fs.symlinkSync(f.root, path.join(f.root, 'uploads', 'task-workspaces', f.workspace.id, f.document.id), 'dir');
  await assert.rejects(
    f.files.stage({
      workspaceId: f.workspace.id,
      documentId: f.document.id,
      attachmentId: randomUUID(),
      fileName: 'evil.png',
      mimeType: 'image/png',
      bytes
    }),
    { code: 'TASK_WORKSPACE_FORBIDDEN' }
  );
});

test('真实JPEG/WebP解码、拒绝动画，immutable文件不得覆盖', async t => {
  const f = fixture(t);
  const animated = await sharp(Buffer.from([255, 0, 0, 0, 255, 0]), {
    raw: { width: 1, height: 2, channels: 3, pageHeight: 1 }
  })
    .webp({ lossless: true, delay: [100, 100] })
    .toBuffer();
  await assert.rejects(verifyTaskImage(animated, 'image/webp'));
  for (const [format, mimeType] of [
    ['jpeg', 'image/jpeg'],
    ['webp', 'image/webp']
  ]) {
    const bytes = await sharp(await png())
      [format]()
      .toBuffer();
    const verified = await verifyTaskImage(bytes, mimeType);
    assert.equal(verified.width, 3);
    assert.equal(verified.height, 2);
    const input = {
      workspaceId: f.workspace.id,
      documentId: f.document.id,
      attachmentId: randomUUID(),
      fileName: `image.${format}`,
      mimeType,
      bytes
    };
    const staged = await f.files.stage(input);
    staged.commit();
    await assert.rejects(f.files.stage(input), { code: 'TASK_WORKSPACE_CONFLICT' });
    assert.deepEqual(
      (
        await f.files.read({
          ...staged.metadata,
          id: input.attachmentId,
          documentId: input.documentId,
          status: 'ready'
        })
      ).bytes,
      bytes
    );
    staged.discard(); // 已commit文件不可被迟到清理删除。
    assert.equal(fs.existsSync(path.join(f.root, 'uploads', staged.metadata.storageKey)), true);
  }
});

test('上传已commit后授权撤销只拒绝响应，附件仍完整；未commit则回滚', async t => {
  const f = fixture(t);
  let valid = true;
  const store = {
    available: true,
    readSnapshot: callback => f.store.readSnapshot(callback),
    runTransaction(callback) {
      const result = f.store.runTransaction(callback);
      valid = false;
      return result;
    }
  };
  const service = createTaskWorkspaceService({ store, files: f.files, authorize: () => valid });
  await assert.rejects(
    service.uploadAttachment(f.user, {
      operationId: randomUUID(),
      workspaceId: f.workspace.id,
      documentId: f.document.id,
      expectedRevision: 1,
      fileName: 'committed.png',
      mimeType: 'image/png',
      bytes: await png()
    }),
    { code: 'TASK_WORKSPACE_FORBIDDEN' }
  );
  const attachment = readTaskWorkspaceSnapshot(f.db).documents[0].attachments[0];
  assert.ok(attachment);
  assert.equal((await f.files.read(attachment)).width, 3);
});

test('只读和已结束事务不能写，哈希/索引损坏显式阻断新域', t => {
  const f = fixture(t);
  let escaped;
  f.store.runTransaction(tx => {
    escaped = tx;
  });
  const record = f.store.readSnapshot(tx => tx.get('documents', f.document.id));
  assert.throws(() => escaped.replace('documents', record), { code: 'TASK_WORKSPACE_READ_ONLY' });
  assert.throws(() => f.store.readSnapshot(tx => tx.replace('documents', record)), {
    code: 'TASK_WORKSPACE_READ_ONLY'
  });
  f.db.prepare('UPDATE task_workspace_documents SET revision = revision + 1 WHERE id = ?').run(record.id);
  assert.throws(() => createSqliteTaskWorkspaceStore(f.db), /索引与资料不一致/);
});

test('空扩展亦验证schema主键/列/索引，不能因没有记录接受坏表', t => {
  const f = fixture(t);
  f.db.exec('DROP INDEX task_workspace_attempts_scope');
  assert.throws(() => createSqliteTaskWorkspaceStore(f.db), /索引结构无效/);
});

test('第二SQLite连接持有写锁时返回可重试冲突，不泄漏数据库错误', t => {
  const f = fixture(t),
    second = f.open();
  second.db.exec('BEGIN IMMEDIATE');
  try {
    assert.throws(() => f.store.runTransaction(() => {}), { code: 'TASK_WORKSPACE_CONFLICT', status: 409 });
  } finally {
    second.db.exec('ROLLBACK');
  }
  assert.equal(f.store.readSnapshot(tx => tx.list('workspaces')).length, 1);
});

test('最终持久提交guard位于校验和宿主hook之后，撤权/超时不落库', t => {
  const f = fixture(t);
  let allowed = true,
    expire = false;
  const store = createSqliteTaskWorkspaceStore(f.db, {
    beforeCommit() {
      if (expire) allowed = false;
    }
  });
  const service = createTaskWorkspaceService({ store, files: f.files, authorize: () => allowed });
  const before = readTaskWorkspaceSnapshot(f.db);
  expire = true;
  assert.throws(() => service.createWorkspace(f.user, { operationId: randomUUID(), name: '迟到写入' }), {
    code: 'TASK_WORKSPACE_FORBIDDEN'
  });
  assert.deepEqual(readTaskWorkspaceSnapshot(f.db), before);
  for (const finalGuard of [() => false, () => Promise.resolve(true)]) {
    assert.throws(
      () =>
        store.runTransaction(
          tx => {
            const w = tx.get('workspaces', f.workspace.id);
            w.name = '不会提交';
            tx.replace('workspaces', w);
          },
          { beforeCommit: finalGuard }
        ),
      { code: 'TASK_WORKSPACE_FORBIDDEN' }
    );
    assert.deepEqual(readTaskWorkspaceSnapshot(f.db), before);
  }
  let escaped;
  store.readSnapshot(tx => {
    escaped = tx;
  });
  for (const read of [
    () => escaped.identity(),
    () => escaped.get('workspaces', f.workspace.id),
    () => escaped.list('workspaces')
  ])
    assert.throws(read, { code: 'TASK_WORKSPACE_READ_ONLY' });
});

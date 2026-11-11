import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createSqliteDataStore } from '../src/sqlite-data-store.mjs';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.js';
import { createConversationAttachmentService } from '../../api/src/modules/ai/conversation-attachments.js';
import { createRuntimeBackup, inspectRuntimeBackup, restoreRuntimeBackup, listRuntimeBackups } from '../src/backup.mjs';
import { prepareRestoredDirectory } from '../src/restore-directory.mjs';
import { temporaryDirectory } from './helpers.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const ownerId = 'demo';
const assertNotParsed = record => {
  assert.equal(record.parseStatus, 'not_parsed');
  assert.equal(record.errorCode, 'AI_ATTACHMENT_NOT_PARSED');
  assert.equal(record.parserVersion, null);
  assert.equal(record.parsedTextHash, null);
  assert.equal(record.imageMetadata, null);
  assert.deepEqual(record.segments, []);
};
async function fixture(t, driver = 'sqlite') {
  const root = temporaryDirectory(t),
    file = path.join(root, driver === 'sqlite' ? 'local.sqlite' : 'data.json');
  let data, service;
  const open = () => {
    data = driver === 'sqlite' ? createSqliteDataStore(file) : createFileDataStore(file);
    service = createConversationAttachmentService({
      conversationStore: data.aiConversationStore,
      uploadsDir: path.join(root, 'uploads'),
      ownerId
    });
  };
  const close = async () => {
    await service?.close();
    data?.close?.();
  };
  open();
  t.after(close);
  const conversation = await data.aiConversationStore.createConversation({
    ownerId,
    actorId: ownerId,
    spaceId: 'synthetic-space'
  });
  return {
    root,
    file,
    conversation,
    get data() {
      return data;
    },
    get service() {
      return service;
    },
    close,
    restart: async () => {
      await close();
      open();
    },
    upload: (uploadKey = 'synthetic-upload-1', text = '合成私有附件正文：只留在当前对话。') =>
      service.upload({
        conversationId: conversation.conversationId,
        uploadKey,
        fileName: '合成资料.txt',
        mimeType: 'text/plain',
        bytes: Buffer.from(text)
      })
  };
}
const stagedInput = (conversationId, suffix, size = 1) => ({
  ownerId,
  conversationId,
  uploadKey: `quota-upload-${suffix}`,
  fileName: `${suffix}.txt`,
  mimeType: 'text/plain',
  size,
  sha256: digest(Buffer.from(suffix))
});
const removedPatch = {
  storageStatus: 'removed',
  parseStatus: 'failed',
  errorCode: 'AI_ATTACHMENT_REMOVED',
  removedAt: '2026-10-04T00:00:00.000Z',
  cleanupStatus: 'pending',
  segments: [],
  parsedTextHash: null,
  imageMetadata: null,
  parserVersion: null
};

for (const driver of ['json', 'sqlite'])
  test(`${driver} 对话附件原文件与移除墓碑跨重启保存，保持未解析且不进入业务导出或同步`, async t => {
    const f = await fixture(t, driver),
      before = driver === 'sqlite' ? f.data.readOutbox() : f.data.exportSnapshot();
    const attachment = await f.upload();
    assert.equal(attachment.storageStatus, 'ready');
    assertNotParsed(attachment);
    const duplicate = await f.upload();
    assert.equal(duplicate.attachmentId, attachment.attachmentId);
    await assert.rejects(f.upload('synthetic-upload-1', '同一请求键的其他正文'), { code: 'AI_IDEMPOTENCY_CONFLICT' });
    const exported = JSON.stringify(f.data.exportSnapshot());
    for (const value of [attachment.attachmentId, '合成私有附件正文', 'ai-conversations', 'conversationAttachments'])
      assert.equal(exported.includes(value), false);
    if (driver === 'sqlite') assert.deepEqual(f.data.readOutbox(), before);
    await f.restart();
    const read = await f.service.readVerified({
      conversationId: f.conversation.conversationId,
      attachmentId: attachment.attachmentId
    });
    assert.equal(read.bytes.toString(), '合成私有附件正文：只留在当前对话。');
    assertNotParsed(read.record);
    assert.deepEqual(read.segments, []);
    const removed = await f.service.remove({
      conversationId: f.conversation.conversationId,
      attachmentId: attachment.attachmentId,
      expectedRevision: read.record.revision
    });
    assert.equal(removed.cleanupStatus, 'complete');
    assert.deepEqual(removed.segments, []);
    await f.restart();
    assert.equal((await f.data.aiConversationStore.getAttachment(attachment.attachmentId)).storageStatus, 'removed');
    assert.equal((await f.upload()).storageStatus, 'removed', '重复上传不能复活同一请求键已移除的附件');
    await assert.rejects(
      f.service.readVerified({ conversationId: f.conversation.conversationId, attachmentId: attachment.attachmentId }),
      { code: 'AI_ATTACHMENT_REMOVED' }
    );
    assert.equal(
      fs.existsSync(path.join(f.root, 'uploads', 'ai-conversations', `${attachment.attachmentId}.bin`)),
      false
    );
  });

test('SQLite 同一上传键并发幂等，文件数及总字节配额在事务中生效，墓碑释放配额', async t => {
  const f = await fixture(t),
    store = f.data.aiConversationStore,
    id = f.conversation.conversationId;
  const same = stagedInput(id, 'same');
  const duplicates = await Promise.all([store.stageAttachment(same), store.stageAttachment(same)]);
  assert.equal(duplicates[0].attachmentId, duplicates[1].attachmentId);
  const outcomes = await Promise.allSettled(
    Array.from({ length: 20 }, (_, n) => store.stageAttachment(stagedInput(id, `count-${n}`)))
  );
  assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 19);
  assert.equal(
    outcomes.filter(row => row.status === 'rejected' && row.reason.code === 'AI_ATTACHMENT_QUOTA_EXCEEDED').length,
    1
  );
  assert.equal((await store.listAttachments(id)).length, 20);
  await store.updateAttachment({
    ownerId,
    attachmentId: duplicates[0].attachmentId,
    expectedRevision: 1,
    patch: removedPatch
  });
  await store.stageAttachment(stagedInput(id, 'replacement'));
  const bytesConversation = await store.createConversation({ ownerId, actorId: ownerId, spaceId: 'synthetic-space' });
  const byteResults = await Promise.allSettled(
    Array.from({ length: 6 }, (_, n) =>
      store.stageAttachment(stagedInput(bytesConversation.conversationId, `bytes-${n}`, 5 * 1024 * 1024))
    )
  );
  assert.equal(byteResults.filter(row => row.status === 'fulfilled').length, 5);
  assert.equal(byteResults.find(row => row.status === 'rejected').reason.code, 'AI_ATTACHMENT_QUOTA_EXCEEDED');
  await f.restart();
  assert.equal((await f.data.aiConversationStore.listAttachments(id)).filter(row => !row.removedAt).length, 20);
});

test('SQLite 移除文件失败保留撤销状态，重启继续清理且附件不会复活', async t => {
  const f = await fixture(t),
    attachment = await f.upload();
  const target = path.join(f.root, 'uploads', 'ai-conversations', `${attachment.attachmentId}.bin`);
  const original = `${target}.original`;
  fs.renameSync(target, original);
  fs.symlinkSync(original, target);
  await assert.rejects(
    f.service.remove({
      conversationId: f.conversation.conversationId,
      attachmentId: attachment.attachmentId,
      expectedRevision: attachment.revision
    }),
    { code: 'AI_ATTACHMENT_STORAGE_INVALID' }
  );
  assert.equal((await f.data.aiConversationStore.getAttachment(attachment.attachmentId)).cleanupStatus, 'pending');
  fs.unlinkSync(target);
  fs.renameSync(original, target);
  await f.restart();
  await f.service.recover();
  const removed = await f.data.aiConversationStore.getAttachment(attachment.attachmentId);
  assert.equal(removed.cleanupStatus, 'complete');
  assert.deepEqual(removed.segments, []);
  await assert.rejects(
    f.service.readVerified({ conversationId: f.conversation.conversationId, attachmentId: attachment.attachmentId }),
    { code: 'AI_ATTACHMENT_REMOVED' }
  );
});

test('SQLite epoch 切换后旧附件拒绝读取、修改与重新上传，原历史记录保留', async t => {
  const f = await fixture(t),
    attachment = await f.upload();
  f.data.aiRepository.rotateEpoch();
  await f.restart();
  await assert.rejects(
    f.service.readVerified({ conversationId: f.conversation.conversationId, attachmentId: attachment.attachmentId }),
    { code: 'AI_DATASET_STALE' }
  );
  await assert.rejects(f.upload('new-epoch-upload'), { code: 'AI_DATASET_STALE' });
  await assert.rejects(
    f.data.aiConversationStore.updateAttachment({
      ownerId,
      attachmentId: attachment.attachmentId,
      expectedRevision: attachment.revision,
      patch: removedPatch
    }),
    { code: 'AI_DATASET_STALE' }
  );
  const retained = await f.data.aiConversationStore.getAttachment(attachment.attachmentId);
  assert.equal(retained.sha256, attachment.sha256);
  assertNotParsed(retained);
  assert.deepEqual(await f.service.recover(), []);
});

test('完整 App 备份保存并恢复对话附件原文件与未解析状态，正式恢复仍切换 epoch', async t => {
  const f = await fixture(t),
    attachment = await f.upload(),
    backup = createRuntimeBackup(f.data, f.root);
  assert.equal(inspectRuntimeBackup(backup).valid, true);
  const restored = path.join(f.root, 'raw-restored');
  restoreRuntimeBackup(backup, restored);
  const store = createSqliteDataStore(path.join(restored, 'local.sqlite'));
  const service = createConversationAttachmentService({
    conversationStore: store.aiConversationStore,
    uploadsDir: path.join(restored, 'uploads'),
    ownerId
  });
  try {
    const read = await service.readVerified({
      conversationId: f.conversation.conversationId,
      attachmentId: attachment.attachmentId
    });
    assert.equal(digest(read.bytes), attachment.sha256);
    assertNotParsed(read.record);
    assert.equal(read.bytes.length, attachment.size);
  } finally {
    await service.close();
    store.close();
  }
  const active = prepareRestoredDirectory(f.root, backup),
    activeStore = createSqliteDataStore(path.join(active, 'local.sqlite'));
  const activeService = createConversationAttachmentService({
    conversationStore: activeStore.aiConversationStore,
    uploadsDir: path.join(active, 'uploads'),
    ownerId
  });
  try {
    assert.notEqual(activeStore.aiRepository.identity().datasetEpoch, attachment.datasetEpoch);
    assert.equal(
      (await activeStore.aiConversationStore.getAttachment(attachment.attachmentId)).sha256,
      attachment.sha256
    );
    await assert.rejects(
      activeService.readVerified({
        conversationId: f.conversation.conversationId,
        attachmentId: attachment.attachmentId
      }),
      { code: 'AI_DATASET_STALE' }
    );
  } finally {
    await activeService.close();
    activeStore.close();
  }
});

test('完整 App 备份拒绝对话附件缺失及篡改，即使重签文件清单仍检查私有记录原哈希', async t => {
  const f = await fixture(t),
    attachment = await f.upload();
  const relative = `uploads/ai-conversations/${attachment.attachmentId}.bin`;
  for (const kind of ['missing', 'tampered', 'resigned']) {
    const backup = createRuntimeBackup(f.data, f.root),
      file = path.join(backup, relative);
    if (kind === 'missing') fs.unlinkSync(file);
    else fs.writeFileSync(file, '被替换的合成附件');
    if (kind === 'resigned') {
      const manifestPath = path.join(backup, 'manifest.json'),
        manifest = JSON.parse(fs.readFileSync(manifestPath));
      const bytes = fs.readFileSync(file),
        entry = manifest.files.find(row => row.path === relative);
      entry.size = bytes.length;
      entry.sha256 = digest(bytes);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    }
    assert.throws(() => inspectRuntimeBackup(backup), /完整性|对话附件.*校验失败/);
  }
  assert.equal(
    (
      await f.service.readVerified({
        conversationId: f.conversation.conversationId,
        attachmentId: attachment.attachmentId
      })
    ).record.sha256,
    attachment.sha256
  );
});

test('创建或恢复前保护备份拒绝源对话附件缺失/改写，不发布无效成功备份', async t => {
  const f = await fixture(t),
    attachment = await f.upload();
  const file = path.join(f.root, 'uploads', 'ai-conversations', `${attachment.attachmentId}.bin`);
  const original = fs.readFileSync(file),
    known = listRuntimeBackups(f.root);
  for (const purpose of ['manual', 'before-restore']) {
    for (const state of ['missing', 'modified']) {
      if (state === 'missing') fs.unlinkSync(file);
      else fs.writeFileSync(file, '已改写的合成附件');
      assert.throws(() => createRuntimeBackup(f.data, f.root, { purpose }), /对话附件.*校验失败/);
      assert.deepEqual(listRuntimeBackups(f.root), known);
      assert.deepEqual(fs.readdirSync(path.join(f.root, 'backups')), [], '失败备份不留下目录或清单');
      fs.writeFileSync(file, original);
    }
  }
  const good = createRuntimeBackup(f.data, f.root, { purpose: 'before-restore' });
  assert.equal(inspectRuntimeBackup(good).valid, true);
});

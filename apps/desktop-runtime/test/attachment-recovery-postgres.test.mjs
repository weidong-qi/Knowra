import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createPostgresAppContext } from '../../api/src/postgres-app.factory.ts';
import { temporaryDirectory } from './helpers.mjs';

import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';

const enabled = Boolean(process.env.KNOWRA_SYNC_TEST_DATABASE_URL);
test('真实 PostgreSQL 附件缺失损坏、同 ID 恢复、历史预检及清理', { skip: !enabled, timeout: 60000 }, async t => {
  const database = await createPostgresTestDatabase();
  t.after(() => database.close());
  const { databaseUrl } = database;
  assert(['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname));
  assert.equal(process.env.KNOWRA_SYNC_TEST_ALLOW_WRITES, '1');
  const root = temporaryDirectory(t);
  const app = await createPostgresAppContext({
    databaseUrl,
    storageRootDir: root,
    uploadsDir: path.join(root, 'uploads')
  });
  t.after(() => app.close());
  const knowledge = app.modules.knowledge;
  const space = await knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const note = await knowledge.noteService.createNote({ spaceId: space.id, title: '附件恢复测试', rawMarkdown: '' });
  const payload = {
    noteId: note.id,
    fileName: '原文件.txt',
    contentBase64: Buffer.from('original').toString('base64')
  };
  const original = await app.http.storage.uploadAttachment(payload);
  const params = { id: original.id };
  const file = path.join(root, original.storagePath);
  fs.unlinkSync(file);
  await assert.rejects(() => app.http.storage.getAttachmentContent(params), { code: 'ATTACHMENT_FILE_MISSING' });
  assert.equal((await app.repositories.attachmentRepository.findById(original.id)).status, 'missing');
  await assert.rejects(
    () => app.http.storage.restoreAttachment(params, { contentBase64: Buffer.from('wrong').toString('base64') }),
    { code: 'ATTACHMENT_RESTORE_MISMATCH' }
  );
  assert.equal((await app.http.storage.restoreAttachment(params, payload)).id, original.id);
  fs.writeFileSync(file, 'bad');
  await assert.rejects(() => app.http.storage.getAttachmentContent(params), { code: 'ATTACHMENT_FILE_CORRUPT' });
  const save = app.repositories.attachmentRepository.save;
  app.repositories.attachmentRepository.save = async record => {
    await save(record);
    throw new Error('故障注入：数据库提交失败');
  };
  await assert.rejects(() => app.http.storage.restoreAttachment(params, payload), /数据库提交失败/);
  app.repositories.attachmentRepository.save = save;
  assert.equal(fs.readFileSync(file, 'utf8'), 'bad');
  assert.equal((await app.repositories.attachmentRepository.findById(original.id)).status, 'corrupt');
  fs.writeFileSync(file, 'original');
  assert.equal((await app.http.storage.verifyAttachment(params)).status, 'ready');
  const encoded = original.id.replace(/^a/, '%61');
  await knowledge.noteService.updateNote(note.id, {
    rawMarkdown: `/api/storage/attachments/${encoded}/content#attachment=other`
  });
  assert((await app.http.storage.inspectAttachmentDeletion(params)).references.length > 0);
  await assert.rejects(() => app.http.storage.deleteAttachment(params), { code: 'ATTACHMENT_REFERENCED' });
  const disposable = await app.http.storage.uploadAttachment({ ...payload, fileName: '可删除.txt' });
  assert.equal((await app.http.storage.deleteAttachment({ id: disposable.id })).cleanup, 'complete');
  assert.equal((await app.http.storage.listAttachmentCleanup()).pending, 0);
  for (const action of ['delete', 'rename']) {
    const concurrent = await app.http.storage.uploadAttachment({ ...payload, fileName: `并发-${action}.txt` });
    const concurrentFile = path.join(root, concurrent.storagePath);
    fs.writeFileSync(concurrentFile, 'bad');
    await app.http.storage.verifyAttachment({ id: concurrent.id });
    const find = app.repositories.attachmentRepository.findById;
    let reads = 0;
    app.repositories.attachmentRepository.findById = async id => {
      const record = await find(id);
      if (id === concurrent.id && ++reads === 2) {
        // 模拟另一个服务实例提交，绕开本实例串行维护门禁。
        if (action === 'delete') await app.prisma.attachment.delete({ where: { id } });
        else {
          const nextPath = path.join(root, 'uploads', `${id}-并发改名.txt`);
          fs.renameSync(concurrentFile, nextPath);
          await app.prisma.attachment.update({
            where: { id },
            data: { fileName: '并发改名.txt', storagePath: path.relative(root, nextPath) }
          });
        }
      }
      return record;
    };
    try {
      await assert.rejects(() => app.http.storage.restoreAttachment({ id: concurrent.id }, payload), {
        code: 'ATTACHMENT_CHANGED'
      });
    } finally {
      app.repositories.attachmentRepository.findById = find;
    }
    const remaining = await find(concurrent.id);
    if (action === 'delete') assert.equal(remaining, null, '恢复不得复活并发删除的 ID');
    else {
      assert.equal(remaining.fileName, '并发改名.txt');
      assert.equal(
        fs.readFileSync(path.join(root, remaining.storagePath), 'utf8'),
        'bad',
        '恢复不得覆盖并发改名后的路径'
      );
    }
  }
});

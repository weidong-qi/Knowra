import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createPostgresAppContext } from '../../api/src/postgres-app.factory.ts';
import { temporaryDirectory } from './helpers.mjs';

import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';

const enabled = Boolean(process.env.KNOWRA_SYNC_TEST_DATABASE_URL);

test('阶段2 真实 PostgreSQL：知识点引用复核、墓碑导入保护与空间迁移', { skip: !enabled, timeout: 60000 }, async t => {
  const database = await createPostgresTestDatabase();
  t.after(() => database.close());
  const { databaseUrl } = database;
  const url = new URL(databaseUrl);
  assert(['127.0.0.1', 'localhost'].includes(url.hostname), '只能使用回环测试数据库');
  assert.equal(process.env.KNOWRA_SYNC_TEST_ALLOW_WRITES, '1', '需要显式允许临时库测试写入');
  const root = temporaryDirectory(t);
  const app = await createPostgresAppContext({
    databaseUrl,
    storageRootDir: root,
    uploadsDir: path.join(root, 'uploads')
  });
  t.after(() => app.close());
  const knowledge = app.modules.knowledge;
  const defaultSpace = await knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const source = await knowledge.knowledgeSpaceService.createKnowledgeSpace({
    userId: 'demo',
    name: `迁移源 ${randomUUID()}`
  });
  const target = await knowledge.knowledgeSpaceService.createKnowledgeSpace({
    userId: 'demo',
    name: `迁移目标 ${randomUUID()}`
  });
  const note = await knowledge.noteService.createNote({
    spaceId: source.id,
    title: `迁移笔记 ${randomUUID()}`,
    rawMarkdown: '空间迁移正文'
  });
  const preview = await knowledge.previewSpaceMigration(source.id, target.id);
  assert.equal(preview.decision, 'can-migrate');
  const migrated = await knowledge.migrateSpaceAssets(source.id, {
    targetSpaceId: target.id,
    expectedPreviewHash: preview.previewHash
  });
  assert.equal(migrated.status, 'scoped-assets-migrated');
  assert.equal((await knowledge.noteService.getNote(note.id)).spaceId, target.id);
  assert.equal((await knowledge.inspectEmptySpaceDeletion(defaultSpace.id)).decision, 'system-shell-protected');
  const emptied = await knowledge.inspectEmptySpaceDeletion(source.id);
  assert.equal(emptied.decision, 'can-delete-empty-container');
  assert.equal(
    (await knowledge.deleteEmptySpace(source.id, { expectedUpdatedAt: emptied.expectedUpdatedAt })).status,
    'empty-container-deleted'
  );

  const created = await knowledge.knowledgeItemService.createCandidate({
    title: `待清理知识 ${randomUUID()}`,
    canonicalStatement: '测试定义',
    sourceMode: 'manual',
    evidence: [{ sourceType: 'manual', quoteText: '专属来源' }]
  });
  const itemId = created.item.id;
  const oldBackup = await app.http.storage.exportKnowledgeBase();
  const trashed = await knowledge.knowledgeItemService.trash(itemId);
  const purgePreview = await knowledge.inspectKnowledgePurge(itemId);
  assert.equal(purgePreview.decision, 'can-purge-no-history');
  assert.equal(purgePreview.exclusiveRecords.knowledgeEvidenceIds.length, 1);
  const purged = await knowledge.permanentlyDeleteKnowledgeItem(itemId, { expectedUpdatedAt: trashed.updatedAt });
  assert.equal(purged.status, 'subject-purged');
  const repeated = await knowledge.permanentlyDeleteKnowledgeItem(itemId, { expectedUpdatedAt: trashed.updatedAt });
  assert.equal(repeated.status, 'already-purged');
  await assert.rejects(
    () =>
      knowledge.knowledgeItemService.createCandidate({
        id: itemId,
        title: '迟到的 AI 回写',
        canonicalStatement: '旧内容'
      }),
    error => error.code === 'KNOWLEDGE_ITEM_ID_DELETED'
  );
  assert.equal(await knowledge.repositories.knowledgeItemRepository.findById(itemId), null);
  const journal = await app.prisma.syncJournal.findUnique({ where: { ownerId: 'demo' } });
  assert(journal.payload.tombstones[JSON.stringify(['knowledgeItems', itemId])]);
  await assert.rejects(
    () => app.http.storage.importKnowledgeBase(oldBackup),
    error => error.code === 'IMPORT_DELETED_ID'
  );
  assert.equal(await knowledge.repositories.knowledgeItemRepository.findById(itemId), null);

  const attachment = await app.http.storage.uploadAttachment({
    noteId: note.id,
    fileName: '待清理.txt',
    mimeType: 'text/plain',
    contentBase64: Buffer.from('独立附件').toString('base64')
  });
  assert.equal((await app.http.storage.inspectAttachmentDeletion({ id: attachment.id })).references.length, 0);
  const deletedAttachment = await app.http.storage.deleteAttachment({ id: attachment.id });
  assert.equal(deletedAttachment.cleanup, 'complete');
  assert.equal(await app.repositories.attachmentRepository.findById(attachment.id), null);
  assert.deepEqual(await app.http.storage.retryAttachmentCleanup(), { completed: 0, pending: 0 });

  const disposable = await knowledge.noteService.createNote({
    spaceId: target.id,
    title: `带附件笔记 ${randomUUID()}`,
    rawMarkdown: '可清理正文'
  });
  const childAttachment = await app.http.storage.uploadAttachment({
    noteId: disposable.id,
    fileName: '子附件.txt',
    mimeType: 'text/plain',
    contentBase64: Buffer.from('子附件内容').toString('base64')
  });
  await knowledge.noteService.deleteNote(disposable.id);
  const noteResult = await app.http.knowledge.permanentlyDeleteNote({ id: disposable.id });
  assert.deepEqual(noteResult.attachmentCleanup, [{ id: childAttachment.id, cleanup: 'complete' }]);
  assert.equal(await app.repositories.attachmentRepository.findById(childAttachment.id), null);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { syntheticPdf } from '../../../scripts/test-support/pdf-fixtures.mjs';
import { validatePdfRelations } from '@study-accelerator/shared/pdf';
import { createAppError } from '../src/errors/app-error.js';
import { createPostgresAppContext } from '../src/postgres-app.factory.js';
import { createPostgresKnowledgeModule } from '../src/modules/knowledge/postgres-async-module.js';
import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';

export const spaceAssetLifecyclePostgresTests =
  process.env.KNOWRA_SYNC_TEST_DATABASE_URL && process.env.KNOWRA_SYNC_TEST_ALLOW_WRITES === '1'
    ? [
        {
          name: '真实 PostgreSQL 空间生命周期：事务回滚、系统组映射、原入口迁移与删除',
          async run() {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-space-lifecycle-pg-'));
            const ownerId = `space-lifecycle-${randomUUID()}`;
            let database, app;
            try {
              database = await createPostgresTestDatabase();
              app = await createPostgresAppContext({
                databaseUrl: database.databaseUrl,
                ownerId,
                storageRootDir: root
              });
              const source = await app.http.knowledge.createKnowledgeSpace({ name: '合成来源' });
              const target = await app.http.knowledge.createKnowledgeSpace({ name: '合成目标' });
              const knowledge = app.modules.knowledge;
              const group = await knowledge.tagGroupService.createTagGroup({
                spaceId: source.id,
                name: '合成分组',
                selectionMode: 'multiple'
              });
              const tag = await knowledge.tagService.createTag({
                spaceId: source.id,
                groupId: group.id,
                name: '合成标签'
              });
              const systemTag = await knowledge.tagService.createTag({
                spaceId: source.id,
                groupId: `tag-group-${source.id}-ordinary`,
                name: '系统分组标签'
              });
              const note = await knowledge.noteService.createNote({
                spaceId: source.id,
                title: '合成笔记',
                rawMarkdown: '仅测试资料',
                tagIds: [tag.id, systemTag.id]
              });
              const pdfNote = await app.http.pdf.importPdf(
                { operationId: 'space-migration', spaceId: source.id, fileName: '空间迁移.pdf' },
                Readable.from([syntheticPdf()])
              );
              for (const id of ['pdf-live', 'pdf-deleted'])
                await app.http.pdf.mutate(pdfNote.id, id, {
                  operationId: `create-${id}`,
                  expectedRevision: 0,
                  type: 'region',
                  segments: [{ pageIndex: 0, rect: [10, 10, 40, 40] }]
                });
              await app.http.pdf.mutate(
                pdfNote.id,
                'pdf-deleted',
                { operationId: 'delete-pdf', expectedRevision: 1 },
                true
              );
              const readPdfMarks = () =>
                app.repositories.pdfAnnotationRepository.list({ spaceId: source.id, includeDeleted: true });
              const originalMarks = await readPdfMarks();
              // 在真正数据库事务的业务回调完成后注入失败，证明已执行的全部迁移仍由 PG 回滚。
              const failing = createPostgresKnowledgeModule({
                ...app.repositories,
                client: {
                  $transaction: (operation, options) =>
                    app.prisma.$transaction(async tx => {
                      await operation(tx);
                      throw createAppError('SYNTHETIC_COMMIT_FAILURE', '合成提交前失败', 500);
                    }, options)
                }
              });
              let preview = await knowledge.previewSpaceMigration(source.id, target.id, ownerId);
              let input = { targetSpaceId: target.id, expectedPreviewHash: preview.previewHash };
              assert.equal(preview.counts.pdfAnnotations, 2);
              await assert.rejects(failing.migrateSpaceAssets(source.id, input, ownerId), {
                message: '合成提交前失败'
              });
              assert.equal((await app.repositories.noteRepository.findById(note.id)).spaceId, source.id);
              assert.equal((await app.repositories.tagGroupRepository.findById(group.id)).spaceId, source.id);
              assert.equal(
                (await app.repositories.tagRepository.findById(systemTag.id)).groupId,
                `tag-group-${source.id}-ordinary`
              );
              assert.equal((await app.repositories.noteRepository.findById(pdfNote.id)).spaceId, source.id);
              assert.deepEqual(await readPdfMarks(), originalMarks);
              assert.deepEqual(await knowledge.previewSpaceMigration(source.id, target.id, ownerId), preview);
              await app.http.pdf.mutate(pdfNote.id, 'pdf-live', {
                operationId: 'change-preview',
                expectedRevision: 1,
                comment: '预览后修改'
              });
              await assert.rejects(knowledge.migrateSpaceAssets(source.id, input, ownerId), {
                code: 'SPACE_MIGRATION_PREVIEW_STALE'
              });
              preview = await knowledge.previewSpaceMigration(source.id, target.id, ownerId);
              input = { ...input, expectedPreviewHash: preview.previewHash };
              const beforeMigration = await readPdfMarks();
              await assert.rejects(
                knowledge.migrateSpaceAssets(source.id, { ...input, expectedPreviewHash: 'stale' }, ownerId),
                { code: 'SPACE_MIGRATION_PREVIEW_STALE' }
              );
              await assert.rejects(knowledge.migrateSpaceAssets(source.id, input, 'foreign-owner'), {
                code: 'KNOWLEDGE_SPACE_NOT_FOUND'
              });
              assert.equal(
                (await knowledge.migrateSpaceAssets(source.id, input, ownerId)).status,
                'scoped-assets-migrated'
              );
              assert.equal((await app.repositories.noteRepository.findById(note.id)).spaceId, target.id);
              const movedPdf = await app.repositories.noteRepository.findById(pdfNote.id);
              const movedMarks = await app.repositories.pdfAnnotationRepository.list({
                spaceId: target.id,
                includeDeleted: true
              });
              assert.equal(movedPdf.spaceId, target.id);
              assert.deepEqual(
                movedMarks,
                beforeMigration.map(item => ({ ...item, spaceId: target.id, revision: item.revision + 1 }))
              );
              await assert.rejects(
                app.http.pdf.mutate(pdfNote.id, 'pdf-live', {
                  operationId: 'stale-after-move',
                  expectedRevision: 2,
                  comment: '旧窗口保存'
                }),
                { code: 'PDF_ANNOTATION_CONFLICT' }
              );
              validatePdfRelations({
                notes: [movedPdf],
                attachments: [await app.http.pdf.requireAttachment(pdfNote.pdfSource.attachmentId)],
                pdfAnnotations: movedMarks
              });
              assert.deepEqual(await readPdfMarks(), []);
              assert.equal((await app.repositories.tagGroupRepository.findById(group.id)).spaceId, target.id);
              assert.equal(
                (await app.repositories.tagRepository.findById(systemTag.id)).groupId,
                `tag-group-${target.id}-ordinary`
              );
              const empty = await knowledge.inspectEmptySpaceDeletion(source.id, ownerId);
              assert.equal(empty.decision, 'can-delete-empty-container');
              await assert.rejects(
                failing.deleteEmptySpace(source.id, { expectedUpdatedAt: empty.expectedUpdatedAt }, ownerId),
                { message: '合成提交前失败' }
              );
              assert.deepEqual(await knowledge.inspectEmptySpaceDeletion(source.id, ownerId), empty);
              assert.equal(
                (await knowledge.deleteEmptySpace(source.id, { expectedUpdatedAt: empty.expectedUpdatedAt }, ownerId))
                  .status,
                'empty-container-deleted'
              );
              assert.equal(await app.repositories.knowledgeSpaceRepository.findById(source.id), null);
            } finally {
              try {
                await app?.close();
              } finally {
                try {
                  await database?.close();
                } finally {
                  fs.rmSync(root, { recursive: true, force: true });
                }
              }
            }
          }
        }
      ]
    : [];

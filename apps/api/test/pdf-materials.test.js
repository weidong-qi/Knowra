import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { once } from 'node:events';
import http from 'node:http';
import { zipSync, strToU8 } from 'fflate';
import { createAppContext } from '../src/app.factory.js';
import { createFileDataStore } from '../src/infrastructure/file-data-store.js';
import { createServer } from '../src/server.js';
import { MAX_PDF_BYTES, validatePdfRelations } from '@study-accelerator/shared/pdf';
import { syntheticPdf } from '../../../scripts/test-support/pdf-fixtures.mjs';

async function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-pdf-api-'));
  const store = createFileDataStore(path.join(root, 'data.json'));
  const context = createAppContext({ dataStore: store, storageRootDir: root, uploadsDir: path.join(root, 'uploads') });
  const space = context.modules.knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const server = createServer({ appContext: context, logger: { error() {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const pdf = context.http.pdf;
  const input = { operationId: 'fixture', spaceId: space.id, fileName: '测试.pdf' };
  try {
    await run({ root, store, context, space, pdf, input, origin });
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
}
export const pdfMaterialsTests = [
  {
    name: 'PDF 空间迁移包含标注与墓碑：预览失效、同事务回滚与重启一致性',
    run: () =>
      fixture(async ({ pdf, input, context, store, root }) => {
        const knowledge = context.modules.knowledge;
        const note = await pdf.importPdf(input, Readable.from([syntheticPdf()]));
        const target = knowledge.knowledgeSpaceService.createKnowledgeSpace({ userId: 'demo', name: '目标空间' });
        for (const id of ['live', 'deleted']) {
          await pdf.mutate(note.id, id, {
            operationId: `create-${id}`,
            expectedRevision: 0,
            type: 'region',
            segments: [{ pageIndex: 0, rect: [10, 10, 40, 40] }]
          });
        }
        await pdf.mutate(note.id, 'deleted', { operationId: 'delete', expectedRevision: 1 }, true);
        const preview = knowledge.previewSpaceMigration(input.spaceId, target.id, 'demo');
        assert.equal(preview.counts.pdfAnnotations, 2);
        await pdf.mutate(note.id, 'live', { operationId: 'edit', expectedRevision: 1, comment: '预览后修改评论' });
        assert.throws(
          () =>
            knowledge.migrateSpaceAssets(
              input.spaceId,
              { targetSpaceId: target.id, expectedPreviewHash: preview.previewHash },
              'demo'
            ),
          { code: 'SPACE_MIGRATION_PREVIEW_STALE' }
        );
        const current = knowledge.previewSpaceMigration(input.spaceId, target.id, 'demo');
        assert.notEqual(current.previewHash, preview.previewHash);
        const migration = { targetSpaceId: target.id, expectedPreviewHash: current.previewHash };
        const before = structuredClone(store.state);
        const repository = knowledge.repositories.pdfAnnotationRepository;
        const save = repository.save;
        repository.save = record => {
          const saved = save(record);
          if (record.id === 'deleted') throw new Error('模拟 PDF 标注迁移失败');
          return saved;
        };
        try {
          assert.throws(() => knowledge.migrateSpaceAssets(input.spaceId, migration, 'demo'), /PDF 标注迁移失败/);
        } finally {
          repository.save = save;
        }
        assert.deepEqual(store.state, before);
        assert.equal(knowledge.migrateSpaceAssets(input.spaceId, migration, 'demo').status, 'scoped-assets-migrated');
        assert.equal(store.state.notes.find(item => item.id === note.id).spaceId, target.id);
        assert.deepEqual(
          store.state.pdfAnnotations,
          before.pdfAnnotations.map(item => ({ ...item, spaceId: target.id, revision: item.revision + 1 }))
        );
        await assert.rejects(
          pdf.mutate(note.id, 'live', { operationId: 'stale-after-move', expectedRevision: 2, comment: '旧窗口保存' }),
          { code: 'PDF_ANNOTATION_CONFLICT' }
        );
        validatePdfRelations(store.state);
        const reopened = createFileDataStore(path.join(root, 'data.json'));
        assert.deepEqual(reopened.state.pdfAnnotations, store.state.pdfAnnotations);
        validatePdfRelations(reopened.state);
      })
  },
  {
    name: 'PDF 独立资料与标注：幂等、并发、重启、原文件身份和原子回滚',
    run: () =>
      fixture(async ({ pdf, input, store, root, context }) => {
        const bytes = syntheticPdf();
        const note = await pdf.importPdf(input, Readable.from([bytes]));
        assert.equal(note.contentKind, 'pdf');
        assert.equal(note.rawMarkdown, '');
        assert.equal(store.state.noteVersions.length, 0);
        assert.equal((await pdf.importPdf(input, Readable.from([bytes]))).id, note.id);
        const originalCreate = context.modules.knowledge.noteService.createNote;
        context.modules.knowledge.noteService.createNote = () => {
          throw new Error('模拟资料提交失败');
        };
        try {
          await assert.rejects(
            pdf.importPdf({ ...input, operationId: 'rollback' }, Readable.from([bytes])),
            /资料提交失败/
          );
        } finally {
          context.modules.knowledge.noteService.createNote = originalCreate;
        }
        assert.equal(store.state.attachments.length, 1);
        assert.equal(
          fs.readdirSync(path.join(root, 'uploads')).some(name => name.includes('rollback')),
          false
        );
        const other = await pdf.importPdf({ ...input, operationId: 'same-title' }, Readable.from([bytes]));
        assert.equal(other.title, '测试 2');
        await assert.rejects(pdf.importPdf({ ...input, fileName: 'different.pdf' }, Readable.from([bytes])), {
          code: 'OPERATION_REUSED'
        });
        const body = {
          operationId: 'create',
          expectedRevision: 0,
          type: 'highlight',
          segments: [{ pageIndex: 0, rect: [40, 100, 200, 120] }],
          quoteText: 'Knowra',
          comment: '重要公式'
        };
        const mark = await pdf.mutate(note.id, 'highlight', body);
        assert.deepEqual(await pdf.mutate(note.id, 'highlight', body), mark);
        await assert.rejects(pdf.mutate(note.id, 'highlight', { ...body, operationId: 'other' }), {
          code: 'PDF_ANNOTATION_CONFLICT'
        });
        await assert.rejects(pdf.mutate(note.id, 'highlight', { ...body, comment: '改写同一操作' }), {
          code: 'OPERATION_REUSED'
        });
        const reopened = createFileDataStore(path.join(root, 'data.json'));
        assert.equal(reopened.state.pdfAnnotations[0].quoteText, 'Knowra');
        assert.throws(() => context.modules.knowledge.noteService.updateNote(note.id, { rawMarkdown: '覆盖 PDF' }), {
          code: 'PDF_IMMUTABLE'
        });
        assert.equal(
          (await context.http.storage.inspectAttachmentDeletion({ id: note.pdfSource.attachmentId })).decision,
          'requires-dependency-action'
        );
        await assert.rejects(
          pdf.restore(
            note.pdfSource.attachmentId,
            Readable.from([syntheticPdf({ pages: [{ text: 'changed', width: 420, height: 595 }] })])
          ),
          { code: 'ATTACHMENT_RESTORE_MISMATCH' }
        );
        context.modules.knowledge.noteService.deleteNote(note.id);
        await assert.rejects(pdf.mutate(note.id, 'highlight', { operationId: 'trash', expectedRevision: 1 }), {
          code: 'NOTE_NOT_FOUND'
        });
        context.modules.knowledge.noteService.restoreNote(note.id);
        assert.equal((await pdf.list(note.id)).length, 1);
        await pdf.mutate(note.id, 'highlight', { operationId: 'delete', expectedRevision: 1 }, true);
        assert.equal((await pdf.list(note.id)).length, 0);
      })
  },
  {
    name: 'PDF 流式 HTTP：Range、HEAD、50 MiB 边界、错误文件与取消无半成品',
    run: () =>
      fixture(async ({ pdf, input, store, origin }) => {
        const bytes = syntheticPdf();
        const note = await pdf.importPdf(input, Readable.from([bytes]));
        const fileUrl = `${origin}/api/storage/pdf-files/${note.pdfSource.attachmentId}`;
        let response = await fetch(fileUrl, { headers: { Range: 'bytes=0-4' } });
        assert.equal(response.status, 206);
        assert.equal(await response.text(), '%PDF-');
        response = await fetch(fileUrl, { method: 'HEAD' });
        assert.equal(Number(response.headers.get('content-length')), bytes.length);
        assert.equal((await response.arrayBuffer()).byteLength, 0);
        response = await fetch(fileUrl, { headers: { Range: 'bytes=1-2,4-5' } });
        assert.equal(response.status, 416);
        assert.equal((await fetch(fileUrl, { headers: { Range: `bytes=${bytes.length}-` } })).status, 416);
        await assert.rejects(pdf.importPdf({ ...input, operationId: 'bad' }, Readable.from(['not-pdf'])), {
          code: 'PDF_FORMAT_INVALID'
        });
        const incomplete = async function* () {
          yield bytes;
          throw new Error('interrupted');
        };
        await assert.rejects(
          pdf.importPdf({ ...input, operationId: 'aborted' }, Readable.from(incomplete())),
          /interrupted/
        );
        const chunk = Buffer.alloc(1024 * 1024, 32);
        bytes.copy(chunk);
        const large = async function* (extra) {
          for (let i = 0; i < 50; i++) yield chunk;
          if (extra) yield Buffer.from([1]);
        };
        const largeNote = await pdf.importPdf({ ...input, operationId: 'large' }, Readable.from(large(false)));
        assert.equal((await pdf.requireAttachment(largeNote.pdfSource.attachmentId)).size, MAX_PDF_BYTES);
        await assert.rejects(pdf.importPdf({ ...input, operationId: 'too-large' }, Readable.from(large(true))), {
          code: 'PDF_TOO_LARGE'
        });
        assert.equal(store.state.notes.length, 2);
        assert.equal(
          store.state.notes.some(note => note.id === 'pdf-aborted'),
          false
        );
        assert.equal(
          (
            await fetch(`${origin}/api/knowledge/notes`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                spaceId: input.spaceId,
                title: '伪装PDF',
                rawMarkdown: '',
                contentKind: 'pdf',
                pdfSource: note.pdfSource
              })
            })
          ).status,
          422
        );
      })
  },
  {
    name: 'PDF ZIP 备份恢复：哈希、路径、数据库预检、恢复前保护与旧 JSON',
    run: () =>
      fixture(async ({ pdf, input, store, context }) => {
        const note = await pdf.importPdf(input, Readable.from([syntheticPdf()]));
        await pdf.mutate(note.id, 'region', {
          operationId: 'region',
          expectedRevision: 0,
          type: 'region',
          segments: [{ pageIndex: 0, rect: [10, 10, 40, 40] }]
        });
        const chunks = [];
        const output = new Writable({
          write(chunk, _encoding, next) {
            chunks.push(chunk);
            next();
          }
        });
        await pdf.archive.export(output);
        const bytes = Buffer.concat(chunks);
        const preview = await pdf.archive.inspect(Readable.from([bytes]));
        assert.equal(preview.pdfs, 1);
        assert.equal(preview.annotations, 1);
        const restored = await pdf.archive.restore(preview.token);
        assert.equal(restored.restored, true);
        assert(fs.existsSync(pdf.archive.backupFile(restored.backupId)));
        assert.equal(store.state.pdfAnnotations[0].id, 'region');
        await assert.rejects(
          pdf.archive.inspect(Readable.from([zipSync({ '../escape': strToU8('bad') }, { level: 0 })]))
        );
        await assert.rejects(pdf.archive.inspect(Readable.from([bytes.subarray(0, -7)])), {
          code: 'ARCHIVE_INCOMPLETE'
        });
        const failurePreview = await pdf.archive.inspect(Readable.from([bytes]));
        const before = structuredClone(store.state);
        const commit = store.commitImport;
        store.commitImport = () => {
          throw new Error('模拟元数据提交失败');
        };
        try {
          await assert.rejects(pdf.archive.restore(failurePreview.token), /元数据提交失败/);
        } finally {
          store.commitImport = commit;
        }
        assert.deepEqual(store.state, before);
        assert.equal(
          fs
            .readFileSync(await pdf.files.inspect(await pdf.requireAttachment(note.pdfSource.attachmentId)))
            .subarray(0, 5)
            .toString(),
          '%PDF-'
        );
        pdf.archive.cancel(failurePreview.token);
        const next = await pdf.archive.inspect(Readable.from([bytes]));
        context.modules.knowledge.noteService.updateNote(note.id, { title: '恢复预览后修改' });
        await assert.rejects(pdf.archive.restore(next.token), { code: 'ARCHIVE_CHANGED' });
        assert.equal(store.state.notes[0].title, '恢复预览后修改');
        const legacy = await context.http.storage.exportKnowledgeBase();
        const legacyPreview = await pdf.archive.inspectLegacy(legacy);
        assert.equal(legacyPreview.pdfs, 1);
        pdf.archive.cancel(legacyPreview.token);
      })
  },
  {
    name: 'PDF 备份预检在响应送达前被取消时，按操作 ID 释放名额（含检查尚未完成）',
    run: () =>
      fixture(async ({ pdf, context, origin }) => {
        const body = JSON.stringify(await context.http.storage.exportKnowledgeBase());
        const operations = ['aaaaaaaa-1', 'aaaaaaaa-2', 'aaaaaaaa-3', 'aaaaaaaa-4'];
        for (const operationId of operations) {
          const request = http.request(`${origin}/api/storage/archive/inspect`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
              'X-Knowra-Operation-Id': operationId
            }
          });
          const closed = new Promise(resolve => request.once('close', resolve));
          request.on('error', () => undefined);
          request.end(body, () => request.destroy());
          await closed;
        }
        // 取消请求可能先于或晚于检查完成；两种顺序都不得占用名额。
        for (const operationId of operations)
          assert.equal(
            (await fetch(`${origin}/api/storage/archive/operations/${operationId}`, { method: 'DELETE' })).status,
            200
          );
        await new Promise(resolve => setTimeout(resolve, 100));
        const preview = await pdf.archive.inspectLegacy(await context.http.storage.exportKnowledgeBase());
        const tokens = [preview.token];
        for (let index = 0; index < 2; index += 1)
          tokens.push((await pdf.archive.inspectLegacy(await context.http.storage.exportKnowledgeBase())).token);
        for (const token of tokens) pdf.archive.cancel(token);
        // 已取消的操作 ID 即使检查晚到完成也直接丢弃。
        await assert.rejects(
          pdf.archive.inspectLegacy(await context.http.storage.exportKnowledgeBase(), 'aaaaaaaa-1'),
          {
            code: 'ARCHIVE_CANCELLED'
          }
        );
      })
  }
];

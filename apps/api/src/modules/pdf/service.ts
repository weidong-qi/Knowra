import type {
  PdfServiceOptions,
  BinaryStream,
  PdfImportInput,
  PdfMutationInput,
  PdfStoredAnnotation
} from './contracts.ts';
import { createPdfArchive } from './archive.ts';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { PDF_KINDS, validatePdfAnnotation } from '@study-accelerator/shared/pdf';
import { createLocalAttachmentFileManager } from '../../infrastructure/local-attachment-file-manager.ts';
import { sanitizeFileName } from '../../infrastructure/local-attachment-store-utils.ts';
import { createPdfRepository } from './repository.ts';
import { createPdfFiles, pdfError, stagePdf } from './files.ts';

const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,150}$/.test(value);
export function createPdfService({
  dataStore = null,
  db = null,
  postgres = null,
  knowledge,
  uploadsDir,
  storageRootDir,
  ownerId,
  maintenanceGate = null,
  beforeImport = async () => {}
}: PdfServiceOptions) {
  const repo = createPdfRepository({ dataStore, db, knowledge, ownerId, postgres });
  const files = createPdfFiles(createLocalAttachmentFileManager({ uploadsDir, storageRootDir }));
  async function requireNote(id: string, includeDeleted = false) {
    const note = await repo.getNote(id);
    const space = note && (await repo.getSpace(note.spaceId));
    if (!note || (!includeDeleted && note.deleted) || note.contentKind !== 'pdf' || space?.userId !== ownerId)
      throw pdfError('NOTE_NOT_FOUND', 'PDF 资料不存在。', 404);
    return note;
  }
  async function requireAttachment(id: string) {
    const attachment = await repo.getAttachment(id);
    if (!attachment) throw pdfError('ATTACHMENT_NOT_FOUND', 'PDF 原文件不存在。', 404);
    const note = await repo.getNote(attachment.noteId);
    const space = note && (await repo.getSpace(note.spaceId));
    if (!note || space?.userId !== ownerId || attachment.mimeType !== 'application/pdf')
      throw pdfError('ATTACHMENT_NOT_FOUND', 'PDF 文件不存在。', 404);
    if (
      note.contentKind === 'pdf' &&
      (note.pdfSource!.attachmentId !== id || note.pdfSource!.sha256 !== attachment.sha256)
    )
      throw pdfError('PDF_SOURCE_CHANGED', 'PDF 主文件身份不匹配。', 409);
    return attachment;
  }
  const service = {
    isPdfFile: async (id: string) => (await repo.getAttachment(id))?.mimeType === 'application/pdf',
    requireNote,
    requireAttachment,
    files,
    archive: createPdfArchive({
      dataStore,
      db,
      files,
      ownerId,
      storageRootDir,
      maintenanceGate,
      beforeImport,
      postgres
    }),
    async importPdf(input: PdfImportInput, stream: BinaryStream) {
      if (!identifier(input.operationId) || typeof input.fileName !== 'string' || input.fileName.length > 512)
        throw pdfError('PDF_IMPORT_INVALID', 'PDF 导入参数无效。');
      const space = await repo.getSpace(input.spaceId);
      if (!space || space.userId !== ownerId) throw pdfError('SPACE_NOT_FOUND', '知识空间不存在。', 404);
      if (input.folderId) {
        const folder = await repo.getFolder(input.folderId);
        if (!folder || folder.deletedAt || folder.spaceId !== space.id)
          throw pdfError('FOLDER_NOT_FOUND', '目标文件夹不存在。', 404);
      }
      const staged = await stagePdf(stream, uploadsDir);
      const importRequestHash = createHash('sha256')
        .update(
          JSON.stringify({
            spaceId: space.id,
            folderId: input.folderId || null,
            fileName: input.fileName,
            title: input.title ?? null,
            sha256: staged.sha256
          })
        )
        .digest('hex');
      const id = `pdf-${input.operationId}`;
      const attachmentId = `attachment-${id}`;
      let published = false,
        destination;
      try {
        const existing = await repo.getNote(id);
        if (existing) {
          if (
            existing.deleted ||
            existing.contentKind !== 'pdf' ||
            existing.spaceId !== space.id ||
            existing.pdfSource!.sha256 !== staged.sha256 ||
            existing.pdfSource!.importRequestHash !== importRequestHash
          )
            throw pdfError('OPERATION_REUSED', '此导入操作已用于其他文件。', 409);
          return existing;
        }
        const base =
          String(input.title || input.fileName.replace(/\.pdf$/i, ''))
            .trim()
            .slice(0, 200) || 'PDF 资料';
        const title = base;
        let stem = sanitizeFileName(input.fileName).replace(/\.pdf$/i, '');
        while (Buffer.byteLength(stem, 'utf8') > 76) stem = Array.from(stem).slice(0, -1).join('');
        const fileName = `${stem || 'PDF'}.pdf`;
        destination = files.fileManager.resolveManagedAbsolutePath(attachmentId, fileName);
        // 操作 ID 确定目标；只发布相同字节，重试不能覆盖另一个文件。
        try {
          fs.linkSync(staged.file, destination);
          published = true;
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
          const hash = createHash('sha256');
          for await (const chunk of fs.createReadStream(destination)) hash.update(chunk);
          if (hash.digest('hex') !== staged.sha256) throw pdfError('OPERATION_REUSED', '导入操作与原文件不一致。', 409);
        }
        const now = new Date().toISOString();
        const attachment = {
          id: attachmentId,
          noteId: id,
          fileName,
          mimeType: 'application/pdf',
          size: staged.size,
          sha256: staged.sha256,
          status: 'ready' as const,
          storagePath: files.fileManager.buildStoragePath(attachmentId, fileName),
          createdAt: now,
          verifiedAt: now
        };
        return await repo.importPdf(
          {
            id,
            title,
            spaceId: space.id,
            folderId: input.folderId || null,
            rawMarkdown: '',
            contentKind: 'pdf',
            pdfSource: { attachmentId, sha256: staged.sha256, importRequestHash },
            sourceType: 'pdf-import',
            createdAt: now,
            updatedAt: now
          },
          attachment
        );
      } catch (error) {
        if (published) {
          const current = await repo.getAttachment(attachmentId);
          if (!current || files.fileManager.resolveManagedAbsolutePath(current.id, current.fileName) !== destination)
            fs.rmSync(destination!, { force: true });
        }
        throw error;
      } finally {
        fs.rmSync(staged.file, { force: true });
      }
    },
    async restore(id: string, stream: BinaryStream) {
      const attachment = await requireAttachment(id);
      const staged = await stagePdf(stream, uploadsDir);
      try {
        if (staged.size !== attachment.size || staged.sha256 !== attachment.sha256)
          throw pdfError('ATTACHMENT_RESTORE_MISMATCH', '所选文件与原 PDF 不一致。');
        const current = await requireAttachment(id);
        if (current.sha256 !== attachment.sha256 || current.fileName !== attachment.fileName)
          throw pdfError('ATTACHMENT_CHANGED', 'PDF 已变化，请重试。', 409);
        const target = files.fileManager.resolveManagedAbsolutePath(id, current.fileName);
        fs.renameSync(staged.file, target);
        return await repo.setReady(current);
      } finally {
        fs.rmSync(staged.file, { force: true });
      }
    },
    async list(noteId: string) {
      await requireNote(noteId);
      return (await repo.listAnnotations(noteId)).filter(item => !item.deletedAt);
    },
    async mutate(noteId: string, id: string, input: PdfMutationInput, remove = false) {
      const note = await requireNote(noteId);
      if (!identifier(id) || !identifier(input.operationId))
        throw pdfError('PDF_ANNOTATION_INVALID', '标注操作标识无效。');
      const hash = createHash('sha256')
        .update(JSON.stringify({ ...input, remove }))
        .digest('hex');
      return repo.writeAnnotation(noteId, id, previous => {
        if (previous && previous.noteId !== noteId) throw pdfError('PDF_ANNOTATION_NOT_FOUND', '标注不存在。', 404);
        if (previous && previous.operationId === input.operationId) {
          if (previous.requestHash !== hash) throw pdfError('OPERATION_REUSED', '标注操作内容发生变化。', 409);
          return previous;
        }
        if ((previous?.revision ?? 0) !== input.expectedRevision || previous?.deletedAt)
          throw pdfError('PDF_ANNOTATION_CONFLICT', '标注已变化，请刷新后核对；草稿已保留。', 409);
        if (remove && !previous) throw pdfError('PDF_ANNOTATION_NOT_FOUND', '标注不存在。', 404);
        const now = new Date().toISOString();
        const next = {
          ...(previous ?? {
            id,
            noteId,
            spaceId: note.spaceId,
            ...note.pdfSource,
            type: input.type,
            segments: input.segments,
            quoteText: input.quoteText ?? '',
            createdAt: now
          }),
          kind: input.kind ?? previous?.kind ?? PDF_KINDS[0],
          comment: input.comment ?? previous?.comment ?? '',
          revision: (previous?.revision ?? 0) + 1,
          operationId: input.operationId,
          requestHash: hash,
          updatedAt: now,
          deletedAt: remove ? now : null
        };
        // 旧标注带有已取消的“重要程度”，写入时一并丢弃。
        delete (next as { importance?: unknown }).importance;
        try {
          validatePdfAnnotation(next);
        } catch {
          throw pdfError('PDF_ANNOTATION_INVALID', '标注内容或位置无效。');
        }
        return next as PdfStoredAnnotation;
      });
    }
  };
  if (!maintenanceGate) return service;
  return {
    ...service,
    importPdf: (...args: Parameters<typeof service.importPdf>) =>
      maintenanceGate.runMutation(() => service.importPdf(...args)),
    restore: (...args: Parameters<typeof service.restore>) =>
      maintenanceGate.runMutation(() => service.restore(...args)),
    mutate: (...args: Parameters<typeof service.mutate>) => maintenanceGate.runMutation(() => service.mutate(...args))
  };
}

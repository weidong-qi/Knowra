import { validatePdfAnnotation } from '@study-accelerator/shared/pdf';
function readAnnotation(value: unknown): PdfStoredAnnotation {
  validatePdfAnnotation(value);
  return value as PdfStoredAnnotation;
}
import type {
  PdfRepositoryOptions,
  PdfNoteRecord,
  PdfNewNote,
  PdfFolder,
  PdfAttachment,
  PdfStoredAnnotation
} from './contracts.ts';
import { Note } from '../knowledge/domain/note.ts';
import { pdfError } from './files.ts';

function uniqueTitle(
  note: { title: string; folderId?: string | null },
  notes: Array<{ title: string; folderId: string | null; deleted?: boolean; deletedAt?: string | Date | null }>,
  folders: PdfFolder[]
) {
  const names = new Set([
    ...notes
      .filter(item => !item.deleted && !item.deletedAt && (item.folderId ?? null) === (note.folderId ?? null))
      .map(item => item.title),
    ...folders
      .filter(item => !item.deletedAt && (item.parentId ?? null) === (note.folderId ?? null))
      .map(item => item.name)
  ]);
  let title = note.title,
    suffix = 2;
  while (names.has(title)) title = `${note.title} ${suffix++}`;
  return title;
}
function existingImport(existing: PdfNoteRecord, note: PdfNewNote) {
  if (
    existing.deleted ||
    existing.deletedAt ||
    (['attachmentId', 'sha256', 'importRequestHash'] as const).some(
      key => existing.pdfSource?.[key] !== note.pdfSource?.[key]
    )
  )
    throw pdfError('OPERATION_REUSED', '此导入操作已用于其他文件。', 409);
  return existing;
}
export function createPdfRepository({ dataStore, db, knowledge, ownerId, postgres }: PdfRepositoryOptions) {
  const repositories = knowledge.repositories;
  function assertBound(
    note: Pick<PdfNoteRecord, 'contentKind' | 'spaceId' | 'pdfSource'>,
    annotation: PdfStoredAnnotation
  ) {
    if (
      note.contentKind !== 'pdf' ||
      note.spaceId !== annotation.spaceId ||
      note.pdfSource?.attachmentId !== annotation.attachmentId ||
      note.pdfSource?.sha256 !== annotation.sha256
    )
      throw pdfError('PDF_SOURCE_CHANGED', 'PDF 来源已变化，标注草稿已保留。', 409);
  }
  return {
    getNote: (id: string) => repositories.noteRepository.findById(id),
    getSpace: (id: string | null | undefined) => repositories.knowledgeSpaceRepository.findById(id),
    getFolder: (id: string) => repositories.folderRepository.findById(id),
    listNotes: (spaceId: string) => repositories.noteRepository.list({ spaceId }),
    async getAttachment(id: string): Promise<PdfAttachment | null | undefined> {
      if (dataStore) return dataStore.state.attachments.find(item => item.id === id);
      const current = await db!.attachment.findUnique({ where: { id } });
      return current
        ? {
            ...current,
            createdAt: current.createdAt.toISOString(),
            verifiedAt: current.verifiedAt?.toISOString() ?? null,
            status: current.status as PdfAttachment['status']
          }
        : null;
    },
    async importPdf(note: PdfNewNote, attachment: PdfAttachment) {
      if (dataStore)
        return dataStore.runTransaction(() => {
          const existing = dataStore.state.notes.find(item => item.id === note.id);
          if (existing) return existingImport(existing, note);
          dataStore.state.attachments.push(attachment);
          return knowledge.noteService.createNote({
            ...note,
            title: uniqueTitle(
              note,
              dataStore.state.notes.filter(item => item.spaceId === note.spaceId),
              dataStore.state.folders.filter(item => item.spaceId === note.spaceId)
            )
          });
        });
      const { buildNoteData, mapNote } = postgres!;
      return db!.$transaction(async tx => {
        const existing = await tx.note.findUnique({ where: { id: note.id } });
        if (existing) return existingImport(mapNote(existing)!, note);
        const space = await tx.knowledgeSpace.findUnique({ where: { id: note.spaceId } });
        const folder = note.folderId ? await tx.folder.findUnique({ where: { id: note.folderId } }) : null;
        if (
          !space ||
          space.userId !== ownerId ||
          (note.folderId && (!folder || folder.deletedAt || folder.spaceId !== note.spaceId))
        )
          throw pdfError('PDF_TARGET_CHANGED', '目标空间或文件夹已变化，请重新导入。', 409);
        const value = new Note({
          ...note,
          title: uniqueTitle(
            note,
            await tx.note.findMany({ where: { spaceId: note.spaceId } }),
            await tx.folder.findMany({ where: { spaceId: note.spaceId } })
          )
        });
        await tx.note.create({ data: buildNoteData(value) });
        await tx.attachment.create({
          data: {
            ...attachment,
            createdAt: new Date(attachment.createdAt!),
            verifiedAt: new Date(attachment.verifiedAt!)
          }
        });
        return value;
      });
    },
    async listAnnotations(noteId: string): Promise<PdfStoredAnnotation[]> {
      return dataStore
        ? structuredClone(dataStore.state.pdfAnnotations.filter(item => item.noteId === noteId))
        : (await db!.pdfAnnotation.findMany({ where: { noteId }, orderBy: { id: 'asc' } })).map(row =>
            readAnnotation(row.payload)
          );
    },
    async writeAnnotation(
      noteId: string,
      id: string,
      update: (previous: PdfStoredAnnotation | null) => PdfStoredAnnotation
    ) {
      if (dataStore)
        return dataStore.runTransaction(() => {
          const note = dataStore.state.notes.find(item => item.id === noteId);
          if (!note || note.deleted) throw pdfError('NOTE_NOT_FOUND', '资料不存在。', 404);
          const index = dataStore.state.pdfAnnotations.findIndex(item => item.id === id);
          const next = update(index < 0 ? null : dataStore.state.pdfAnnotations[index]);
          assertBound(note, next);
          if (index < 0) dataStore.state.pdfAnnotations.push(next);
          else dataStore.state.pdfAnnotations[index] = next;
          dataStore.flush();
          return structuredClone(next);
        });
      return db!.$transaction(async tx => {
        const note = await tx.note.findUnique({ where: { id: noteId } });
        if (!note || note.deletedAt) throw pdfError('NOTE_NOT_FOUND', '资料不存在。', 404);
        const row = await tx.pdfAnnotation.findUnique({ where: { id } });
        const next = update(row ? readAnnotation(row.payload) : null);
        assertBound(postgres!.mapNote(note)!, next);
        if (!row)
          await tx.pdfAnnotation.create({
            data: {
              id,
              noteId,
              revision: next.revision,
              payload: { ...next, segments: next.segments.map(segment => ({ ...segment })) }
            }
          });
        else {
          const result = await tx.pdfAnnotation.updateMany({
            where: { id, revision: row.revision },
            data: {
              revision: next.revision,
              payload: { ...next, segments: next.segments.map(segment => ({ ...segment })) }
            }
          });
          if (result.count !== 1) throw pdfError('PDF_ANNOTATION_CONFLICT', '标注已在其他位置修改，请刷新核对。', 409);
        }
        return next;
      });
    },
    async setReady(attachment: PdfAttachment) {
      if (dataStore)
        return dataStore.runTransaction(() => {
          const current = dataStore.state.attachments.find(item => item.id === attachment.id);
          if (!current || current.sha256 !== attachment.sha256)
            throw pdfError('ATTACHMENT_CHANGED', 'PDF 文件身份已变化。', 409);
          current.status = 'ready';
          current.verifiedAt = new Date().toISOString();
          dataStore.flush();
          return current;
        });
      return db!.attachment.update({ where: { id: attachment.id }, data: { status: 'ready', verifiedAt: new Date() } });
    }
  };
}

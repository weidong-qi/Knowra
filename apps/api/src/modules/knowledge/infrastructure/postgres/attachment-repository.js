import { mapAttachment, toDate } from './mappers.ts';
import { withRepositoryErrors } from './repository-utils.js';

export function createPostgresAttachmentRepository({ db }) {
  if (!db?.attachment) {
    throw new TypeError('PostgreSQL attachment repository requires db.attachment');
  }

  return {
    async save(attachment) {
      const data = {
        id: attachment.id,
        noteId: attachment.noteId,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        size: Number(attachment.size),
        sha256: attachment.sha256 ?? null,
        status: attachment.status ?? 'ready',
        storagePath: attachment.storagePath,
        verifiedAt: attachment.verifiedAt ? toDate(attachment.verifiedAt) : null,
        createdAt: toDate(attachment.createdAt)
      };
      return withRepositoryErrors(async () =>
        mapAttachment(
          await db.attachment.upsert({
            where: { id: data.id },
            create: data,
            update: {
              noteId: data.noteId,
              fileName: data.fileName,
              mimeType: data.mimeType,
              size: data.size,
              sha256: data.sha256,
              status: data.status,
              verifiedAt: data.verifiedAt,
              storagePath: data.storagePath
            }
          })
        )
      );
    },
    async findById(id) {
      return withRepositoryErrors(async () => mapAttachment(await db.attachment.findUnique({ where: { id } })));
    },
    /** @param {{ noteId?: string }} options */
    async list({ noteId } = {}) {
      return withRepositoryErrors(async () =>
        (
          await db.attachment.findMany({
            where: noteId ? { noteId } : {},
            orderBy: { createdAt: 'desc' }
          })
        ).map(mapAttachment)
      );
    },
    async delete(id) {
      return withRepositoryErrors(async () => mapAttachment(await db.attachment.delete({ where: { id } })));
    },
    async deleteByNoteIds(noteIds) {
      if (!noteIds.length) return [];
      const existing = await withRepositoryErrors(() =>
        db.attachment.findMany({
          where: { noteId: { in: noteIds } },
          orderBy: { createdAt: 'asc' }
        })
      );
      await withRepositoryErrors(() =>
        db.attachment.deleteMany({
          where: { noteId: { in: noteIds } }
        })
      );
      return existing.map(mapAttachment);
    },
    supportsAsync: true
  };
}

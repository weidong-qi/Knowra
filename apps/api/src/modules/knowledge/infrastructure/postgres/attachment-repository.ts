import type * as Models from '@prisma/client';
import { mapAttachment, toDate } from './mappers.ts';
import { withRepositoryErrors } from './repository-utils.ts';

interface AttachmentWriteInput extends Omit<
  Models.Attachment,
  'size' | 'sha256' | 'status' | 'verifiedAt' | 'createdAt'
> {
  size: number | string;
  sha256?: string | null;
  status?: string | null;
  verifiedAt?: string | Date | null;
  createdAt?: string | Date | null;
}
interface AttachmentDelegate {
  upsert(input: {
    where: { id: string };
    create: Models.Attachment;
    update: Omit<Models.Attachment, 'id' | 'createdAt'>;
  }): PromiseLike<Models.Attachment>;
  findUnique(input: { where: { id: string } }): PromiseLike<Models.Attachment | null>;
  findMany(input: {
    where: { noteId?: string | { in: string[] } };
    orderBy: { createdAt: 'asc' | 'desc' };
  }): PromiseLike<Models.Attachment[]>;
  delete(input: { where: { id: string } }): PromiseLike<Models.Attachment>;
  deleteMany(input: { where: { noteId: { in: string[] } } }): PromiseLike<{ count: number }>;
}
export interface AttachmentRepositoryOptions {
  db: { attachment: AttachmentDelegate };
}

export function createPostgresAttachmentRepository({ db }: AttachmentRepositoryOptions) {
  if (!db?.attachment) {
    throw new TypeError('PostgreSQL attachment repository requires db.attachment');
  }

  return {
    async save(attachment: AttachmentWriteInput) {
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
    async findById(id: string) {
      return withRepositoryErrors(async () => mapAttachment(await db.attachment.findUnique({ where: { id } })));
    },
    async list({ noteId }: { noteId?: string } = {}) {
      return withRepositoryErrors(async () =>
        (
          await db.attachment.findMany({
            where: noteId ? { noteId } : {},
            orderBy: { createdAt: 'desc' }
          })
        ).map(mapAttachment)
      );
    },
    async delete(id: string) {
      return withRepositoryErrors(async () => mapAttachment(await db.attachment.delete({ where: { id } })));
    },
    async deleteByNoteIds(noteIds: string[]) {
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

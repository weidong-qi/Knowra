import type * as Models from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { NoteVersion } from '../../domain/note-version.ts';
import type { VersionPageCursor } from '../../domain/note-version-page.ts';
import { mapNoteVersion, toDate } from './mappers.ts';
import { withRepositoryErrors } from './repository-utils.ts';
import { versionPage } from '../../domain/note-version-page.ts';

// Prisma 的查询签名保留 select 与返回字段的关联，不能用重载伪造完整行。
interface NoteVersionDelegate extends Pick<Prisma.TransactionClient['noteVersion'], 'findUnique' | 'findMany'> {
  create(input: { data: Prisma.NoteVersionUncheckedCreateInput }): PromiseLike<Models.NoteVersion>;
  count(input: { where: { noteId: string } }): PromiseLike<number>;
  deleteMany(input: { where: { noteId: { in: string[] } } }): PromiseLike<{ count: number }>;
}
export interface NoteVersionRepositoryOptions {
  db: { noteVersion: NoteVersionDelegate };
}
interface VersionListOptions {
  noteId?: string;
}
interface VersionPageListOptions {
  noteId: string;
  limit: number;
  after?: VersionPageCursor | null;
  currentContentHash: string;
}

export function createPostgresNoteVersionRepository({ db }: NoteVersionRepositoryOptions) {
  if (!db?.noteVersion) throw new TypeError('PostgreSQL NoteVersion repository requires db.noteVersion');
  return {
    async save(version: NoteVersion) {
      const data = {
        id: version.id,
        noteId: version.noteId,
        content: version.content,
        contentHash: version.contentHash,
        createdAt: toDate(version.createdAt),
        createdBy: version.createdBy
      };
      return withRepositoryErrors(async () => {
        const existing = await db.noteVersion.findUnique({
          where: { noteId_contentHash: { noteId: data.noteId, contentHash: data.contentHash } }
        });
        if (existing) return mapNoteVersion(existing);
        return mapNoteVersion(await db.noteVersion.create({ data }));
      });
    },
    async findById(id: unknown) {
      return withRepositoryErrors(() =>
        db.noteVersion.findUnique({ where: { id: id as string } }).then(mapNoteVersion<Models.NoteVersion | null>)
      );
    },
    async findByNoteIdAndContentHash(noteId: unknown, contentHash: unknown) {
      return withRepositoryErrors(() =>
        db.noteVersion
          .findUnique({
            where: { noteId_contentHash: { noteId: noteId as string, contentHash: contentHash as string } }
          })
          .then(mapNoteVersion<Models.NoteVersion | null>)
      );
    },
    list({ noteId }: VersionListOptions = {}) {
      return withRepositoryErrors(() =>
        db.noteVersion
          .findMany({
            where: noteId ? { noteId } : {},
            orderBy: { createdAt: 'desc' }
          })
          .then(rows => rows.map(mapNoteVersion))
      );
    },
    // 只取 ID：保存正文时只需要旧版本标识，不能把每个历史版本的全文都读出来。
    listIds({ noteId }: VersionListOptions = {}) {
      return withRepositoryErrors(() =>
        db.noteVersion
          .findMany({
            where: noteId ? { noteId } : {},
            select: { id: true }
          })
          .then(rows => rows.map(row => row.id))
      );
    },
    listPage({ noteId, limit, after, currentContentHash }: VersionPageListOptions) {
      return withRepositoryErrors(async () => {
        const [items, total, current] = await Promise.all([
          db.noteVersion.findMany({
            where: {
              noteId,
              ...(after
                ? {
                    OR: [
                      { createdAt: { lt: toDate(after.createdAt) } },
                      { createdAt: toDate(after.createdAt), id: { lt: after.id } }
                    ]
                  }
                : {})
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
            select: { id: true, noteId: true, contentHash: true, createdAt: true, createdBy: true }
          }),
          db.noteVersion.count({ where: { noteId } }),
          db.noteVersion.findUnique({
            where: { noteId_contentHash: { noteId, contentHash: currentContentHash } },
            select: { id: true }
          })
        ]);
        return versionPage(items, { limit, total, currentVersionId: current?.id ?? null });
      });
    },
    deleteByNoteIds(noteIds: string[]) {
      if (!noteIds.length) return Promise.resolve([]);
      return withRepositoryErrors(async () => {
        const rows = await db.noteVersion.findMany({ where: { noteId: { in: noteIds } } });
        await db.noteVersion.deleteMany({ where: { noteId: { in: noteIds } } });
        return rows.map(mapNoteVersion);
      });
    },
    supportsAsync: true
  };
}

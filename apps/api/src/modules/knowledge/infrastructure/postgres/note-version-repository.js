import { mapNoteVersion, toDate } from './mappers.ts';
import { withRepositoryErrors } from './repository-utils.js';
import { versionPage } from '../../domain/note-version-page.js';

export function createPostgresNoteVersionRepository({ db }) {
  if (!db?.noteVersion) throw new TypeError('PostgreSQL NoteVersion repository requires db.noteVersion');
  return {
    async save(version) {
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
    async findById(id) {
      return withRepositoryErrors(() => db.noteVersion.findUnique({ where: { id } }).then(mapNoteVersion));
    },
    async findByNoteIdAndContentHash(noteId, contentHash) {
      return withRepositoryErrors(() =>
        db.noteVersion.findUnique({ where: { noteId_contentHash: { noteId, contentHash } } }).then(mapNoteVersion)
      );
    },
    /** @param {{ noteId?: string }} options */
    list({ noteId } = {}) {
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
    /** @param {{ noteId?: string }} options */
    listIds({ noteId } = {}) {
      return withRepositoryErrors(() =>
        db.noteVersion
          .findMany({
            where: noteId ? { noteId } : {},
            select: { id: true }
          })
          .then(rows => rows.map(row => row.id))
      );
    },
    listPage({ noteId, limit, after, currentContentHash }) {
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
    deleteByNoteIds(noteIds) {
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

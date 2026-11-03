import { buildNoteData, mapNote, toDate } from './mappers.ts';
import {
  booleanOption,
  buildNoteOrderBy,
  buildNoteWhere,
  normalizeLimit,
  normalizeOffset,
  noteWithTags,
  replaceNoteTags,
  withRepositoryErrors
} from './repository-utils.js';

export function createPostgresNoteRepository({ db }) {
  if (!db?.note) throw new TypeError('PostgreSQL note repository requires db.note');

  return {
    async save(note, { expectedUpdatedAt = null } = {}) {
      return withRepositoryErrors(
        async () => {
          const data = buildNoteData(note);
          const saveOperation = async tx => {
            const exists = await tx.note.findUnique({ where: { id: data.id } });
            if (exists) {
              data.updatedAt = new Date(Math.max(data.updatedAt.getTime(), new Date(exists.updatedAt).getTime() + 1));
              const { id: _ignoredId, ...updateData } = data;
              if (expectedUpdatedAt) {
                const result = await tx.note.updateMany({
                  where: {
                    id: data.id,
                    updatedAt: toDate(expectedUpdatedAt)
                  },
                  data: updateData
                });
                if (result.count !== 1) {
                  // 保留既有数据库冲突 Error 的运行原型与字段赋值顺序。
                  /** @type {Error & Partial<Pick<import('../../../../errors/app-error.ts').AppError, 'code'>>} */
                  const conflict = new Error('Concurrent note update');
                  conflict.code = 'P2034';
                  throw conflict;
                }
              } else {
                await tx.note.update({ where: { id: data.id }, data: updateData });
              }
            } else {
              await tx.note.create({ data });
            }
            await replaceNoteTags(tx, data.id, note.tagIds ?? []);
            const saved = await tx.note.findUnique({
              where: { id: data.id },
              include: noteWithTags
            });
            return mapNote(saved);
          };
          return typeof db.$transaction === 'function' ? db.$transaction(saveOperation) : saveOperation(db);
        },
        {
          uniqueCode: 'SIBLING_NAME_CONFLICT',
          uniqueMessage: 'A file or folder with the same name already exists',
          concurrentCode: 'NOTE_UPDATE_CONFLICT',
          concurrentMessage: 'Note has changed since it was loaded'
        }
      );
    },
    async findById(noteId) {
      return withRepositoryErrors(async () =>
        mapNote(
          await db.note.findUnique({
            where: { id: noteId },
            include: noteWithTags
          })
        )
      );
    },
    async findByIds(noteIds) {
      if (!Array.isArray(noteIds) || noteIds.length === 0) return [];
      return withRepositoryErrors(async () =>
        (
          await db.note.findMany({
            where: { id: { in: [...new Set(noteIds)] } },
            include: noteWithTags
          })
        ).map(mapNote)
      );
    },
    async delete(noteId) {
      return withRepositoryErrors(async () =>
        mapNote(
          await db.note.delete({
            where: { id: noteId },
            include: noteWithTags
          })
        )
      );
    },
    async list(options = {}) {
      return withRepositoryErrors(async () => {
        const query = {
          where: buildNoteWhere(options),
          orderBy: buildNoteOrderBy(options),
          skip: normalizeOffset(options.offset),
          include: noteWithTags
        };
        const limit = normalizeLimit(options.limit);
        if (limit !== null) query.take = limit;
        return (await db.note.findMany(query)).map(mapNote);
      });
    },
    async deleteWhere(predicate) {
      const candidates = await withRepositoryErrors(() =>
        db.note
          .findMany({
            where: { deletedAt: { not: null } },
            include: noteWithTags
          })
          .then(rows => rows.map(mapNote))
      );
      const selected = candidates.filter(predicate);
      if (selected.length === 0) return [];
      await withRepositoryErrors(() =>
        db.note.deleteMany({
          where: { id: { in: selected.map(note => note.id) } }
        })
      );
      return selected;
    },
    async count(options = {}) {
      return withRepositoryErrors(() =>
        db.note.count({
          where: buildNoteWhere(options)
        })
      );
    },
    supportsAsync: true,
    supportsBatch: booleanOption
  };
}

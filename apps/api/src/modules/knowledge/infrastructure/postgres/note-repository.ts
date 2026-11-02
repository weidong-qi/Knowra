import type { Prisma } from '@prisma/client';
import type { AppError } from '../../../../errors/app-error.ts';
import type { NoteRow, NoteWriteData, NoteWriteInput } from './mappers.ts';
import type { SyncMappedEntityMap } from '../../../sync/postgres-state-types.ts';
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
} from './repository-utils.ts';

interface NoteSaveInput extends NoteWriteInput {
  id: string;
  tagIds?: string[] | null;
}
/** list/count 接收尚未校验的 HTTP 查询字段，转换仍由原 helper 执行。 */
interface NoteListOptions {
  deletedOnly?: unknown;
  includeDeleted?: unknown;
  spaceId?: unknown;
  folderId?: unknown;
  favoriteOnly?: unknown;
  tagIds?: unknown;
  match?: unknown;
  tagMatch?: unknown;
  tagId?: unknown;
  sortBy?: unknown;
  order?: unknown;
  offset?: unknown;
  limit?: unknown;
}
interface NoteQuery {
  where: Partial<ReturnType<typeof buildNoteWhere>> & { id?: { in: Prisma.JsonValue[] } };
  orderBy?: ReturnType<typeof buildNoteOrderBy>;
  skip?: number;
  take?: number;
  include: { noteTags: boolean };
}
interface NoteDelegate {
  findUnique(input: { where: { id: string }; include?: { noteTags: boolean } }): PromiseLike<NoteRow | null>;
  create<Input extends NoteWriteInput>(input: { data: NoteWriteData<Input> }): PromiseLike<NoteRow>;
  update<Input extends NoteWriteInput>(input: {
    where: { id: string };
    data: Omit<NoteWriteData<Input>, 'id'>;
  }): PromiseLike<NoteRow>;
  updateMany<Input extends NoteWriteInput>(input: {
    where: { id: string; updatedAt: Date };
    data: Omit<NoteWriteData<Input>, 'id'>;
  }): PromiseLike<{ count: number }>;
  findMany(input: NoteQuery): PromiseLike<NoteRow[]>;
  delete(input: { where: { id: string }; include: { noteTags: boolean } }): PromiseLike<NoteRow>;
  deleteMany(input: { where: { id: { in: string[] } } }): PromiseLike<{ count: number }>;
  count(input: { where: ReturnType<typeof buildNoteWhere> }): PromiseLike<number>;
}
interface NoteTransaction {
  note: Pick<NoteDelegate, 'findUnique' | 'create' | 'update' | 'updateMany'>;
  noteTag: {
    deleteMany(input: { where: { noteId: string } }): PromiseLike<{ count: number }>;
    createMany(input: { data: { noteId: string; tagId: string }[] }): PromiseLike<{ count: number }>;
  };
}
export interface NoteRepositoryOptions {
  db: Omit<NoteTransaction, 'note'> & {
    note: NoteDelegate;
    $transaction?<Result>(operation: (tx: NoteTransaction) => Promise<Result>): PromiseLike<Result>;
  };
}

export function createPostgresNoteRepository({ db }: NoteRepositoryOptions) {
  if (!db?.note) throw new TypeError('PostgreSQL note repository requires db.note');

  return {
    async save<Input extends NoteSaveInput>(
      note: Input,
      { expectedUpdatedAt = null }: { expectedUpdatedAt?: string | Date | null } = {}
    ) {
      return withRepositoryErrors(
        async () => {
          const data = buildNoteData(note);
          const saveOperation = async (tx: NoteTransaction) => {
            const exists = await tx.note.findUnique({ where: { id: data.id as Input['id'] } });
            if (exists) {
              data.updatedAt = new Date(Math.max(data.updatedAt.getTime(), new Date(exists.updatedAt).getTime() + 1));
              const { id: _ignoredId, ...updateData } = data;
              if (expectedUpdatedAt) {
                const result = await tx.note.updateMany<Input>({
                  where: {
                    id: data.id as Input['id'],
                    updatedAt: toDate(expectedUpdatedAt)
                  },
                  data: updateData
                });
                if (result.count !== 1) {
                  // 保留既有数据库冲突 Error 的运行原型与字段赋值顺序。
                  const conflict: Partial<AppError> = new Error('Concurrent note update');
                  conflict.code = 'P2034';
                  throw conflict;
                }
              } else {
                await tx.note.update<Input>({ where: { id: data.id as Input['id'] }, data: updateData });
              }
            } else {
              await tx.note.create<Input>({ data });
            }
            await replaceNoteTags(tx, data.id, note.tagIds ?? []);
            const saved = await tx.note.findUnique({
              where: { id: data.id as Input['id'] },
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
    async findById(noteId: string) {
      return withRepositoryErrors(async () =>
        mapNote(
          await db.note.findUnique({
            where: { id: noteId },
            include: noteWithTags
          })
        )
      );
    },
    async findByIds(noteIds: Prisma.JsonValue[]) {
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
    async delete(noteId: string) {
      return withRepositoryErrors(async () =>
        mapNote(
          await db.note.delete({
            where: { id: noteId },
            include: noteWithTags
          })
        )
      );
    },
    async list(options: NoteListOptions = {}) {
      return withRepositoryErrors(async () => {
        const query: NoteQuery = {
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
    async deleteWhere(
      predicate: (note: SyncMappedEntityMap['notes'], index: number, notes: SyncMappedEntityMap['notes'][]) => boolean
    ) {
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
    async count(options: NoteListOptions = {}) {
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

import type { Prisma } from '@prisma/client';
import type { AppError } from '../../../../errors/app-error.ts';
import type { NoteRow, NoteWriteInput } from './mappers.ts';
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
  // DTO/引用策略保留传入标签原值，写入适配器沿用既有去重和数据库校验。
  tagIds?: unknown[] | null;
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
  where: Prisma.NoteWhereInput;
  orderBy?: ReturnType<typeof buildNoteOrderBy>;
  skip?: number;
  take?: number;
  include: { noteTags: boolean };
}
interface NoteDelegate {
  findUnique(input: { where: { id: string }; include?: { noteTags: boolean } }): PromiseLike<NoteRow | null>;
  create(input: { data: Prisma.NoteUncheckedCreateInput }): PromiseLike<NoteRow>;
  update(input: { where: { id: string }; data: Prisma.NoteUncheckedUpdateManyInput }): PromiseLike<NoteRow>;
  updateMany(input: {
    where: { id: string; updatedAt: Date };
    data: Prisma.NoteUncheckedUpdateManyInput;
  }): PromiseLike<{ count: number }>;
  findMany(input: NoteQuery): PromiseLike<NoteRow[]>;
  delete(input: { where: { id: string }; include: { noteTags: boolean } }): PromiseLike<NoteRow>;
  deleteMany(input: { where: { id: { in: string[] } } }): PromiseLike<{ count: number }>;
  count(input: { where: Prisma.NoteWhereInput }): PromiseLike<number>;
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
          // 原始投影不是已校验的写记录；Prisma 仍在原调用位置拒绝非法字段。
          // 只在该写边界指定 SDK 输入，不能反向把读取记录或整个 client 声明为可写。
          const data = buildNoteData(note);
          const saveOperation = async (tx: NoteTransaction) => {
            const exists = await tx.note.findUnique({ where: { id: data.id as Input['id'] } });
            if (exists) {
              data.updatedAt = new Date(Math.max(data.updatedAt.getTime(), new Date(exists.updatedAt).getTime() + 1));
              const { id: _ignoredId, ...updateData } = data;
              if (expectedUpdatedAt) {
                const result = await tx.note.updateMany({
                  where: {
                    id: data.id as Input['id'],
                    updatedAt: toDate(expectedUpdatedAt)
                  },
                  data: updateData as Prisma.NoteUncheckedUpdateManyInput
                });
                if (result.count !== 1) {
                  // 保留既有数据库冲突 Error 的运行原型与字段赋值顺序。
                  const conflict: Partial<AppError> = new Error('Concurrent note update');
                  conflict.code = 'P2034';
                  throw conflict;
                }
              } else {
                await tx.note.update({
                  where: { id: data.id as Input['id'] },
                  data: updateData as Prisma.NoteUncheckedUpdateManyInput
                });
              }
            } else {
              await tx.note.create({ data: data as Prisma.NoteUncheckedCreateInput });
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
            where: { id: { in: [...new Set(noteIds)] as string[] } },
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
          where: buildNoteWhere(options) as Prisma.NoteWhereInput,
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
          where: buildNoteWhere(options) as Prisma.NoteWhereInput
        })
      );
    },
    supportsAsync: true,
    supportsBatch: booleanOption
  };
}

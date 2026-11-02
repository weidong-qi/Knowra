import { withPostgresErrors } from '../../../../infrastructure/postgres-errors.ts';
import type { PostgresErrorOptions } from '../../../../infrastructure/postgres-errors.ts';
import type {
  NoteQueryOptions,
  NoteWhereProjection,
  NoteTagWritePort,
  RawTagIds
} from './knowledge-graph-repository-types.ts';

interface DynamicTagFilter {
  filter(predicate: typeof Boolean): unknown;
}
interface DynamicTagMap {
  map(callback: (tagId: unknown) => object): unknown;
}

export const noteWithTags = { noteTags: true };

export function normalizeOffset(value: unknown) {
  const offset = Number(value ?? 0);
  return Number.isInteger(offset) && offset > 0 ? offset : 0;
}

export function normalizeLimit(value: unknown) {
  const limit = Number(value ?? 0);
  return Number.isInteger(limit) && limit > 0 ? limit : null;
}

export function booleanOption(value: unknown) {
  return value === true || value === 'true';
}

export function buildNoteWhere(options: NoteQueryOptions = {}): NoteWhereProjection {
  const where: NoteWhereProjection = {};
  if (booleanOption(options.deletedOnly)) {
    where.deletedAt = { not: null };
  } else if (!booleanOption(options.includeDeleted)) {
    where.deletedAt = null;
  }
  if (options.spaceId) where.spaceId = options.spaceId;
  if (options.folderId) where.folderId = options.folderId;
  if (booleanOption(options.favoriteOnly)) where.favorite = true;
  const tagIds = Array.isArray(options.tagIds)
    ? (options.tagIds as DynamicTagFilter).filter(Boolean)
    : typeof options.tagIds === 'string'
      ? options.tagIds.split(',').filter(Boolean)
      : [];
  if (((tagIds as { length: unknown }).length as number) > 0) {
    if ((options.match ?? options.tagMatch) === 'any') {
      where.noteTags = { some: { tagId: { in: tagIds } } };
    } else {
      where.AND = (tagIds as DynamicTagMap).map(tagId => ({ noteTags: { some: { tagId } } }));
    }
  } else if (options.tagId) {
    where.noteTags = { some: { tagId: options.tagId } };
  }
  return where;
}

export function buildNoteOrderBy(options: NoteQueryOptions = {}): Partial<Record<PropertyKey, 'asc' | 'desc'>>[] {
  const sortBy = ['createdAt', 'updatedAt', 'title', 'favorite'].includes(options.sortBy as string)
    ? options.sortBy
    : 'updatedAt';
  const order: 'asc' | 'desc' = options.order === 'asc' ? 'asc' : 'desc';
  return [{ favorite: 'desc' }, { [sortBy as PropertyKey]: order }];
}

export async function replaceNoteTags(tx: NoteTagWritePort, noteId: unknown, tagIds: RawTagIds = []) {
  await tx.noteTag.deleteMany({ where: { noteId } });
  if (tagIds.length > 0) {
    await tx.noteTag.createMany({
      data: [...new Set(tagIds)].map(tagId => ({ noteId, tagId }))
    });
  }
}

export async function withRepositoryErrors<Result>(
  operation: () => Result | PromiseLike<Result>,
  options?: PostgresErrorOptions
) {
  return withPostgresErrors(operation, options);
}

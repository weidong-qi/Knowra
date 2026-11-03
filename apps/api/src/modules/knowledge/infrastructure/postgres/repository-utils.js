import { withPostgresErrors } from '../../../../infrastructure/postgres-errors.ts';

export const noteWithTags = { noteTags: true };

export function normalizeOffset(value) {
  const offset = Number(value ?? 0);
  return Number.isInteger(offset) && offset > 0 ? offset : 0;
}

export function normalizeLimit(value) {
  const limit = Number(value ?? 0);
  return Number.isInteger(limit) && limit > 0 ? limit : null;
}

export function booleanOption(value) {
  return value === true || value === 'true';
}

export function buildNoteWhere(options = {}) {
  const where = {};
  if (booleanOption(options.deletedOnly)) {
    where.deletedAt = { not: null };
  } else if (!booleanOption(options.includeDeleted)) {
    where.deletedAt = null;
  }
  if (options.spaceId) where.spaceId = options.spaceId;
  if (options.folderId) where.folderId = options.folderId;
  if (['markdown', 'pdf'].includes(options.contentKind)) where.contentKind = options.contentKind;
  if (booleanOption(options.favoriteOnly)) where.favorite = true;
  const tagIds = Array.isArray(options.tagIds)
    ? options.tagIds.filter(Boolean)
    : typeof options.tagIds === 'string'
      ? options.tagIds.split(',').filter(Boolean)
      : [];
  if (tagIds.length > 0) {
    if ((options.match ?? options.tagMatch) === 'any') {
      where.noteTags = { some: { tagId: { in: tagIds } } };
    } else {
      where.AND = tagIds.map(tagId => ({ noteTags: { some: { tagId } } }));
    }
  } else if (options.tagId) {
    where.noteTags = { some: { tagId: options.tagId } };
  }
  return where;
}

export function buildNoteOrderBy(options = {}) {
  const sortBy = ['createdAt', 'updatedAt', 'title', 'favorite'].includes(options.sortBy)
    ? options.sortBy
    : 'updatedAt';
  const order = options.order === 'asc' ? 'asc' : 'desc';
  return [{ favorite: 'desc' }, { [sortBy]: order }];
}

export async function replaceNoteTags(tx, noteId, tagIds = []) {
  await tx.noteTag.deleteMany({ where: { noteId } });
  if (tagIds.length > 0) {
    await tx.noteTag.createMany({
      data: [...new Set(tagIds)].map(tagId => ({ noteId, tagId }))
    });
  }
}

export async function withRepositoryErrors(operation, options) {
  return withPostgresErrors(operation, options);
}

import type { TagRepositoryOptions, TagWriteInput, NavigationListOptions } from './navigation-repository-types.ts';
import { mapTag, toDate } from './mappers.ts';
import { withRepositoryErrors } from './repository-utils.ts';

export function createPostgresTagRepository({ db }: TagRepositoryOptions) {
  if (!db?.tag) throw new TypeError('PostgreSQL tag repository requires db.tag');

  return {
    async save(tag: TagWriteInput) {
      const data = {
        id: tag.id,
        spaceId: tag.spaceId,
        name: tag.name,
        color: tag.color ?? 'slate',
        groupId: tag.groupId ?? null,
        code: tag.code ?? null,
        isSystem: Boolean(tag.isSystem),
        sortOrder: Number(tag.sortOrder ?? 0),
        createdAt: toDate(tag.createdAt),
        updatedAt: toDate(tag.updatedAt)
      };
      return withRepositoryErrors(async () =>
        mapTag(
          await db.tag.upsert({
            where: { id: data.id },
            create: data,
            update: {
              spaceId: data.spaceId,
              name: data.name,
              color: data.color,
              groupId: data.groupId,
              code: data.code,
              isSystem: data.isSystem,
              sortOrder: data.sortOrder,
              updatedAt: data.updatedAt
            }
          })
        )
      );
    },
    async findById(tagId: unknown) {
      return withRepositoryErrors(async () =>
        mapTag(
          await db.tag.findUnique({
            where: { id: tagId }
          })
        )
      );
    },
    async findByIds(tagIds: unknown) {
      if (!Array.isArray(tagIds) || tagIds.length === 0) return [];
      return withRepositoryErrors(async () =>
        (
          await db.tag.findMany({
            where: { id: { in: [...new Set<unknown>(tagIds)] } }
          })
        ).map(mapTag)
      );
    },
    async delete(tagId: unknown) {
      return withRepositoryErrors(async () =>
        mapTag(
          await db.tag.delete({
            where: { id: tagId }
          })
        )
      );
    },
    async list(options: NavigationListOptions = {}) {
      const where = options.spaceId ? { spaceId: options.spaceId } : {};
      return withRepositoryErrors(async () =>
        (
          await db.tag.findMany({
            where,
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
          })
        ).map(mapTag)
      );
    },
    supportsAsync: true
  };
}

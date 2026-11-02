import type {
  TagGroupRepositoryOptions,
  TagGroupWriteInput,
  NavigationListOptions
} from './navigation-repository-types.ts';
import { mapTagGroup, toDate } from './mappers.ts';
import { withRepositoryErrors } from './repository-utils.js';

export function createPostgresTagGroupRepository({ db }: TagGroupRepositoryOptions) {
  if (!db?.tagGroup) throw new TypeError('PostgreSQL tag group repository requires db.tagGroup');
  const toData = (group: TagGroupWriteInput) => ({
    id: group.id,
    spaceId: group.spaceId,
    code: group.code ?? null,
    name: group.name,
    selectionMode: group.selectionMode,
    isSystem: Boolean(group.isSystem),
    sortOrder: Number(group.sortOrder ?? 0),
    createdAt: toDate(group.createdAt),
    updatedAt: toDate(group.updatedAt)
  });
  return {
    async create(group: TagGroupWriteInput) {
      const data = toData(group);
      return withRepositoryErrors(async () => mapTagGroup(await db.tagGroup.create({ data })), {
        uniqueCode: 'TAG_GROUP_ID_CONFLICT',
        uniqueMessage: 'A tag group with the same id already exists'
      });
    },
    async save(group: TagGroupWriteInput) {
      const data = toData(group);
      return withRepositoryErrors(async () =>
        mapTagGroup(
          await db.tagGroup.upsert({
            where: { id: data.id },
            create: data,
            update: {
              name: data.name,
              selectionMode: data.selectionMode,
              sortOrder: data.sortOrder,
              updatedAt: data.updatedAt
            }
          })
        )
      );
    },
    async findById(id: unknown) {
      return withRepositoryErrors(async () => mapTagGroup(await db.tagGroup.findUnique({ where: { id } })));
    },
    async delete(id: unknown) {
      return withRepositoryErrors(async () => mapTagGroup(await db.tagGroup.delete({ where: { id } })));
    },
    async moveToSpace(id: unknown, spaceId: unknown) {
      return withRepositoryErrors(async () =>
        mapTagGroup(await db.tagGroup.update({ where: { id }, data: { spaceId } }))
      );
    },
    async list(options: NavigationListOptions = {}) {
      return withRepositoryErrors(async () =>
        (
          await db.tagGroup.findMany({
            where: options.spaceId ? { spaceId: options.spaceId } : {},
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
          })
        ).map(mapTagGroup)
      );
    },
    supportsAsync: true
  };
}

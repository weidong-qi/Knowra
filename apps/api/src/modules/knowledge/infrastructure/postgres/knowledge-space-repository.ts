import type { SpaceRepositoryOptions, SpaceWriteInput, SpaceListOptions } from './navigation-repository-types.ts';
import { mapSpace, toDate } from './mappers.ts';
import { withRepositoryErrors } from './repository-utils.js';

export function createPostgresKnowledgeSpaceRepository({ db }: SpaceRepositoryOptions) {
  if (!db?.knowledgeSpace) {
    throw new TypeError('PostgreSQL space repository requires db.knowledgeSpace');
  }

  return {
    async save(space: SpaceWriteInput) {
      const data = {
        id: space.id,
        userId: space.userId,
        name: space.name,
        description: space.description ?? '',
        defaultFlag: space.defaultFlag ?? true,
        createdAt: toDate(space.createdAt),
        updatedAt: toDate(space.updatedAt)
      };
      return withRepositoryErrors(async () =>
        mapSpace(
          await db.knowledgeSpace.upsert({
            where: { id: data.id },
            create: data,
            update: {
              userId: data.userId,
              name: data.name,
              description: data.description,
              defaultFlag: data.defaultFlag,
              updatedAt: data.updatedAt
            }
          })
        )
      );
    },
    async findById(spaceId: unknown) {
      return withRepositoryErrors(async () =>
        mapSpace(
          await db.knowledgeSpace.findUnique({
            where: { id: spaceId }
          })
        )
      );
    },
    async delete(spaceId: unknown) {
      return withRepositoryErrors(async () => mapSpace(await db.knowledgeSpace.delete({ where: { id: spaceId } })));
    },
    async list(options: SpaceListOptions = {}) {
      const where = options.userId ? { userId: options.userId } : {};
      return withRepositoryErrors(async () =>
        (
          await db.knowledgeSpace.findMany({
            where,
            orderBy: { updatedAt: 'desc' }
          })
        ).map(mapSpace)
      );
    },
    supportsAsync: true
  };
}

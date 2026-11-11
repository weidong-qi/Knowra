import type { SpaceRepositoryOptions, SpaceWriteInput, SpaceListOptions } from './navigation-repository-types.ts';
import { mapSpace, toDate } from './mappers.ts';
import { withRepositoryErrors } from './repository-utils.ts';

export function createPostgresKnowledgeSpaceRepository({ db }: SpaceRepositoryOptions) {
  if (!db?.knowledgeSpace) {
    throw new TypeError('PostgreSQL space repository requires db.knowledgeSpace');
  }

  // 原始字段仍由 Prisma 校验；以下断言只描述 SQL 输入，不增加转换或提前拒绝。
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
            where: { id: spaceId as string }
          })
        )
      );
    },
    async delete(spaceId: unknown) {
      return withRepositoryErrors(async () =>
        mapSpace(await db.knowledgeSpace.delete({ where: { id: spaceId as string } }))
      );
    },
    async list(options: SpaceListOptions = {}) {
      const where = options.userId ? { userId: options.userId as string } : {};
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

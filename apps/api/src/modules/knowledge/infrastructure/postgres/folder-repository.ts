import type { FolderRepositoryOptions, FolderWriteInput, FolderListOptions } from './navigation-repository-types.ts';
import { mapFolder, toDate } from './mappers.ts';
import { Prisma } from '@prisma/client';
import { withRepositoryErrors } from './repository-utils.js';

export function createPostgresFolderRepository({ db }: FolderRepositoryOptions) {
  if (!db?.folder) throw new TypeError('PostgreSQL folder repository requires db.folder');

  return {
    async save(folder: FolderWriteInput) {
      const data = {
        id: folder.id,
        spaceId: folder.spaceId,
        parentId: folder.parentId ?? null,
        name: folder.name,
        sortOrder: Number(folder.sortOrder ?? 0),
        pathCache: folder.pathCache ?? '/',
        createdAt: toDate(folder.createdAt),
        updatedAt: toDate(folder.updatedAt),
        deletedAt: folder.deletedAt ? toDate(folder.deletedAt) : null,
        deletionPackage: folder.deletionPackage ?? Prisma.DbNull
      };
      return withRepositoryErrors(async () =>
        mapFolder(
          await db.folder.upsert({
            where: { id: data.id },
            create: data,
            update: {
              spaceId: data.spaceId,
              parentId: data.parentId,
              name: data.name,
              sortOrder: data.sortOrder,
              pathCache: data.pathCache,
              updatedAt: data.updatedAt,
              deletedAt: data.deletedAt,
              deletionPackage: data.deletionPackage
            }
          })
        )
      );
    },
    async findById(folderId: unknown) {
      return withRepositoryErrors(async () =>
        mapFolder(
          await db.folder.findUnique({
            where: { id: folderId }
          })
        )
      );
    },
    async delete(folderId: unknown) {
      return withRepositoryErrors(async () =>
        mapFolder(
          await db.folder.delete({
            where: { id: folderId }
          })
        )
      );
    },
    async list(options: FolderListOptions = {}) {
      const where = {
        ...(options.spaceId ? { spaceId: options.spaceId } : {}),
        ...(options.includeDeleted === true || options.includeDeleted === 'true' ? {} : { deletedAt: null })
      };
      return withRepositoryErrors(async () =>
        (
          await db.folder.findMany({
            where,
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
          })
        ).map(mapFolder)
      );
    },
    supportsAsync: true
  };
}

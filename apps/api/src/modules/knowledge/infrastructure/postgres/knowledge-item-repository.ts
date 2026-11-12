import { createAppError } from '../../../../errors/app-error.ts';
import { mapKnowledgeItem, toDate } from './mappers.ts';
import { withRepositoryErrors } from './repository-utils.ts';
import type {
  ItemRepositoryOptions,
  ItemWriteInput,
  ItemListOptions,
  ItemWriteData
} from './knowledge-graph-repository-types.ts';
import type { Prisma } from '@prisma/client';
import type { SyncMappedEntityMap } from '../../../sync/postgres-state-types.ts';

export function createPostgresKnowledgeItemRepository({ db }: ItemRepositoryOptions) {
  if (!db?.knowledgeItem) throw new TypeError('PostgreSQL KnowledgeItem repository requires db.knowledgeItem');
  function toData(item: ItemWriteInput) {
    return {
      id: item.id,
      title: item.title,
      canonicalStatement: item.canonicalStatement,
      userExplanation: item.userExplanation ?? '',
      knowledgeType: item.knowledgeType ?? 'concept',
      importance: item.importance === null || item.importance === undefined ? null : Number(item.importance),
      reviewStatus: item.reviewStatus ?? 'candidate',
      sourceMode: item.sourceMode ?? 'manual',
      createdAt: toDate(item.createdAt),
      updatedAt: toDate(item.updatedAt),
      deletedAt: item.deletedAt ? toDate(item.deletedAt) : null
    };
  }
  return {
    async lockById(id: unknown) {
      await withRepositoryErrors(() =>
        db.$queryRawUnsafe('SELECT id FROM "KnowledgeItem" WHERE id = $1 FOR UPDATE', id)
      );
    },
    async create(item: ItemWriteInput) {
      return withRepositoryErrors(() =>
        db.knowledgeItem
          .create({
            data: toData(item) as ItemWriteData
          })
          .then(mapKnowledgeItem)
      );
    },
    async save(item: ItemWriteInput, { expectedUpdatedAt }: { expectedUpdatedAt?: unknown } = {}) {
      const data = toData(item);
      if (expectedUpdatedAt) {
        return withRepositoryErrors(async () => {
          const { id, createdAt: _createdAt, ...update } = data;
          const result = await db.knowledgeItem.updateMany({
            where: { id, updatedAt: toDate(expectedUpdatedAt) },
            data: update as Partial<ItemWriteData>
          });
          if (result.count !== 1)
            throw createAppError('KNOWLEDGE_ITEM_UPDATE_CONFLICT', '知识已被其他操作修改，请重新加载并核对。', 409);
          return mapKnowledgeItem(await db.knowledgeItem.findUnique({ where: { id } }));
        });
      }
      return withRepositoryErrors(() =>
        db.knowledgeItem
          .upsert({
            where: { id: data.id },
            create: data as ItemWriteData,
            update: (() => {
              const { id: _ignoredId, createdAt: _ignoredCreatedAt, ...updateData } = data;
              return updateData;
            })() as Partial<ItemWriteData>
          })
          .then(mapKnowledgeItem)
      );
    },
    async findById(id: unknown) {
      return withRepositoryErrors(() =>
        db.knowledgeItem
          .findUnique({ where: { id: id as string } })
          .then<SyncMappedEntityMap['knowledgeItems'] | null>(mapKnowledgeItem)
      );
    },
    async delete(id: unknown) {
      return withRepositoryErrors(() =>
        db.knowledgeItem.delete({ where: { id: id as string } }).then(mapKnowledgeItem)
      );
    },
    list({ reviewStatus, query = '', includeArchived = false, includeDeleted = false }: ItemListOptions = {}) {
      const search = String(query).trim();
      const showArchived = includeArchived === true || includeArchived === 'true';
      const showDeleted = includeDeleted === true || includeDeleted === 'true';
      const where: Prisma.KnowledgeItemWhereInput = {
        ...(showDeleted ? {} : { deletedAt: null }),
        ...(search
          ? {
              OR: ['title', 'canonicalStatement', 'userExplanation'].map(field => ({
                [field]: { contains: search, mode: 'insensitive' }
              }))
            }
          : {})
      };
      if (reviewStatus) {
        where.reviewStatus = reviewStatus;
      } else if (!showArchived) {
        where.reviewStatus = { not: 'archived' };
      }
      return withRepositoryErrors(() =>
        db.knowledgeItem
          .findMany({
            where,
            orderBy: { updatedAt: 'desc' }
          })
          .then(rows => rows.map(mapKnowledgeItem))
      );
    },
    supportsAsync: true
  };
}

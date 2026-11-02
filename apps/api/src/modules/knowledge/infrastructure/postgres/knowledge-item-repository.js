import { createAppError } from '../../../../errors/app-error.js';
import { mapKnowledgeItem, toDate } from './mappers.js';
import { withRepositoryErrors } from './repository-utils.js';

export function createPostgresKnowledgeItemRepository({ db }) {
  if (!db?.knowledgeItem) throw new TypeError('PostgreSQL KnowledgeItem repository requires db.knowledgeItem');
  function toData(item) {
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
    async lockById(id) {
      await withRepositoryErrors(() =>
        db.$queryRawUnsafe('SELECT id FROM "KnowledgeItem" WHERE id = $1 FOR UPDATE', id)
      );
    },
    async create(item) {
      return withRepositoryErrors(() =>
        db.knowledgeItem
          .create({
            data: toData(item)
          })
          .then(mapKnowledgeItem)
      );
    },
    /** @param {import("../../domain/knowledge-item.ts").KnowledgeItem} item
     * @param {{ expectedUpdatedAt?: string }} options */
    async save(item, { expectedUpdatedAt } = {}) {
      const data = toData(item);
      if (expectedUpdatedAt) {
        return withRepositoryErrors(async () => {
          const { id, createdAt: _createdAt, ...update } = data;
          const result = await db.knowledgeItem.updateMany({
            where: { id, updatedAt: toDate(expectedUpdatedAt) },
            data: update
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
            create: data,
            update: (() => {
              const { id: _ignoredId, createdAt: _ignoredCreatedAt, ...updateData } = data;
              return updateData;
            })()
          })
          .then(mapKnowledgeItem)
      );
    },
    async findById(id) {
      return withRepositoryErrors(() => db.knowledgeItem.findUnique({ where: { id } }).then(mapKnowledgeItem));
    },
    async delete(id) {
      return withRepositoryErrors(() => db.knowledgeItem.delete({ where: { id } }).then(mapKnowledgeItem));
    },
    /** @param {{ reviewStatus?: string, query?: string, includeArchived?: boolean | string, includeDeleted?: boolean | string }} options */
    list({ reviewStatus, query = '', includeArchived = false, includeDeleted = false } = {}) {
      const search = String(query).trim();
      const showArchived = includeArchived === true || includeArchived === 'true';
      const showDeleted = includeDeleted === true || includeDeleted === 'true';
      /** @type {import("@prisma/client").Prisma.KnowledgeItemWhereInput} */
      const where = {
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

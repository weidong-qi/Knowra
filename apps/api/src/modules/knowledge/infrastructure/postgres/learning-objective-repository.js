import { createAppError } from '../../../../errors/app-error.js';
import { mapLearningObjective, toDate } from './mappers.js';
import { withRepositoryErrors } from './repository-utils.js';

export function createPostgresLearningObjectiveRepository({ db }) {
  if (!db?.learningObjective)
    throw new TypeError('PostgreSQL LearningObjective repository requires db.learningObjective');
  function toData(objective) {
    return {
      id: objective.id,
      knowledgeItemId: objective.knowledgeItemId,
      objective: objective.objective,
      actionVerb: objective.actionVerb,
      cognitiveLevel: objective.cognitiveLevel,
      difficultyHint: objective.difficultyHint ?? null,
      reviewStatus: objective.reviewStatus,
      reviewNote: objective.reviewNote ?? null,
      deletedAt: objective.deletedAt ? toDate(objective.deletedAt) : null,
      order: objective.order,
      createdAt: toDate(objective.createdAt),
      updatedAt: toDate(objective.updatedAt)
    };
  }
  return {
    async lockById(id) {
      await withRepositoryErrors(() =>
        db.$queryRawUnsafe('SELECT id FROM "LearningObjective" WHERE id = $1 FOR UPDATE', id)
      );
    },
    async create(objective) {
      return withRepositoryErrors(() =>
        db.learningObjective
          .create({
            data: toData(objective)
          })
          .then(mapLearningObjective)
      );
    },
    /** @param {import("../../domain/learning-objective.ts").LearningObjective} objective
     * @param {{ expectedUpdatedAt?: string }} options */
    async save(objective, { expectedUpdatedAt } = {}) {
      const data = toData(objective);
      if (expectedUpdatedAt) {
        return withRepositoryErrors(async () => {
          const { id, createdAt: _createdAt, ...update } = data;
          const result = await db.learningObjective.updateMany({
            where: { id, updatedAt: toDate(expectedUpdatedAt) },
            data: update
          });
          if (result.count !== 1)
            throw createAppError(
              'LEARNING_OBJECTIVE_UPDATE_CONFLICT',
              '学习目标已被其他操作修改，请重新加载并核对。',
              409
            );
          return mapLearningObjective(await db.learningObjective.findUnique({ where: { id } }));
        });
      }
      return withRepositoryErrors(() =>
        db.learningObjective
          .upsert({
            where: { id: data.id },
            create: data,
            update: (() => {
              const { id: _id, createdAt: _createdAt, ...rest } = data;
              return rest;
            })()
          })
          .then(mapLearningObjective)
      );
    },
    async findById(id) {
      return withRepositoryErrors(() => db.learningObjective.findUnique({ where: { id } }).then(mapLearningObjective));
    },
    /** @param {{ knowledgeItemId?: string, reviewStatus?: string, includeArchived?: boolean, includeDeleted?: boolean }} options */
    list({ knowledgeItemId, reviewStatus, includeArchived = false, includeDeleted = false } = {}) {
      /** @type {import("@prisma/client").Prisma.LearningObjectiveWhereInput} */
      const where = { ...(knowledgeItemId ? { knowledgeItemId } : {}) };
      if (!includeDeleted) where.deletedAt = null;
      if (reviewStatus) where.reviewStatus = reviewStatus;
      else if (!includeArchived) where.reviewStatus = { not: 'archived' };
      return withRepositoryErrors(() =>
        db.learningObjective
          .findMany({ where, orderBy: [{ order: 'asc' }, { updatedAt: 'desc' }] })
          .then(rows => rows.map(mapLearningObjective))
      );
    },
    async delete(id) {
      return withRepositoryErrors(() => db.learningObjective.delete({ where: { id } }).then(mapLearningObjective));
    },
    supportsAsync: true
  };
}

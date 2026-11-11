import type { SyncMappedEntityMap } from '../../../sync/postgres-state-types.ts';
import type {
  ObjectiveRepositoryOptions,
  ObjectiveWriteInput,
  ObjectiveWriteData,
  ObjectiveListOptions,
  ObjectiveWhere
} from './assessment-repository-types.ts';
import { createAppError } from '../../../../errors/app-error.ts';
import { mapLearningObjective, toDate } from './mappers.ts';
import { withRepositoryErrors } from './repository-utils.ts';

export function createPostgresLearningObjectiveRepository({ db }: ObjectiveRepositoryOptions) {
  if (!db?.learningObjective)
    throw new TypeError('PostgreSQL LearningObjective repository requires db.learningObjective');
  function toData(objective: ObjectiveWriteInput) {
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
    async lockById(id: string) {
      await withRepositoryErrors(() =>
        db.$queryRawUnsafe('SELECT id FROM "LearningObjective" WHERE id = $1 FOR UPDATE', id)
      );
    },
    async create(objective: ObjectiveWriteInput) {
      return withRepositoryErrors(() =>
        db.learningObjective
          .create({
            data: toData(objective) as ObjectiveWriteData
          })
          .then(mapLearningObjective)
      );
    },
    async save(objective: ObjectiveWriteInput, { expectedUpdatedAt }: { expectedUpdatedAt?: unknown } = {}) {
      const data = toData(objective);
      if (expectedUpdatedAt) {
        return withRepositoryErrors(async () => {
          const { id, createdAt: _createdAt, ...update } = data;
          const result = await db.learningObjective.updateMany({
            where: { id, updatedAt: toDate(expectedUpdatedAt) },
            data: update as Partial<ObjectiveWriteData>
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
            create: data as ObjectiveWriteData,
            update: (() => {
              const { id: _id, createdAt: _createdAt, ...rest } = data;
              return rest;
            })() as Partial<ObjectiveWriteData>
          })
          .then(mapLearningObjective)
      );
    },
    // requireObjectives 会在实体构造前传入 DTO 动态 map/filter/Set 的原始元素。
    async findById(id: unknown) {
      return withRepositoryErrors(() =>
        db.learningObjective
          .findUnique({ where: { id: id as string } })
          .then<SyncMappedEntityMap['learningObjectives'] | null>(mapLearningObjective)
      );
    },
    list({
      knowledgeItemId,
      reviewStatus,
      includeArchived = false,
      includeDeleted = false
    }: ObjectiveListOptions = {}) {
      const where: ObjectiveWhere = { ...(knowledgeItemId ? { knowledgeItemId } : {}) };
      if (!includeDeleted) where.deletedAt = null;
      if (reviewStatus) where.reviewStatus = reviewStatus;
      else if (!includeArchived) where.reviewStatus = { not: 'archived' };
      return withRepositoryErrors(() =>
        db.learningObjective
          .findMany({ where, orderBy: [{ order: 'asc' }, { updatedAt: 'desc' }] })
          .then(rows => rows.map(mapLearningObjective))
      );
    },
    async delete(id: string) {
      return withRepositoryErrors(() => db.learningObjective.delete({ where: { id } }).then(mapLearningObjective));
    },
    supportsAsync: true
  };
}

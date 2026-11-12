import type { Prisma } from '@prisma/client';
import type {
  ObjectiveRelationRepositoryOptions,
  RelationIds,
  MappedObjectiveProjection
} from './assessment-repository-types.ts';
import { mapQuestionObjective, toDate } from './mappers.ts';
import { withRepositoryErrors } from './repository-utils.ts';
import { questionObjectiveRecords } from '../question-objective-identity.ts';

export function createPostgresQuestionObjectiveRepository({ db }: ObjectiveRelationRepositoryOptions) {
  if (!db?.questionObjective)
    throw new TypeError('PostgreSQL QuestionObjective repository requires db.questionObjective');
  return {
    async deleteByQuestionId(questionId: string) {
      return withRepositoryErrors(() =>
        db.questionObjective.deleteMany({ where: { questionId } }).then(result => result.count)
      );
    },
    async listByQuestionIds(questionIds: RelationIds = []) {
      if (!questionIds.length) return [];
      return withRepositoryErrors(() =>
        db.questionObjective
          .findMany({ where: { questionId: { in: questionIds as string[] } }, orderBy: { order: 'asc' } })
          .then(rows => rows.map(mapQuestionObjective))
      );
    },
    async listByObjectiveId(learningObjectiveId: string) {
      return withRepositoryErrors(() =>
        db.questionObjective
          .findMany({ where: { learningObjectiveId }, orderBy: { order: 'asc' } })
          .then(rows => rows.map(mapQuestionObjective))
      );
    },
    async replaceForQuestion(questionId: string, objectiveIds: RelationIds = []) {
      return withRepositoryErrors(async () => {
        const previous = await db.questionObjective.findMany({ where: { questionId } });
        await db.questionObjective.deleteMany({ where: { questionId } });
        if (!objectiveIds.length) return [];
        const records = questionObjectiveRecords(questionId, objectiveIds, previous, new Date());
        await db.questionObjective.createMany({ data: records as Prisma.QuestionObjectiveCreateManyInput[] });
        return records.map(
          mapQuestionObjective as (row: (typeof records)[number]) => MappedObjectiveProjection<(typeof records)[number]>
        );
      });
    },
    supportsAsync: true
  };
}

import { mapQuestionObjective, toDate } from './mappers.ts';
import { withRepositoryErrors } from './repository-utils.js';
import { questionObjectiveRecords } from '../question-objective-identity.js';

export function createPostgresQuestionObjectiveRepository({ db }) {
  if (!db?.questionObjective)
    throw new TypeError('PostgreSQL QuestionObjective repository requires db.questionObjective');
  return {
    async deleteByQuestionId(questionId) {
      return withRepositoryErrors(() =>
        db.questionObjective.deleteMany({ where: { questionId } }).then(result => result.count)
      );
    },
    async listByQuestionIds(questionIds = []) {
      if (!questionIds.length) return [];
      return withRepositoryErrors(() =>
        db.questionObjective
          .findMany({ where: { questionId: { in: questionIds } }, orderBy: { order: 'asc' } })
          .then(rows => rows.map(mapQuestionObjective))
      );
    },
    async listByObjectiveId(learningObjectiveId) {
      return withRepositoryErrors(() =>
        db.questionObjective
          .findMany({ where: { learningObjectiveId }, orderBy: { order: 'asc' } })
          .then(rows => rows.map(mapQuestionObjective))
      );
    },
    async replaceForQuestion(questionId, objectiveIds = []) {
      return withRepositoryErrors(async () => {
        const previous = await db.questionObjective.findMany({ where: { questionId } });
        await db.questionObjective.deleteMany({ where: { questionId } });
        if (!objectiveIds.length) return [];
        const records = questionObjectiveRecords(questionId, objectiveIds, previous, new Date());
        await db.questionObjective.createMany({ data: records });
        return records.map(mapQuestionObjective);
      });
    },
    supportsAsync: true
  };
}

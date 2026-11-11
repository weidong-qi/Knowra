import { mapQuestion, toDate } from './mappers.ts';
import { withRepositoryErrors } from './repository-utils.ts';
import type {
  QuestionRepositoryOptions,
  QuestionWriteData,
  QuestionWriteInput,
  QuestionListOptions,
  ReviewWhere
} from './knowledge-graph-repository-types.ts';
import type { SyncMappedEntityMap } from '../../../sync/postgres-state-types.ts';

export function createPostgresQuestionRepository({ db }: QuestionRepositoryOptions) {
  if (!db?.question) throw new TypeError('PostgreSQL Question repository requires db.question');
  // 原始输入仍交给 Prisma 校验，只在 SQL 调用处描述其目标类型。
  function toData(question: QuestionWriteInput) {
    return {
      id: question.id,
      questionType: question.questionType,
      stem: question.stem,
      options: question.options,
      referenceAnswer: question.referenceAnswer,
      rubric: question.rubric,
      explanation: question.explanation ?? '',
      difficulty: question.difficulty ?? null,
      reviewStatus: question.reviewStatus,
      sourceMode: question.sourceMode,
      version: question.version,
      deletedAt: question.deletedAt ? toDate(question.deletedAt) : null,
      createdAt: toDate(question.createdAt),
      updatedAt: toDate(question.updatedAt)
    };
  }
  return {
    async create(question: QuestionWriteInput) {
      return withRepositoryErrors(() =>
        db.question
          .create({
            data: toData(question) as QuestionWriteData
          })
          .then(mapQuestion)
      );
    },
    async save(question: QuestionWriteInput) {
      const data = toData(question);
      return withRepositoryErrors(() =>
        db.question
          .upsert({
            where: { id: data.id },
            create: data as QuestionWriteData,
            update: (() => {
              const { id: _id, createdAt: _createdAt, ...rest } = data;
              return rest;
            })() as Partial<QuestionWriteData>
          })
          .then(mapQuestion)
      );
    },
    async findById(id: unknown) {
      return withRepositoryErrors(() =>
        db.question
          .findUnique({ where: { id: id as string } })
          .then<SyncMappedEntityMap['questions'] | null>(mapQuestion)
      );
    },
    list({ reviewStatus, includeArchived = false, includeDeleted = false, limit }: QuestionListOptions = {}) {
      const where: ReviewWhere = {
        ...(reviewStatus ? { reviewStatus } : includeArchived ? {} : { reviewStatus: { not: 'archived' } }),
        ...(includeDeleted ? {} : { deletedAt: null })
      };
      const take = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Number(limit) : undefined;
      return withRepositoryErrors(() =>
        db.question
          .findMany({ where, orderBy: { updatedAt: 'desc' }, ...(take ? { take } : {}) })
          .then(rows => rows.map(mapQuestion))
      );
    },
    async delete(id: unknown) {
      return withRepositoryErrors(() => db.question.delete({ where: { id: id as string } }).then(mapQuestion));
    },
    supportsAsync: true
  };
}

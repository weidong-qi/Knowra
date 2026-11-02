import { mapQuestionSource, toDate } from './mappers.ts';
import { withRepositoryErrors } from './repository-utils.js';

export function createPostgresQuestionSourceRepository({ db }) {
  if (!db?.questionSource) throw new TypeError('PostgreSQL QuestionSource repository requires db.questionSource');
  return {
    async deleteByQuestionId(questionId) {
      return withRepositoryErrors(() =>
        db.questionSource.deleteMany({ where: { questionId } }).then(result => result.count)
      );
    },
    async findById(id) {
      return withRepositoryErrors(() =>
        db.questionSource
          .findUnique({
            where: { id }
          })
          .then(mapQuestionSource)
      );
    },
    async listByQuestionIds(questionIds = []) {
      if (!questionIds.length) return [];
      return withRepositoryErrors(() =>
        db.questionSource
          .findMany({ where: { questionId: { in: questionIds } }, orderBy: { createdAt: 'asc' } })
          .then(rows => rows.map(mapQuestionSource))
      );
    },
    /** @param {{ questionId?: string }} options */
    async list({ questionId } = {}) {
      return withRepositoryErrors(() =>
        db.questionSource
          .findMany({ where: questionId ? { questionId } : {}, orderBy: { createdAt: 'asc' } })
          .then(rows => rows.map(mapQuestionSource))
      );
    },
    async replaceForQuestion(questionId, sources = []) {
      return withRepositoryErrors(async () => {
        await db.questionSource.deleteMany({ where: { questionId } });
        if (!sources.length) return [];
        const data = sources.map(source => ({
          id: source.id,
          questionId,
          sourceType: source.sourceType,
          sourceId: source.sourceId ?? null,
          quote: source.quote ?? '',
          locator: source.locator ?? null,
          contentHash: source.contentHash ?? null,
          status: source.status ?? 'active',
          createdAt: toDate(source.createdAt),
          updatedAt: toDate(source.updatedAt)
        }));
        await db.questionSource.createMany({ data });
        return data.map(mapQuestionSource);
      });
    },
    async markBySourceId(sourceType, sourceId, status = 'stale') {
      return this.markBySourceIds(sourceType, [sourceId], status);
    },
    async markBySourceIds(sourceType, sourceIds = [], status = 'stale') {
      if (!sourceIds.length) return [];
      return withRepositoryErrors(async () => {
        const rows = await db.questionSource.findMany({
          where: { sourceType, sourceId: { in: sourceIds }, status: { not: status } }
        });
        if (!rows.length) return [];
        await db.questionSource.updateMany({
          where: { id: { in: rows.map(row => row.id) } },
          data: { status, updatedAt: new Date() }
        });
        return rows.map(row => mapQuestionSource({ ...row, status }));
      });
    },
    supportsAsync: true
  };
}

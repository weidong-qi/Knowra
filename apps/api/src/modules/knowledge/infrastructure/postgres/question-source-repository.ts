import type { SyncMappedEntityMap } from '../../../sync/postgres-state-types.ts';
import type {
  SourceRepositoryOptions,
  RelationIds,
  SourceWriteInput,
  SourceWriteData,
  SourceProjection,
  MappedSourceProjection
} from './assessment-repository-types.ts';
import { mapQuestionSource, toDate } from './mappers.ts';
import { withRepositoryErrors } from './repository-utils.ts';

export function createPostgresQuestionSourceRepository({ db }: SourceRepositoryOptions) {
  if (!db?.questionSource) throw new TypeError('PostgreSQL QuestionSource repository requires db.questionSource');
  return {
    async deleteByQuestionId(questionId: string) {
      return withRepositoryErrors(() =>
        db.questionSource.deleteMany({ where: { questionId } }).then(result => result.count)
      );
    },
    // assertSourceIdsAvailable 在 QuestionSource 构造和字段校验前检查 DTO 原始 ID。
    async findById(id: unknown) {
      return withRepositoryErrors(() =>
        db.questionSource
          .findUnique({
            where: { id: id as string }
          })
          .then<SyncMappedEntityMap['questionSources'] | null>(mapQuestionSource)
      );
    },
    async listByQuestionIds(questionIds: RelationIds = []) {
      if (!questionIds.length) return [];
      return withRepositoryErrors(() =>
        db.questionSource
          .findMany({ where: { questionId: { in: questionIds as string[] } }, orderBy: { createdAt: 'asc' } })
          .then(rows => rows.map(mapQuestionSource))
      );
    },
    async list({ questionId }: { questionId?: string } = {}) {
      return withRepositoryErrors(() =>
        db.questionSource
          .findMany({ where: questionId ? { questionId } : {}, orderBy: { createdAt: 'asc' } })
          .then(rows => rows.map(mapQuestionSource))
      );
    },
    async replaceForQuestion(questionId: string, sources: readonly SourceWriteInput[] = []) {
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
        await db.questionSource.createMany({ data: data as SourceWriteData[] });
        return data.map(mapQuestionSource as (row: SourceProjection) => MappedSourceProjection);
      });
    },
    async markBySourceId(sourceType: string, sourceId: string, status = 'stale') {
      return this.markBySourceIds(sourceType, [sourceId], status);
    },
    async markBySourceIds(sourceType: string, sourceIds: RelationIds = [], status = 'stale') {
      if (!sourceIds.length) return [];
      return withRepositoryErrors(async () => {
        const rows = await db.questionSource.findMany({
          where: { sourceType, sourceId: { in: sourceIds as string[] }, status: { not: status } }
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

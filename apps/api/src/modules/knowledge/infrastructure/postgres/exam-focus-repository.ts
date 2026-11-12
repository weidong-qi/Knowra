import type { SyncMappedEntityMap } from '../../../sync/postgres-state-types.ts';
import type {
  FocusRepositoryOptions,
  FocusWriteData,
  FocusWriteInput,
  FocusListOptions,
  FocusWhere
} from './assessment-repository-types.ts';
import { mapExamFocus, toDate } from './mappers.ts';
import { withRepositoryErrors } from './repository-utils.ts';

export function createPostgresExamFocusRepository({ db }: FocusRepositoryOptions) {
  if (!db?.examFocus) throw new TypeError('PostgreSQL ExamFocus repository requires db.examFocus');
  // 原始输入仍交给 Prisma 校验，只在 SQL 调用处描述其目标类型。
  function toData(focus: FocusWriteInput) {
    return {
      id: focus.id,
      examProfileId: focus.examProfileId,
      learningObjectiveId: focus.learningObjectiveId,
      description: focus.description ?? '',
      priority: focus.priority,
      difficultyHint: focus.difficultyHint ?? null,
      questionTypeSuggestions: focus.questionTypeSuggestions ?? [],
      sourceType: focus.sourceType ?? 'manual',
      reviewStatus: focus.reviewStatus ?? 'candidate',
      deletedAt: focus.deletedAt ? toDate(focus.deletedAt) : null,
      createdAt: toDate(focus.createdAt),
      updatedAt: toDate(focus.updatedAt)
    };
  }
  function whereFor({
    examProfileId,
    learningObjectiveId,
    reviewStatus,
    includeArchived = false,
    includeDeleted = false
  }: FocusListOptions = {}) {
    const where: FocusWhere = {
      ...(examProfileId ? { examProfileId } : {}),
      ...(learningObjectiveId ? { learningObjectiveId } : {})
    };
    if (!includeDeleted) where.deletedAt = null;
    if (reviewStatus) where.reviewStatus = reviewStatus;
    else if (!includeArchived) where.reviewStatus = { not: 'archived' };
    return where;
  }
  return {
    async create(focus: FocusWriteInput) {
      return withRepositoryErrors(() =>
        db.examFocus
          .create({
            data: toData(focus) as FocusWriteData
          })
          .then(mapExamFocus)
      );
    },
    async save(focus: FocusWriteInput) {
      const data = toData(focus);
      return withRepositoryErrors(() =>
        db.examFocus
          .upsert({
            where: { id: data.id },
            create: data as FocusWriteData,
            update: (() => {
              const { id: _id, createdAt: _createdAt, ...rest } = data;
              return rest;
            })() as Partial<FocusWriteData>
          })
          .then(mapExamFocus)
      );
    },
    async findById(id: string) {
      return withRepositoryErrors(() =>
        db.examFocus.findUnique({ where: { id } }).then<SyncMappedEntityMap['examFocuses'] | null>(mapExamFocus)
      );
    },
    async findByProfileAndObjective(examProfileId: string, learningObjectiveId: string) {
      return withRepositoryErrors(() =>
        db.examFocus
          .findUnique({ where: { examProfileId_learningObjectiveId: { examProfileId, learningObjectiveId } } })
          .then<SyncMappedEntityMap['examFocuses'] | null>(mapExamFocus)
      );
    },
    list(options: FocusListOptions = {}) {
      return withRepositoryErrors(() =>
        db.examFocus
          .findMany({ where: whereFor(options), orderBy: [{ priority: 'asc' }, { updatedAt: 'desc' }] })
          .then(rows => rows.map(mapExamFocus))
      );
    },
    async delete(id: string) {
      return withRepositoryErrors(() => db.examFocus.delete({ where: { id } }).then(mapExamFocus));
    },
    supportsAsync: true
  };
}

import { mapExamFocus, toDate } from './mappers.js';
import { withRepositoryErrors } from './repository-utils.js';

export function createPostgresExamFocusRepository({ db }) {
  if (!db?.examFocus) throw new TypeError('PostgreSQL ExamFocus repository requires db.examFocus');
  function toData(focus) {
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
  /** @param {{ examProfileId?: string, learningObjectiveId?: string, reviewStatus?: string, includeArchived?: boolean, includeDeleted?: boolean }} options */
  function whereFor({
    examProfileId,
    learningObjectiveId,
    reviewStatus,
    includeArchived = false,
    includeDeleted = false
  } = {}) {
    /** @type {import("@prisma/client").Prisma.ExamFocusWhereInput} */
    const where = {
      ...(examProfileId ? { examProfileId } : {}),
      ...(learningObjectiveId ? { learningObjectiveId } : {})
    };
    if (!includeDeleted) where.deletedAt = null;
    if (reviewStatus) where.reviewStatus = reviewStatus;
    else if (!includeArchived) where.reviewStatus = { not: 'archived' };
    return where;
  }
  return {
    async create(focus) {
      return withRepositoryErrors(() =>
        db.examFocus
          .create({
            data: toData(focus)
          })
          .then(mapExamFocus)
      );
    },
    async save(focus) {
      const data = toData(focus);
      return withRepositoryErrors(() =>
        db.examFocus
          .upsert({
            where: { id: data.id },
            create: data,
            update: (() => {
              const { id: _id, createdAt: _createdAt, ...rest } = data;
              return rest;
            })()
          })
          .then(mapExamFocus)
      );
    },
    async findById(id) {
      return withRepositoryErrors(() => db.examFocus.findUnique({ where: { id } }).then(mapExamFocus));
    },
    async findByProfileAndObjective(examProfileId, learningObjectiveId) {
      return withRepositoryErrors(() =>
        db.examFocus
          .findUnique({ where: { examProfileId_learningObjectiveId: { examProfileId, learningObjectiveId } } })
          .then(mapExamFocus)
      );
    },
    list(options = {}) {
      return withRepositoryErrors(() =>
        db.examFocus
          .findMany({ where: whereFor(options), orderBy: [{ priority: 'asc' }, { updatedAt: 'desc' }] })
          .then(rows => rows.map(mapExamFocus))
      );
    },
    async delete(id) {
      return withRepositoryErrors(() => db.examFocus.delete({ where: { id } }).then(mapExamFocus));
    },
    supportsAsync: true
  };
}

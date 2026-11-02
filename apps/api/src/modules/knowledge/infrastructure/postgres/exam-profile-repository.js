import { mapExamProfile, toDate } from './mappers.ts';
import { withRepositoryErrors } from './repository-utils.js';

export function createPostgresExamProfileRepository({ db }) {
  if (!db?.examProfile) throw new TypeError('PostgreSQL ExamProfile repository requires db.examProfile');
  function toData(profile) {
    return {
      id: profile.id,
      name: profile.name,
      description: profile.description ?? '',
      scope: profile.scope ?? [],
      language: profile.language ?? 'zh-CN',
      commonQuestionTypes: profile.commonQuestionTypes ?? [],
      difficultyProfile: profile.difficultyProfile ?? {},
      archivedAt: profile.archivedAt ? toDate(profile.archivedAt) : null,
      deletedAt: profile.deletedAt ? toDate(profile.deletedAt) : null,
      createdAt: toDate(profile.createdAt),
      updatedAt: toDate(profile.updatedAt)
    };
  }
  return {
    async create(profile) {
      return withRepositoryErrors(() =>
        db.examProfile
          .create({
            data: toData(profile)
          })
          .then(mapExamProfile)
      );
    },
    async save(profile) {
      const data = toData(profile);
      return withRepositoryErrors(() =>
        db.examProfile
          .upsert({
            where: { id: data.id },
            create: data,
            update: (() => {
              const { id: _id, createdAt: _createdAt, ...rest } = data;
              return rest;
            })()
          })
          .then(mapExamProfile)
      );
    },
    async findById(id) {
      return withRepositoryErrors(() => db.examProfile.findUnique({ where: { id } }).then(mapExamProfile));
    },
    list({ includeArchived = false, includeDeleted = false } = {}) {
      const where = {
        ...(includeArchived ? {} : { archivedAt: null }),
        ...(includeDeleted ? {} : { deletedAt: null })
      };
      return withRepositoryErrors(() =>
        db.examProfile.findMany({ where, orderBy: { updatedAt: 'desc' } }).then(rows => rows.map(mapExamProfile))
      );
    },
    async delete(id) {
      return withRepositoryErrors(() => db.examProfile.delete({ where: { id } }).then(mapExamProfile));
    },
    supportsAsync: true
  };
}

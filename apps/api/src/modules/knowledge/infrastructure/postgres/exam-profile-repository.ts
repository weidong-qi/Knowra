import type { SyncMappedEntityMap } from '../../../sync/postgres-state-types.ts';
import type {
  ProfileRepositoryOptions,
  ProfileWriteData,
  ProfileWriteInput,
  ReviewListOptions
} from './assessment-repository-types.ts';
import { mapExamProfile, toDate } from './mappers.ts';
import { withRepositoryErrors } from './repository-utils.ts';

export function createPostgresExamProfileRepository({ db }: ProfileRepositoryOptions) {
  if (!db?.examProfile) throw new TypeError('PostgreSQL ExamProfile repository requires db.examProfile');
  // 原始输入仍交给 Prisma 校验，只在 SQL 调用处描述其目标类型。
  function toData(profile: ProfileWriteInput) {
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
    async create(profile: ProfileWriteInput) {
      return withRepositoryErrors(() =>
        db.examProfile
          .create({
            data: toData(profile) as ProfileWriteData
          })
          .then(mapExamProfile)
      );
    },
    async save(profile: ProfileWriteInput) {
      const data = toData(profile);
      return withRepositoryErrors(() =>
        db.examProfile
          .upsert({
            where: { id: data.id },
            create: data as ProfileWriteData,
            update: (() => {
              const { id: _id, createdAt: _createdAt, ...rest } = data;
              return rest;
            })() as Partial<ProfileWriteData>
          })
          .then(mapExamProfile)
      );
    },
    async findById(id: string) {
      return withRepositoryErrors(() =>
        db.examProfile.findUnique({ where: { id } }).then<SyncMappedEntityMap['examProfiles'] | null>(mapExamProfile)
      );
    },
    list({ includeArchived = false, includeDeleted = false }: ReviewListOptions = {}) {
      const where = {
        ...(includeArchived ? {} : { archivedAt: null }),
        ...(includeDeleted ? {} : { deletedAt: null })
      };
      return withRepositoryErrors(() =>
        db.examProfile.findMany({ where, orderBy: { updatedAt: 'desc' } }).then(rows => rows.map(mapExamProfile))
      );
    },
    async delete(id: string) {
      return withRepositoryErrors(() => db.examProfile.delete({ where: { id } }).then(mapExamProfile));
    },
    supportsAsync: true
  };
}

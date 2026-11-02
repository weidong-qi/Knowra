import { toDate, toIso } from './mappers.ts';
import { createAppError } from '../../../../errors/app-error.js';
import { withRepositoryErrors } from './repository-utils.js';

export function createPostgresAnnotationExclusionRepository({ db }) {
  return {
    save(record) {
      const data = { ...record, createdAt: toDate(record.createdAt), updatedAt: toDate(record.updatedAt) };
      return withRepositoryErrors(async () =>
        mapDates(
          await db.annotationExclusion.upsert({
            where: { id: record.id },
            create: data,
            update: omitCreateFields(data)
          })
        )
      );
    },
    async findById(id) {
      return mapDates(await db.annotationExclusion.findUnique({ where: { id } }));
    },
    /** @param {{ parentAnnotationId?: string, includeDeleted?: boolean }} options */
    async list({ parentAnnotationId, includeDeleted = false } = {}) {
      return (
        await db.annotationExclusion.findMany({
          where: {
            ...(parentAnnotationId ? { parentAnnotationId } : {}),
            ...(includeDeleted ? {} : { status: { not: 'archived' } })
          },
          orderBy: { createdAt: 'asc' }
        })
      ).map(mapDates);
    },
    async delete(id) {
      return mapDates(await db.annotationExclusion.delete({ where: { id } }));
    },
    supportsAsync: true
  };
}

export function createPostgresAnnotationRevisionRepository({ db }) {
  return {
    save(record) {
      return withRepositoryErrors(async () =>
        mapCreated(await db.annotationRevision.create({ data: { ...record, createdAt: toDate(record.createdAt) } }))
      );
    },
    async findById(id) {
      return mapCreated(await db.annotationRevision.findUnique({ where: { id } }));
    },
    async findByAnnotationRevision(annotationId, revision) {
      return mapCreated(
        await db.annotationRevision.findUnique({ where: { annotationId_revision: { annotationId, revision } } })
      );
    },
    /** @param {{ annotationId?: string }} options */
    async list({ annotationId } = {}) {
      return (
        await db.annotationRevision.findMany({
          where: annotationId ? { annotationId } : {},
          orderBy: { revision: 'asc' }
        })
      ).map(mapCreated);
    },
    supportsAsync: true
  };
}

export function createPostgresAnalysisScopeRepository({ db }) {
  return {
    save(record) {
      return withRepositoryErrors(async () =>
        mapScope(
          await db.analysisScopeSnapshot.create({
            data: {
              ...record,
              createdAt: toDate(record.createdAt),
              updatedAt: toDate(record.updatedAt ?? record.createdAt),
              deletedAt: record.deletedAt ? toDate(record.deletedAt) : null
            }
          })
        )
      );
    },
    async update(record, expectedUpdatedAt) {
      return withRepositoryErrors(async () => {
        const result = await db.analysisScopeSnapshot.updateMany({
          where: { id: record.id, updatedAt: toDate(expectedUpdatedAt) },
          data: { deletedAt: record.deletedAt ? toDate(record.deletedAt) : null, updatedAt: toDate(record.updatedAt) }
        });
        if (result.count !== 1)
          throw createAppError('ANALYSIS_SCOPE_UPDATE_CONFLICT', '分析范围已变化，请刷新后重试。', 409);
        return mapScope(await db.analysisScopeSnapshot.findUnique({ where: { id: record.id } }));
      });
    },
    async findById(id) {
      return mapScope(await db.analysisScopeSnapshot.findUnique({ where: { id } }));
    },
    async moveToSpace(id, spaceId) {
      return mapScope(await db.analysisScopeSnapshot.update({ where: { id }, data: { spaceId } }));
    },
    async findByIdempotencyKey(spaceId, idempotencyKey) {
      return mapScope(
        await db.analysisScopeSnapshot.findUnique({ where: { spaceId_idempotencyKey: { spaceId, idempotencyKey } } })
      );
    },
    /** @param {{ spaceId?: string, includeDeleted?: boolean | string }} options */
    async list({ spaceId, includeDeleted = false } = {}) {
      return (
        await db.analysisScopeSnapshot.findMany({
          where: {
            ...(spaceId ? { spaceId } : {}),
            ...(includeDeleted === true || includeDeleted === 'true' ? {} : { deletedAt: null })
          },
          orderBy: { createdAt: 'desc' }
        })
      ).map(mapScope);
    },
    supportsAsync: true
  };
}

function omitCreateFields(data) {
  const { id: _id, createdAt: _createdAt, ...update } = data;
  return update;
}
function mapDates(record) {
  return record ? { ...record, createdAt: toIso(record.createdAt), updatedAt: toIso(record.updatedAt) } : null;
}
function mapCreated(record) {
  return record ? { ...record, createdAt: toIso(record.createdAt) } : null;
}
function mapScope(record) {
  return record
    ? {
        ...record,
        createdAt: toIso(record.createdAt),
        updatedAt: toIso(record.updatedAt),
        deletedAt: record.deletedAt ? toIso(record.deletedAt) : null
      }
    : null;
}

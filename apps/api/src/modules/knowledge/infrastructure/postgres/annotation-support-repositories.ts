import type * as Models from '@prisma/client';
import { toDate, toIso } from './mappers.ts';
import { createAppError } from '../../../../errors/app-error.js';
import { withRepositoryErrors } from './repository-utils.ts';

interface CreatedWriteInput {
  id: string;
  createdAt?: string | Date | null;
}
interface DatesWriteInput extends CreatedWriteInput {
  updatedAt?: string | Date | null;
}
interface ScopeWriteInput extends DatesWriteInput {
  deletedAt?: string | Date | null;
}
type CreatedWriteData<Input> = Omit<Input, 'createdAt'> & { createdAt: Date };
type DatesWriteData<Input> = Omit<Input, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
type ScopeWriteData<Input> = Omit<Input, 'createdAt' | 'updatedAt' | 'deletedAt'> & {
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};
export interface AnnotationExclusionRepositoryOptions {
  db: {
    annotationExclusion: {
      upsert<Input extends DatesWriteInput>(input: {
        where: { id: string };
        create: DatesWriteData<Input>;
        update: Omit<DatesWriteData<Input>, 'id' | 'createdAt'>;
      }): PromiseLike<Models.AnnotationExclusion>;
      findUnique(input: { where: { id: string } }): PromiseLike<Models.AnnotationExclusion | null>;
      findMany(input: {
        where: { parentAnnotationId?: string; status?: { not: string } };
        orderBy: { createdAt: 'asc' };
      }): PromiseLike<Models.AnnotationExclusion[]>;
      delete(input: { where: { id: string } }): PromiseLike<Models.AnnotationExclusion>;
    };
  };
}
export interface AnnotationRevisionRepositoryOptions {
  db: {
    annotationRevision: {
      create<Input extends CreatedWriteInput>(input: {
        data: CreatedWriteData<Input>;
      }): PromiseLike<Models.AnnotationRevision>;
      findUnique(input: {
        where: { id: string } | { annotationId_revision: { annotationId: string; revision: number } };
      }): PromiseLike<Models.AnnotationRevision | null>;
      findMany(input: {
        where: { annotationId?: string };
        orderBy: { revision: 'asc' };
      }): PromiseLike<Models.AnnotationRevision[]>;
    };
  };
}
export interface AnalysisScopeRepositoryOptions {
  db: {
    analysisScopeSnapshot: {
      create<Input extends ScopeWriteInput>(input: {
        data: ScopeWriteData<Input>;
      }): PromiseLike<Models.AnalysisScopeSnapshot>;
      updateMany(input: {
        where: { id: string; updatedAt: Date };
        data: { deletedAt: Date | null; updatedAt: Date };
      }): PromiseLike<{ count: number }>;
      findUnique(input: {
        where: { id: string } | { spaceId_idempotencyKey: { spaceId: string; idempotencyKey: string } };
      }): PromiseLike<Models.AnalysisScopeSnapshot | null>;
      update(input: { where: { id: string }; data: { spaceId: string } }): PromiseLike<Models.AnalysisScopeSnapshot>;
      findMany(input: {
        where: { spaceId?: string; deletedAt?: null };
        orderBy: { createdAt: 'desc' };
      }): PromiseLike<Models.AnalysisScopeSnapshot[]>;
    };
  };
}

export function createPostgresAnnotationExclusionRepository({ db }: AnnotationExclusionRepositoryOptions) {
  return {
    save<Record extends DatesWriteInput>(record: Record) {
      const data = { ...record, createdAt: toDate(record.createdAt), updatedAt: toDate(record.updatedAt) };
      return withRepositoryErrors(async () =>
        mapDates(
          await db.annotationExclusion.upsert<Record>({
            where: { id: record.id },
            create: data,
            update: omitCreateFields(data)
          })
        )
      );
    },
    async findById(id: string) {
      return mapDates(await db.annotationExclusion.findUnique({ where: { id } }));
    },
    async list({
      parentAnnotationId,
      includeDeleted = false
    }: { parentAnnotationId?: string; includeDeleted?: boolean } = {}) {
      return (
        await db.annotationExclusion.findMany({
          where: {
            ...(parentAnnotationId ? { parentAnnotationId } : {}),
            ...(includeDeleted ? {} : { status: { not: 'archived' } })
          },
          orderBy: { createdAt: 'asc' }
        })
      ).map(mapDates<Models.AnnotationExclusion>);
    },
    async delete(id: string) {
      return mapDates(await db.annotationExclusion.delete({ where: { id } }));
    },
    supportsAsync: true
  };
}

export function createPostgresAnnotationRevisionRepository({ db }: AnnotationRevisionRepositoryOptions) {
  return {
    save<Record extends CreatedWriteInput>(record: Record) {
      return withRepositoryErrors(async () =>
        mapCreated(
          await db.annotationRevision.create<Record>({ data: { ...record, createdAt: toDate(record.createdAt) } })
        )
      );
    },
    async findById(id: string) {
      return mapCreated(await db.annotationRevision.findUnique({ where: { id } }));
    },
    async findByAnnotationRevision(annotationId: string, revision: number) {
      return mapCreated(
        await db.annotationRevision.findUnique({ where: { annotationId_revision: { annotationId, revision } } })
      );
    },
    async list({ annotationId }: { annotationId?: string } = {}) {
      return (
        await db.annotationRevision.findMany({
          where: annotationId ? { annotationId } : {},
          orderBy: { revision: 'asc' }
        })
      ).map(mapCreated<Models.AnnotationRevision>);
    },
    supportsAsync: true
  };
}

export function createPostgresAnalysisScopeRepository({ db }: AnalysisScopeRepositoryOptions) {
  return {
    save<Record extends ScopeWriteInput>(record: Record) {
      return withRepositoryErrors(async () =>
        mapScope(
          await db.analysisScopeSnapshot.create<Record>({
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
    async update(
      record: Pick<ScopeWriteInput, 'id' | 'updatedAt' | 'deletedAt'>,
      expectedUpdatedAt: string | Date | null
    ) {
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
    async findById(id: string) {
      return mapScope(await db.analysisScopeSnapshot.findUnique({ where: { id } }));
    },
    async moveToSpace(id: string, spaceId: string) {
      return mapScope(await db.analysisScopeSnapshot.update({ where: { id }, data: { spaceId } }));
    },
    async findByIdempotencyKey(spaceId: string, idempotencyKey: string) {
      return mapScope(
        await db.analysisScopeSnapshot.findUnique({ where: { spaceId_idempotencyKey: { spaceId, idempotencyKey } } })
      );
    },
    async list({ spaceId, includeDeleted = false }: { spaceId?: string; includeDeleted?: boolean | string } = {}) {
      return (
        await db.analysisScopeSnapshot.findMany({
          where: {
            ...(spaceId ? { spaceId } : {}),
            ...(includeDeleted === true || includeDeleted === 'true' ? {} : { deletedAt: null })
          },
          orderBy: { createdAt: 'desc' }
        })
      ).map(mapScope<Models.AnalysisScopeSnapshot>);
    },
    supportsAsync: true
  };
}

function omitCreateFields<Data extends { id: string; createdAt: Date }>(data: Data) {
  const { id: _id, createdAt: _createdAt, ...update } = data;
  return update;
}
type CreatedRow = { createdAt: Date };
type DatesRow = CreatedRow & { updatedAt: Date };
type ScopeRow = DatesRow & { deletedAt: Date | null };
type MappedCreated<Row> = Omit<Row, 'createdAt'> & { createdAt: string };
type MappedDates<Row> = Omit<Row, 'createdAt' | 'updatedAt'> & { createdAt: string; updatedAt: string };
type MappedScope<Row> = Omit<Row, 'createdAt' | 'updatedAt' | 'deletedAt'> & {
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
function mapDates<Row extends DatesRow | null | undefined>(record: Row): Row extends DatesRow ? MappedDates<Row> : null;
function mapDates<Row extends DatesRow>(record: Row): MappedDates<Row>;
function mapDates<Row extends DatesRow>(record: Row | null | undefined): MappedDates<Row> | null {
  return record ? { ...record, createdAt: toIso(record.createdAt), updatedAt: toIso(record.updatedAt) } : null;
}
function mapCreated<Row extends CreatedRow | null | undefined>(
  record: Row
): Row extends CreatedRow ? MappedCreated<Row> : null;
function mapCreated<Row extends CreatedRow>(record: Row): MappedCreated<Row>;
function mapCreated<Row extends CreatedRow>(record: Row | null | undefined): MappedCreated<Row> | null {
  return record ? { ...record, createdAt: toIso(record.createdAt) } : null;
}
function mapScope<Row extends ScopeRow | null | undefined>(record: Row): Row extends ScopeRow ? MappedScope<Row> : null;
function mapScope<Row extends ScopeRow>(record: Row): MappedScope<Row>;
function mapScope<Row extends ScopeRow>(record: Row | null | undefined): MappedScope<Row> | null {
  return record
    ? {
        ...record,
        createdAt: toIso(record.createdAt),
        updatedAt: toIso(record.updatedAt),
        deletedAt: record.deletedAt ? toIso(record.deletedAt) : null
      }
    : null;
}

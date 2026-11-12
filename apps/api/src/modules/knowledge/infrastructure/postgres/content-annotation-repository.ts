import { Prisma } from '@prisma/client';
import type * as Models from '@prisma/client';
import type { ContentAnnotation } from '../../domain/content-annotation.ts';
import type { CreateContentAnnotationDto } from '../../application/dto/content-annotation-dto.ts';
import { mapAnnotation, toDate } from './mappers.ts';
import { withRepositoryErrors } from './repository-utils.ts';

type AnnotationIdentity =
  Pick<ContentAnnotation, 'identityBinding'> | Pick<NonNullable<ReturnType<typeof mapAnnotation>>, 'identityBinding'>;
type AnnotationWriteData<Input extends AnnotationIdentity> = Omit<
  Input,
  'createdAt' | 'updatedAt' | 'deletedAt' | 'identityBinding'
> & {
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  identityBinding: NonNullable<Input['identityBinding']> | Prisma.NullTypes.DbNull;
};
interface AnnotationWhere {
  id?: { in: string[] };
  noteId?: string | { in: string[] };
  spaceId?: string;
  kind?: CreateContentAnnotationDto['kind'];
  scopeType?: CreateContentAnnotationDto['scopeType'];
  anchorStatus?: string;
  lifecycleStatus?: string;
  anchorFingerprint?: string;
  quoteText?: string;
  fromPosition?: number;
  toPosition?: number;
  noteContentHash?: { not: string };
  schemaVersion?: { not: number };
}
interface ContentAnnotationDelegate {
  upsert<Input extends AnnotationIdentity>(input: {
    where: { id: string };
    create: AnnotationWriteData<Input>;
    update: Omit<AnnotationWriteData<Input>, 'id' | 'createdAt'>;
  }): PromiseLike<Models.ContentAnnotation>;
  findUnique(input: {
    where: { id: string } | { noteId_idempotencyKey: { noteId: string; idempotencyKey: string } };
  }): PromiseLike<Models.ContentAnnotation | null>;
  findFirst(input: { where: AnnotationWhere }): PromiseLike<Models.ContentAnnotation | null>;
  findMany(input: { where: AnnotationWhere; orderBy?: { updatedAt: 'desc' } }): PromiseLike<Models.ContentAnnotation[]>;
  deleteMany(input: { where: { noteId: { in: string[] } } }): PromiseLike<{ count: number }>;
  updateMany(input: {
    where: { id: { in: string[] } };
    data: {
      status: string;
      anchorStatus: string;
      anchorReason: string;
      revision: { increment: number };
      updatedAt: Date;
    };
  }): PromiseLike<{ count: number }>;
}
export interface ContentAnnotationRepositoryOptions {
  db: { contentAnnotation: ContentAnnotationDelegate };
}
interface AnnotationListOptions {
  noteId?: string;
  spaceId?: string;
  includeDeleted?: boolean;
  kind?: string;
  scopeType?: string;
  anchorStatus?: string;
}
type AnnotationDuplicateInput = Pick<
  CreateContentAnnotationDto,
  'noteId' | 'kind' | 'scopeType' | 'anchorFingerprint' | 'quoteText' | 'fromPosition' | 'toPosition'
>;

export function createPostgresContentAnnotationRepository({ db }: ContentAnnotationRepositoryOptions) {
  if (!db?.contentAnnotation) {
    throw new TypeError('PostgreSQL annotation repository requires db.contentAnnotation');
  }

  return {
    // 空间迁移也会原样回写数据库映射记录，不能把其 JSON/字符串字段冒充领域构造结果。
    async save(
      annotation:
        | ContentAnnotation<unknown, unknown, unknown, unknown, unknown, unknown>
        | NonNullable<ReturnType<typeof mapAnnotation>>
    ) {
      const data = {
        id: annotation.id,
        spaceId: annotation.spaceId,
        noteId: annotation.noteId,
        noteVersionId: annotation.noteVersionId ?? null,
        kind: annotation.kind,
        sourceMode: annotation.sourceMode,
        quoteText: annotation.quoteText,
        headingPath: annotation.headingPath ?? [],
        fromPosition: annotation.fromPosition,
        toPosition: annotation.toPosition,
        prefixText: annotation.prefixText ?? '',
        suffixText: annotation.suffixText ?? '',
        anchorFingerprint: annotation.anchorFingerprint,
        noteContentHash: annotation.noteContentHash,
        idempotencyKey: annotation.idempotencyKey,
        status: annotation.status,
        schemaVersion: annotation.schemaVersion,
        scopeType: annotation.scopeType,
        importance: annotation.importance,
        comment: annotation.comment,
        lifecycleStatus: annotation.lifecycleStatus,
        anchorStatus: annotation.anchorStatus,
        anchorReason: annotation.anchorReason,
        revision: annotation.revision,
        anchor: annotation.anchor,
        originSnapshot: annotation.originSnapshot,
        identityBinding: annotation.identityBinding ?? Prisma.DbNull,
        resolvedContentHash: annotation.resolvedContentHash,
        boundaryFingerprint: annotation.boundaryFingerprint,
        requestHash: annotation.requestHash,
        createdAt: toDate(annotation.createdAt),
        updatedAt: toDate(annotation.updatedAt),
        deletedAt: annotation.deletedAt ? toDate(annotation.deletedAt) : null
      };
      return withRepositoryErrors(async () =>
        mapAnnotation(
          await db.contentAnnotation.upsert<typeof annotation>({
            where: { id: data.id },
            create: data,
            update: (() => {
              const { id: _ignoredId, createdAt: _ignoredCreatedAt, ...updateData } = data;
              return updateData;
            })()
          })
        )
      );
    },
    async findById(id: string) {
      return withRepositoryErrors(async () => mapAnnotation(await db.contentAnnotation.findUnique({ where: { id } })));
    },
    async findByIdempotencyKey(noteId: string, idempotencyKey: string) {
      return withRepositoryErrors(async () =>
        mapAnnotation(
          await db.contentAnnotation.findUnique({
            where: { noteId_idempotencyKey: { noteId, idempotencyKey } }
          })
        )
      );
    },
    async findDuplicate({
      noteId,
      kind,
      scopeType,
      anchorFingerprint,
      quoteText,
      fromPosition,
      toPosition
    }: AnnotationDuplicateInput) {
      return withRepositoryErrors(async () =>
        mapAnnotation(
          await db.contentAnnotation.findFirst({
            where: {
              noteId,
              kind,
              lifecycleStatus: 'active',
              ...(anchorFingerprint ? { scopeType, anchorFingerprint } : { quoteText, fromPosition, toPosition })
            }
          })
        )
      );
    },
    async list({ noteId, spaceId, includeDeleted = false, kind, scopeType, anchorStatus }: AnnotationListOptions = {}) {
      const where = {
        ...(noteId ? { noteId } : {}),
        ...(spaceId ? { spaceId } : {}),
        ...(kind ? { kind } : {}),
        ...(scopeType ? { scopeType } : {}),
        ...(anchorStatus ? { anchorStatus } : {}),
        ...(includeDeleted ? {} : { lifecycleStatus: 'active' })
      };
      return withRepositoryErrors(async () =>
        (
          await db.contentAnnotation.findMany({
            where,
            orderBy: { updatedAt: 'desc' }
          })
        ).map(mapAnnotation)
      );
    },
    async deleteByNoteIds(noteIds: string[]) {
      if (!noteIds.length) return [];
      const existing = await withRepositoryErrors(() =>
        db.contentAnnotation.findMany({
          where: { noteId: { in: noteIds } }
        })
      );
      await withRepositoryErrors(() =>
        db.contentAnnotation.deleteMany({
          where: { noteId: { in: noteIds } }
        })
      );
      return existing.map(mapAnnotation);
    },
    async markStaleByNoteId(noteId: string, currentContentHash: string) {
      return withRepositoryErrors(async () => {
        const rows = await db.contentAnnotation.findMany({
          // v3（内联重点）的位置在正文标记里，不按正文哈希判定过期。
          where: {
            noteId,
            lifecycleStatus: 'active',
            noteContentHash: { not: currentContentHash },
            schemaVersion: { not: 3 }
          }
        });
        if (!rows.length) return [];
        await db.contentAnnotation.updateMany({
          where: { id: { in: rows.map(row => row.id) } },
          data: {
            status: 'stale',
            anchorStatus: 'needsReview',
            anchorReason: 'contentChanged',
            revision: { increment: 1 },
            updatedAt: new Date()
          }
        });
        return rows.map(row => mapAnnotation({ ...row, status: 'stale' }));
      });
    },
    supportsAsync: true
  };
}

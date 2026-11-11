import { Prisma } from '@prisma/client';
import type * as Models from '@prisma/client';
import type { ContentAnnotation } from '../../domain/content-annotation.ts';
import type { CreateContentAnnotationDto } from '../../application/dto/content-annotation-dto.ts';
import { mapAnnotation, toDate } from './mappers.ts';
import { withRepositoryErrors } from './repository-utils.ts';

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
  upsert(input: {
    where: { id: string };
    create: Prisma.ContentAnnotationUncheckedCreateInput;
    update: Prisma.ContentAnnotationUncheckedUpdateInput;
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
// 来自查询/历史来源的筛选值，沿用原真值判断并交给 SDK 校验。
interface AnnotationListOptions {
  noteId?: unknown;
  spaceId?: unknown;
  includeDeleted?: unknown;
  kind?: unknown;
  scopeType?: unknown;
  anchorStatus?: unknown;
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
      // 仅在原 SQL 调用处描述写入输入；历史 JSON 值仍由 Prisma 校验。
      return withRepositoryErrors(async () =>
        mapAnnotation(
          await db.contentAnnotation.upsert({
            where: { id: data.id },
            create: data as Prisma.ContentAnnotationUncheckedCreateInput,
            update: (() => {
              const { id: _ignoredId, createdAt: _ignoredCreatedAt, ...updateData } = data;
              return updateData;
            })() as Prisma.ContentAnnotationUncheckedUpdateInput
          })
        )
      );
    },
    async findById(id: unknown) {
      return withRepositoryErrors(async () =>
        mapAnnotation(await db.contentAnnotation.findUnique({ where: { id: id as string } }))
      );
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
            where: where as AnnotationWhere,
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

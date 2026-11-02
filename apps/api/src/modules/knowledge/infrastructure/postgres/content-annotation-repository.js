import { Prisma } from '@prisma/client';
import { mapAnnotation, toDate } from './mappers.ts';
import { withRepositoryErrors } from './repository-utils.js';

export function createPostgresContentAnnotationRepository({ db }) {
  if (!db?.contentAnnotation) {
    throw new TypeError('PostgreSQL annotation repository requires db.contentAnnotation');
  }

  return {
    async save(annotation) {
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
          await db.contentAnnotation.upsert({
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
    async findById(id) {
      return withRepositoryErrors(async () => mapAnnotation(await db.contentAnnotation.findUnique({ where: { id } })));
    },
    async findByIdempotencyKey(noteId, idempotencyKey) {
      return withRepositoryErrors(async () =>
        mapAnnotation(
          await db.contentAnnotation.findUnique({
            where: { noteId_idempotencyKey: { noteId, idempotencyKey } }
          })
        )
      );
    },
    async findDuplicate({ noteId, kind, scopeType, anchorFingerprint, quoteText, fromPosition, toPosition }) {
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
    /** @param {{ noteId?: string, spaceId?: string, includeDeleted?: boolean, kind?: string, scopeType?: string, anchorStatus?: string }} options */
    async list({ noteId, spaceId, includeDeleted = false, kind, scopeType, anchorStatus } = {}) {
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
    async deleteByNoteIds(noteIds) {
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
    async markStaleByNoteId(noteId, currentContentHash) {
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

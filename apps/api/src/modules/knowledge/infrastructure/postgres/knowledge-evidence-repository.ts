import type { Prisma } from '@prisma/client';
import { mapKnowledgeEvidence, toDate } from './mappers.ts';
import { withRepositoryErrors } from './repository-utils.ts';
import type {
  EvidenceRepositoryOptions,
  EvidenceWriteInput,
  EvidenceWriteData,
  EvidenceWhere
} from './knowledge-graph-repository-types.ts';
import type { SyncMappedEntityMap } from '../../../sync/postgres-state-types.ts';

export function createPostgresKnowledgeEvidenceRepository({ db }: EvidenceRepositoryOptions) {
  if (!db?.knowledgeEvidence)
    throw new TypeError('PostgreSQL KnowledgeEvidence repository requires db.knowledgeEvidence');
  function toData(evidence: EvidenceWriteInput) {
    return {
      id: evidence.id,
      knowledgeItemId: evidence.knowledgeItemId,
      sourceType: evidence.sourceType,
      sourceId: evidence.sourceId ?? null,
      noteId: evidence.noteId ?? null,
      noteVersionId: evidence.noteVersionId ?? null,
      annotationId: evidence.annotationId ?? null,
      quoteText: evidence.quoteText ?? '',
      headingPath: evidence.headingPath ?? [],
      relationType: evidence.relationType ?? 'supports',
      status: evidence.status ?? 'valid',
      applicabilityStatus: evidence.applicabilityStatus ?? (evidence.status === 'invalid' ? 'needsReview' : 'active'),
      createdAt: toDate(evidence.createdAt),
      updatedAt: toDate(evidence.updatedAt)
    };
  }
  function whereFor(options: EvidenceWhere = {}) {
    return {
      ...(options.knowledgeItemId ? { knowledgeItemId: options.knowledgeItemId } : {}),
      ...(options.noteId ? { noteId: options.noteId } : {}),
      ...(options.noteVersionId ? { noteVersionId: options.noteVersionId } : {}),
      ...(options.annotationId ? { annotationId: options.annotationId } : {})
    };
  }
  async function mark(where: EvidenceWhere, status: string) {
    return withRepositoryErrors(async () => {
      const statusFilter = status === 'stale' ? { notIn: ['stale', 'invalid'] } : { not: status };
      const rows = await db.knowledgeEvidence.findMany({
        where: { ...where, status: statusFilter } as Prisma.KnowledgeEvidenceWhereInput
      });
      if (!rows.length) return [];
      await db.knowledgeEvidence.updateMany({
        where: { id: { in: rows.map(row => row.id) } },
        data: { status, updatedAt: new Date() }
      });
      return rows.map(row => mapKnowledgeEvidence({ ...row, status }));
    });
  }
  return {
    async create(evidence: EvidenceWriteInput) {
      return withRepositoryErrors(() =>
        db.knowledgeEvidence
          .create({
            data: toData(evidence) as EvidenceWriteData
          })
          .then(mapKnowledgeEvidence)
      );
    },
    async save(evidence: EvidenceWriteInput) {
      const data = toData(evidence);
      return withRepositoryErrors(() =>
        db.knowledgeEvidence
          .upsert({
            where: { id: data.id },
            create: data as EvidenceWriteData,
            update: (() => {
              const { id: _ignoredId, createdAt: _ignoredCreatedAt, ...updateData } = data;
              return updateData;
            })() as Partial<EvidenceWriteData>
          })
          .then(mapKnowledgeEvidence)
      );
    },
    async findById(id: unknown) {
      return withRepositoryErrors(() =>
        db.knowledgeEvidence
          .findUnique({ where: { id: id as string } })
          .then<SyncMappedEntityMap['knowledgeEvidence'] | null>(mapKnowledgeEvidence)
      );
    },
    async deleteByKnowledgeItemId(knowledgeItemId: unknown) {
      return withRepositoryErrors(async () => {
        const rows = await db.knowledgeEvidence.findMany({ where: { knowledgeItemId: knowledgeItemId as string } });
        if (rows.length)
          await db.knowledgeEvidence.deleteMany({ where: { knowledgeItemId: knowledgeItemId as string } });
        return rows.map(mapKnowledgeEvidence);
      });
    },
    list(options: EvidenceWhere = {}) {
      return withRepositoryErrors(() =>
        db.knowledgeEvidence
          .findMany({
            where: whereFor(options) as Prisma.KnowledgeEvidenceWhereInput,
            orderBy: { createdAt: 'asc' }
          })
          .then(rows => rows.map(mapKnowledgeEvidence))
      );
    },
    markByNoteId(noteId: unknown, status: string) {
      return mark({ noteId }, status);
    },
    markByAnnotationId(annotationId: unknown, status: string) {
      return mark({ annotationId }, status);
    },
    markByNoteVersionId(noteVersionId: unknown, status: string, sourceType: string | null = null) {
      return mark({ noteVersionId, ...(sourceType ? { sourceType } : {}) }, status);
    },
    markByNoteVersionIds(
      noteVersionIds: { readonly length?: unknown },
      status: string,
      sourceType: string | null = null
    ) {
      if (!noteVersionIds.length) return Promise.resolve([]);
      return mark({ noteVersionId: { in: noteVersionIds }, ...(sourceType ? { sourceType } : {}) }, status);
    },
    supportsAsync: true
  };
}

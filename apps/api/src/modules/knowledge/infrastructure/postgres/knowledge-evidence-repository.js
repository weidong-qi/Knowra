import { mapKnowledgeEvidence, toDate } from './mappers.ts';
import { withRepositoryErrors } from './repository-utils.js';

export function createPostgresKnowledgeEvidenceRepository({ db }) {
  if (!db?.knowledgeEvidence)
    throw new TypeError('PostgreSQL KnowledgeEvidence repository requires db.knowledgeEvidence');
  function toData(evidence) {
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
  function whereFor(options = {}) {
    return {
      ...(options.knowledgeItemId ? { knowledgeItemId: options.knowledgeItemId } : {}),
      ...(options.noteId ? { noteId: options.noteId } : {}),
      ...(options.noteVersionId ? { noteVersionId: options.noteVersionId } : {}),
      ...(options.annotationId ? { annotationId: options.annotationId } : {})
    };
  }
  async function mark(where, status) {
    return withRepositoryErrors(async () => {
      const statusFilter = status === 'stale' ? { notIn: ['stale', 'invalid'] } : { not: status };
      const rows = await db.knowledgeEvidence.findMany({ where: { ...where, status: statusFilter } });
      if (!rows.length) return [];
      await db.knowledgeEvidence.updateMany({
        where: { id: { in: rows.map(row => row.id) } },
        data: { status, updatedAt: new Date() }
      });
      return rows.map(row => mapKnowledgeEvidence({ ...row, status }));
    });
  }
  return {
    async create(evidence) {
      return withRepositoryErrors(() =>
        db.knowledgeEvidence
          .create({
            data: toData(evidence)
          })
          .then(mapKnowledgeEvidence)
      );
    },
    async save(evidence) {
      const data = toData(evidence);
      return withRepositoryErrors(() =>
        db.knowledgeEvidence
          .upsert({
            where: { id: data.id },
            create: data,
            update: (() => {
              const { id: _ignoredId, createdAt: _ignoredCreatedAt, ...updateData } = data;
              return updateData;
            })()
          })
          .then(mapKnowledgeEvidence)
      );
    },
    async findById(id) {
      return withRepositoryErrors(() => db.knowledgeEvidence.findUnique({ where: { id } }).then(mapKnowledgeEvidence));
    },
    async deleteByKnowledgeItemId(knowledgeItemId) {
      return withRepositoryErrors(async () => {
        const rows = await db.knowledgeEvidence.findMany({ where: { knowledgeItemId } });
        if (rows.length) await db.knowledgeEvidence.deleteMany({ where: { knowledgeItemId } });
        return rows.map(mapKnowledgeEvidence);
      });
    },
    list(options = {}) {
      return withRepositoryErrors(() =>
        db.knowledgeEvidence
          .findMany({
            where: whereFor(options),
            orderBy: { createdAt: 'asc' }
          })
          .then(rows => rows.map(mapKnowledgeEvidence))
      );
    },
    markByNoteId(noteId, status) {
      return mark({ noteId }, status);
    },
    markByAnnotationId(annotationId, status) {
      return mark({ annotationId }, status);
    },
    markByNoteVersionId(noteVersionId, status, sourceType = null) {
      return mark({ noteVersionId, ...(sourceType ? { sourceType } : {}) }, status);
    },
    markByNoteVersionIds(noteVersionIds, status, sourceType = null) {
      if (!noteVersionIds.length) return Promise.resolve([]);
      return mark({ noteVersionId: { in: noteVersionIds }, ...(sourceType ? { sourceType } : {}) }, status);
    },
    supportsAsync: true
  };
}

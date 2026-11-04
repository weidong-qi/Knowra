import { calculateContentHash } from '@study-accelerator/content-anchor';
import { validateKnowledgeExtractionCommit } from '../../modules/ai/knowledge-extraction-commit-contract.js';
import {
  knowledgeArtifactProvenanceId,
  hashKnowledgeArtifactProvenance,
  validateKnowledgeArtifactProvenance,
  resolveKnowledgeArtifactProvenanceSource
} from '../../modules/knowledge/domain/knowledge-artifact-provenance-contract.ts';
import { migrateLegacyKnowledgeArtifactProvenance } from '../../modules/knowledge/domain/knowledge-artifact-provenance-state.ts';
import { assertProvenanceWrite } from '../../modules/knowledge/infrastructure/knowledge-artifact-provenance-repository.js';

/**
 * @overload
 * @param {unknown} extension
 * @returns {unknown[]}
 */
/** @returns {unknown[]} */
export function legacyKnowledgeExtractionReceipts(extension) {
  return extension?.version === 1 && Object.keys(extension).length === 2 && Array.isArray(extension.receipts)
    ? extension.receipts
    : [];
}

/** 只从已经验证的宿主 receipt 挑选白名单；不改变原 receipt 或其 hash。 */
/**
 * @param {import('../../modules/ai/knowledge-extraction-commit-types.ts').KnowledgeExtractionCommitReceipt} receipt
 * @param {import('../../modules/knowledge/application/knowledge-extraction-types.ts').ExtractionCandidatePlan} candidate
 */
export function createKnowledgeArtifactProvenanceFromReceipt(receipt, candidate) {
  const artifactId = candidate.candidateInput.id;
  const record = {
    id: knowledgeArtifactProvenanceId(artifactId),
    schemaVersion: 1,
    state: 'recorded',
    artifactKind: 'knowledgeItem',
    artifactId,
    executionMode: 'mock',
    provider: 'mock',
    modelId: receipt.modelId,
    promptVersion: receipt.promptVersion,
    resultSchemaVersion: receipt.resultSchemaVersion,
    origin: {
      jobId: receipt.jobId,
      requestId: receipt.requestId,
      scopeId: receipt.scopeId,
      spaceId: receipt.spaceId,
      receiptHash: receipt.receiptHash
    },
    inputHash: receipt.inputHash,
    outputHash: receipt.outputHash,
    committedAt: receipt.committedAt,
    sources: candidate.provenance.map((source, index) => ({
      evidenceId: candidate.candidateInput.evidence[index].id,
      sourceId: source.sourceId,
      noteId: source.noteId,
      originNoteVersionId: source.noteVersionId,
      contentHash: source.contentHash,
      start: source.start,
      end: source.end,
      quoteText: source.quoteText,
      quoteHash: calculateContentHash(source.quoteText),
      annotationRevisions: source.annotationRevisions.map(({ annotationId, revision }) => ({ annotationId, revision }))
    }))
  };
  return validateKnowledgeArtifactProvenance({ ...record, provenanceHash: hashKnowledgeArtifactProvenance(record) });
}

/** 只修改摘要集合。坏的可选旧 receipt 被隔离，坏的新摘要永远抛错。 */
/**
 * @param {import('./provenance-types.ts').ProvenanceBackfillState} state
 * @param {import('./provenance-types.ts').ProvenanceBackfillOptions} options */
export function backfillKnowledgeArtifactProvenance(state, { receipts = [], getTombstone = () => null } = {}) {
  const records = (state.knowledgeArtifactProvenance ??= []);
  records.forEach(validateKnowledgeArtifactProvenance);
  const items = new Map(state.knowledgeItems.map(item => [item.id, item]));
  const evidence = new Map(state.knowledgeEvidence.map(item => [item.id, item]));
  const notes = new Map(state.notes.map(item => [item.id, item]));
  const versions = new Map(state.noteVersions.map(item => [item.id, item]));
  const stats = { recorded: 0, legacy: 0, invalidReceipts: 0, unavailable: 0, deleted: 0 };
  for (const input of receipts) {
    let receipt;
    try {
      receipt = validateKnowledgeExtractionCommit(input);
    } catch {
      stats.invalidReceipts++;
      continue;
    }
    for (const candidate of receipt.candidates) {
      const item = items.get(candidate.candidateInput.id);
      if (!item) {
        stats.deleted++;
        continue;
      }
      let record;
      try {
        record = createKnowledgeArtifactProvenanceFromReceipt(receipt, candidate);
      } catch {
        stats.unavailable++;
        continue;
      }
      const refs = [
        ['knowledgeItems', item.id],
        ['knowledgeArtifactProvenance', record.id],
        ...record.sources.flatMap(source => [
          ['knowledgeEvidence', source.evidenceId],
          ['notes', source.noteId],
          ['noteVersions', source.originNoteVersionId],
          ['noteVersions', evidence.get(source.evidenceId)?.noteVersionId]
        ])
      ];
      if (refs.some(([collection, id]) => id && getTombstone(collection, id))) {
        stats.deleted++;
        continue;
      }
      try {
        for (const source of record.sources) {
          const link = evidence.get(source.evidenceId);
          resolveKnowledgeArtifactProvenanceSource({
            record,
            source,
            evidence: link,
            noteVersion: versions.get(link?.noteVersionId),
            note: notes.get(source.noteId),
            knowledgeItem: item
          });
          const original = versions.get(source.originNoteVersionId);
          if (original && (original.noteId !== source.noteId || original.contentHash !== source.contentHash))
            throw new Error('origin mismatch');
        }
      } catch {
        stats.unavailable++;
        continue;
      }
      const index = records.findIndex(existing => existing.artifactId === record.artifactId);
      const existing = records[index];
      assertProvenanceWrite(existing, record, { upgradeLegacy: true });
      if (existing?.provenanceHash === record.provenanceHash) continue;
      if (index < 0) records.push(record);
      else records[index] = record;
      stats.recorded++;
    }
  }
  const beforeLegacy = records.length;
  migrateLegacyKnowledgeArtifactProvenance(state);
  stats.legacy = records.length - beforeLegacy;
  return stats;
}

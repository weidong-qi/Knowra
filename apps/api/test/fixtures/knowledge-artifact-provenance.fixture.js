import assert from 'node:assert/strict';
import { calculateContentHash } from '@study-accelerator/content-anchor';
import { createEmptyLocalState } from '../../src/infrastructure/local-data-schema.js';
import { hashRecord } from '../../src/modules/ai/record-contract.ts';
import { validateKnowledgeExtractionResult } from '../../src/modules/knowledge/application/knowledge-extraction-contract.js';
import { validateKnowledgeExtractionCommit } from '../../src/modules/ai/knowledge-extraction-commit-contract.js';
import { createKnowledgeArtifactProvenanceFromReceipt } from '../../src/infrastructure/migration/knowledge-artifact-provenance-backfill.js';
import { validateKnowledgeArtifactProvenance } from '../../src/modules/knowledge/domain/knowledge-artifact-provenance-contract.js';

export function syntheticProvenanceFixture({ alias = false, recorded = false } = {}) {
  const time = '2026-10-02T00:00:00.000Z',
    content = '前言\n  合成😀来源 \n结尾',
    quote = '  合成😀来源 \n';
  const start = content.indexOf(quote),
    end = start + quote.length;
  const request = {
    contractVersion: 1,
    requestId: 'request-synthetic',
    scopeId: 'scope-synthetic',
    spaceId: 'space-synthetic',
    inputHash: calculateContentHash('synthetic-input'),
    sources: [
      {
        sourceId: 'source-synthetic',
        noteId: 'note-synthetic',
        noteVersionId: 'version-origin',
        contentHash: calculateContentHash(content),
        start: 0,
        end: content.length,
        markdown: content,
        annotationRevisions: []
      }
    ]
  };
  const result = {
    contractVersion: 1,
    requestId: request.requestId,
    candidates: [
      {
        title: '原始知识',
        canonicalStatement: '合成来源',
        knowledgeType: 'concept',
        citations: [{ sourceId: 'source-synthetic', start, end, quote }]
      }
    ]
  };
  const plan = validateKnowledgeExtractionResult({ request, result });
  const receiptContent = {
    schemaVersion: 1,
    executionMode: 'mock',
    ownerId: 'demo',
    datasetId: 'dataset-synthetic',
    datasetEpoch: 'epoch-synthetic',
    spaceId: request.spaceId,
    jobId: 'job-synthetic',
    attemptId: 'attempt-synthetic',
    scopeId: request.scopeId,
    requestId: request.requestId,
    inputHash: plan.inputHash,
    outputHash: plan.outputHash,
    modelId: 'legacy-model',
    promptVersion: 'legacy-prompt',
    resultSchemaVersion: 'knowledge-extraction-v1',
    committedAt: time,
    request,
    result,
    candidates: plan.candidates
  };
  const receipt = validateKnowledgeExtractionCommit({ ...receiptContent, receiptHash: hashRecord(receiptContent) });
  const state = createEmptyLocalState(),
    candidate = plan.candidates[0];
  const versionId = alias ? 'version-current-alias' : 'version-origin';
  state.spaces.push({ id: request.spaceId, userId: 'demo', name: '合成空间', createdAt: time, updatedAt: time });
  state.notes.push({
    id: 'note-synthetic',
    spaceId: request.spaceId,
    title: '合成笔记',
    rawMarkdown: content,
    contentHash: calculateContentHash(content),
    tagIds: [],
    internalLinks: [],
    deleted: false,
    createdAt: time,
    updatedAt: time
  });
  state.noteVersions.push({
    id: versionId,
    noteId: 'note-synthetic',
    content,
    contentHash: calculateContentHash(content),
    createdBy: 'user',
    createdAt: time
  });
  const { evidence, ...item } = candidate.candidateInput;
  state.knowledgeItems.push({ ...item, reviewStatus: 'candidate', createdAt: time, updatedAt: time, deletedAt: null });
  state.knowledgeEvidence.push(
    ...evidence.map(link => ({
      ...link,
      knowledgeItemId: item.id,
      noteVersionId: versionId,
      sourceId: versionId,
      quoteText: link.quoteText.trim(),
      relationType: 'supports',
      status: 'valid',
      applicabilityStatus: 'active',
      createdAt: time,
      updatedAt: time
    }))
  );
  const provenance = createKnowledgeArtifactProvenanceFromReceipt(receipt, candidate);
  if (recorded) state.knowledgeArtifactProvenance.push(provenance);
  return { state, receipt, provenance, artifactId: item.id };
}

/** 严格摘要合同接受 origin IDs/hash；传输内容不含执行端私有束。 */
export function assertMinimalProvenanceTransport(payload, expectedRecord) {
  validateKnowledgeArtifactProvenance(expectedRecord);
  const encoded = JSON.stringify(payload);
  assert(encoded.includes(expectedRecord.provenanceHash));
  assert(encoded.includes(expectedRecord.origin.jobId));
  const forbidden = new Set([
    'knowledgeExtractionCommits',
    'aiKnowledgeExtractionTasks',
    'aiRuntime',
    'receipt_json',
    'candidateInput',
    'request',
    'result',
    'grantId',
    'attemptId',
    'leaseGeneration',
    'credentialRef',
    'apiKey',
    'contextManifest'
  ]);
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert(!forbidden.has(key), `unexpected private field: ${key}`);
      visit(child);
    }
  };
  visit(payload);
}

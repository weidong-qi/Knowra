import assert from 'node:assert/strict';
import test from 'node:test';
import { syntheticProvenanceFixture } from './fixtures/knowledge-artifact-provenance.fixture.js';
import {
  backfillKnowledgeArtifactProvenance,
  legacyKnowledgeExtractionReceipts
} from '../src/infrastructure/migration/knowledge-artifact-provenance-backfill.ts';
import { createInMemoryKnowledgeArtifactProvenanceRepository } from '../src/modules/knowledge/infrastructure/knowledge-artifact-provenance-repository.ts';
import {
  createLegacyKnowledgeArtifactProvenance,
  hashKnowledgeArtifactProvenance
} from '../src/modules/knowledge/domain/knowledge-artifact-provenance-contract.ts';
import {
  assertNoKnowledgeArtifactProvenanceDowngrade,
  validateKnowledgeArtifactProvenanceRelations
} from '../src/modules/knowledge/domain/knowledge-artifact-provenance-state.ts';
import { validateLocalSnapshot } from '../src/infrastructure/local-data-schema.ts';
import { resolveAnalysisScopeNoteVersion } from '../src/modules/knowledge/domain/analysis-scope-version-alias.ts';

test('合法旧receipt只回填存活知识，保留用户修订与首份hash，并可幂等重跑', () => {
  const f = syntheticProvenanceFixture({ alias: true });
  Object.assign(f.state.knowledgeItems[0], {
    title: '用户标题',
    canonicalStatement: '用户解释',
    sourceMode: 'manual',
    reviewStatus: 'archived',
    deletedAt: '2026-10-02T01:00:00Z'
  });
  const before = structuredClone(f.state),
    originalReceipt = JSON.stringify(f.receipt);
  assert.equal(backfillKnowledgeArtifactProvenance(f.state, { receipts: [f.receipt] }).recorded, 1);
  assert.deepEqual(f.state.knowledgeItems, before.knowledgeItems);
  assert.deepEqual(f.state.knowledgeEvidence, before.knowledgeEvidence);
  assert.deepEqual(f.state.knowledgeArtifactProvenance, [f.provenance]);
  assert.equal(f.provenance.provider, 'mock');
  assert.equal(f.provenance.modelId, 'legacy-model');
  assert.equal(f.provenance.sources[0].originNoteVersionId, 'version-origin');
  assert.equal(JSON.stringify(f.receipt), originalReceipt);
  assert.equal(backfillKnowledgeArtifactProvenance(f.state, { receipts: [f.receipt] }).recorded, 0);
  validateKnowledgeArtifactProvenanceRelations(f.state);
});

test('purge、缺Evidence及相关墓碑不会从receipt重建核心资产', () => {
  for (const removal of ['artifact', 'evidence', 'tombstone']) {
    const f = syntheticProvenanceFixture();
    if (removal === 'artifact') {
      f.state.knowledgeItems = [];
      f.state.knowledgeEvidence = [];
    }
    if (removal === 'evidence') f.state.knowledgeEvidence = [];
    const before = structuredClone(f.state);
    backfillKnowledgeArtifactProvenance(f.state, {
      receipts: [f.receipt],
      getTombstone: collection => removal === 'tombstone' && collection === 'knowledgeEvidence'
    });
    assert.deepEqual(f.state.knowledgeItems, before.knowledgeItems);
    assert.deepEqual(f.state.knowledgeEvidence, before.knowledgeEvidence);
    assert.equal(
      f.state.knowledgeArtifactProvenance.some(record => record.state === 'recorded'),
      false
    );
    assert.equal(f.state.knowledgeArtifactProvenance.length, removal === 'artifact' ? 0 : 1);
  }
});

test('坏旧可选receipt只隔离；新版坏/未知摘要不得降级为legacy', () => {
  const f = syntheticProvenanceFixture();
  const broken = { ...f.receipt, receiptHash: 'broken' };
  assert.equal(backfillKnowledgeArtifactProvenance(f.state, { receipts: [broken] }).invalidReceipts, 1);
  assert.equal(f.state.knowledgeArtifactProvenance[0].state, 'legacy-unavailable');
  assert.deepEqual(legacyKnowledgeExtractionReceipts({ version: 2, receipts: [f.receipt] }), []);
  assert.deepEqual(legacyKnowledgeExtractionReceipts({ version: 1, receipts: [f.receipt], future: true }), []);
  for (const mutate of [
    r => {
      r.schemaVersion = 2;
    },
    r => {
      r.provenanceHash = '0'.repeat(64);
    }
  ]) {
    const copy = structuredClone(f.state);
    mutate(copy.knowledgeArtifactProvenance[0]);
    const before = structuredClone(copy);
    assert.throws(() => backfillKnowledgeArtifactProvenance(copy, { receipts: [f.receipt] }));
    assert.deepEqual(copy, before);
  }
});

test('schema1–6迁移legacy，schema7显式缺record及旧schema夹带record均拒绝', () => {
  const f = syntheticProvenanceFixture();
  for (const schemaVersion of [1, 2, 3, 4, 5, 6]) {
    const state = validateLocalSnapshot({ schemaVersion, data: f.state }).data;
    assert.equal(state.knowledgeArtifactProvenance[0].state, 'legacy-unavailable');
  }
  assert.throws(() => validateLocalSnapshot({ schemaVersion: 7, data: f.state }), {
    code: 'KNOWLEDGE_ARTIFACT_PROVENANCE_REQUIRED'
  });
  f.state.knowledgeArtifactProvenance = [f.provenance];
  assert.throws(() => validateLocalSnapshot({ schemaVersion: 6, data: f.state }), {
    code: 'STORAGE_SCHEMA_VERSION_UNSUPPORTED'
  });
  assert.deepEqual(validateLocalSnapshot({ schemaVersion: 7, data: f.state }).data.knowledgeArtifactProvenance, [
    f.provenance
  ]);
});

test('不可变仓储允许同hash幂等、受限legacy升级，拒绝异hash与降级且不泄露可变引用', () => {
  const f = syntheticProvenanceFixture(),
    legacy = createLegacyKnowledgeArtifactProvenance(f.artifactId);
  const repository = createInMemoryKnowledgeArtifactProvenanceRepository();
  repository.create(legacy);
  assert.throws(() => repository.create(f.provenance), { code: 'KNOWLEDGE_ARTIFACT_PROVENANCE_CONFLICT' });
  repository.upgradeLegacy(f.provenance);
  repository.create(f.provenance);
  assert.throws(() => repository.upgradeLegacy(legacy), { code: 'KNOWLEDGE_ARTIFACT_PROVENANCE_CONFLICT' });
  const changed = { ...f.provenance, modelId: 'other' };
  delete changed.provenanceHash;
  changed.provenanceHash = hashKnowledgeArtifactProvenance(changed);
  assert.throws(() => repository.create(changed), { code: 'KNOWLEDGE_ARTIFACT_PROVENANCE_CONFLICT' });
  repository.findByArtifactId(f.artifactId).sources[0].quoteText = 'caller changed';
  assert.deepEqual(repository.list(), [f.provenance]);
  const records = [],
    failing = createInMemoryKnowledgeArtifactProvenanceRepository({
      records,
      onChange() {
        throw new Error('failed');
      }
    });
  assert.throws(() => failing.create(f.provenance), /failed/);
  assert.deepEqual(records, []);
});

test('恢复不能降级已有recorded，当前sourceMode改manual也须保留', () => {
  const f = syntheticProvenanceFixture({ recorded: true });
  f.state.knowledgeItems[0].sourceMode = 'manual';
  const downgrade = structuredClone(f.state);
  downgrade.knowledgeArtifactProvenance = [createLegacyKnowledgeArtifactProvenance(f.artifactId)];
  assert.throws(() => assertNoKnowledgeArtifactProvenanceDowngrade(f.state, downgrade), {
    code: 'KNOWLEDGE_ARTIFACT_PROVENANCE_CONFLICT'
  });
  downgrade.knowledgeArtifactProvenance = [];
  assert.throws(() => assertNoKnowledgeArtifactProvenanceDowngrade(f.state, downgrade), {
    code: 'KNOWLEDGE_ARTIFACT_PROVENANCE_CONFLICT'
  });
});

test('历史AnalysisScope只读解析同note/content alias，scope与原hash不改变，错hash及错片段拒绝', () => {
  const f = syntheticProvenanceFixture({ alias: true, recorded: true }),
    source = f.receipt.request.sources[0];
  const binding = { noteId: source.noteId, noteVersionId: source.noteVersionId, contentHash: source.contentHash };
  const scope = {
    id: f.receipt.scopeId,
    inputHash: f.receipt.inputHash,
    noteVersions: [binding],
    segments: [
      {
        noteId: source.noteId,
        noteVersionId: source.noteVersionId,
        start: source.start,
        end: source.end,
        markdown: source.markdown
      }
    ],
    contextSegments: []
  };
  const before = structuredClone(scope);
  assert.equal(resolveAnalysisScopeNoteVersion(scope, binding, f.state.noteVersions).id, 'version-current-alias');
  assert.deepEqual(scope, before);
  assert.deepEqual(f.state.knowledgeArtifactProvenance, [f.provenance]);
  assert.throws(() => resolveAnalysisScopeNoteVersion(scope, { ...binding, noteId: 'other' }, f.state.noteVersions), {
    code: 'ANALYSIS_SCOPE_VERSION_MISMATCH'
  });
  const wrongOriginal = { ...f.state.noteVersions[0], id: source.noteVersionId, contentHash: '0'.repeat(64) };
  assert.throws(() => resolveAnalysisScopeNoteVersion(scope, binding, [...f.state.noteVersions, wrongOriginal]), {
    code: 'ANALYSIS_SCOPE_VERSION_MISMATCH'
  });
  scope.segments[0].markdown = '错误摘录';
  assert.throws(() => resolveAnalysisScopeNoteVersion(scope, binding, f.state.noteVersions), {
    code: 'ANALYSIS_SCOPE_VERSION_MISMATCH'
  });
});

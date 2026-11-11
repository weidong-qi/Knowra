import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildKnowledgeProposalPlan } from '../src/modules/ai/knowledge-propose-tool.ts';
import { createKnowledgeArtifactProvenanceFromProposal } from '../src/modules/ai/agent-knowledge-provenance.ts';
import {
  hashKnowledgeArtifactProvenance,
  resolveKnowledgeArtifactProvenanceSource,
  validateKnowledgeArtifactProvenance
} from '../src/modules/knowledge/domain/knowledge-artifact-provenance-contract.ts';

const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
const seal = ({ provenanceHash, ...content }) => ({
  ...content,
  provenanceHash: hashKnowledgeArtifactProvenance(content)
});
const CONTENT = '前言\n数据增强通过变换样本增加训练变化😀。\n结尾';
const QUOTE = '数据增强通过变换样本增加训练变化😀。';

async function fixture() {
  const start = CONTENT.indexOf(QUOTE),
    end = start + QUOTE.length;
  const access = {
    async verifyRead({ noteId }) {
      return {
        note: { id: noteId, spaceId: 'space-1' },
        version: { id: 'version-1', content: CONTENT },
        contentHash: sha(CONTENT)
      };
    }
  };
  const ref = {
    noteId: 'note-1',
    noteVersionId: 'version-1',
    contentHash: sha(CONTENT),
    start: 0,
    end: CONTENT.length,
    quoteHash: sha(CONTENT)
  };
  const plan = await buildKnowledgeProposalPlan({
    access,
    grantId: 'g',
    sourceRefs: [ref],
    turnId: 'turn-1',
    callId: 'call-1',
    args: {
      candidates: [
        {
          title: '数据增强',
          canonicalStatement: QUOTE,
          knowledgeType: 'concept',
          citations: [{ noteId: 'note-1', start, end, quote: QUOTE }]
        }
      ]
    }
  });
  const candidate = plan.candidates[0];
  const record = createKnowledgeArtifactProvenanceFromProposal({
    plan,
    candidate,
    origin: { conversationId: 'conversation-1', turnId: 'turn-1', toolCallId: 'call-1' },
    provider: 'deepseek',
    modelId: 'deepseek-flash',
    committedAt: '2026-10-05T00:00:00.000Z'
  });
  return { plan, candidate, record, start, end };
}

test('Agent 来源摘要：由已校验提议生成，通过 v1 契约并保持稳定', async () => {
  const { record, candidate, start, end, plan } = await fixture();
  assert.equal(record.executionMode, 'agent');
  assert.equal(record.provider, 'deepseek');
  assert.deepEqual(Object.keys(record.origin), [
    'conversationId',
    'turnId',
    'toolCallId',
    'requestId',
    'spaceId',
    'receiptHash'
  ]);
  assert.equal(record.origin.requestId, plan.requestId);
  assert.equal(record.origin.spaceId, 'space-1');
  assert.equal(record.artifactId, candidate.candidateInput.id);
  const [source] = record.sources;
  assert.equal(source.start, start);
  assert.equal(source.end, end);
  assert.equal(source.quoteText, QUOTE);
  assert.equal(source.evidenceId, candidate.candidateInput.evidence[0].id);
  assert.deepEqual(source.annotationRevisions, []);
  assert.deepEqual(validateKnowledgeArtifactProvenance(record), record);
  assert.equal((await fixture()).record.provenanceHash, record.provenanceHash);
});

test('Agent 来源摘要：模式与 provider、origin 形状必须互相匹配', async () => {
  const { record } = await fixture();
  const mutations = {
    'agent 使用 mock provider': value => ({ ...value, provider: 'mock' }),
    'agent 缺少 conversationId': value => ({ ...value, origin: { ...value.origin, conversationId: undefined } }),
    'agent 使用 mock 形状 origin': value => ({
      ...value,
      origin: { jobId: 'j', requestId: 'r', scopeId: 's', spaceId: 'x', receiptHash: sha('r') }
    }),
    'agent origin 多余字段': value => ({ ...value, origin: { ...value.origin, scopeId: 's' } }),
    'agent origin 非法 receiptHash': value => ({ ...value, origin: { ...value.origin, receiptHash: 'bad' } }),
    'agent origin 空 turnId': value => ({ ...value, origin: { ...value.origin, turnId: '' } }),
    未知执行模式: value => ({ ...value, executionMode: 'cloud' }),
    'mock 模式使用非 mock provider': value => ({
      ...value,
      executionMode: 'mock',
      provider: 'deepseek',
      origin: { jobId: 'j', requestId: 'r', scopeId: 's', spaceId: 'x', receiptHash: sha('r') }
    })
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const changed = mutate(structuredClone(record));
    if ('conversationId' in (changed.origin ?? {}) && changed.origin.conversationId === undefined)
      delete changed.origin.conversationId;
    assert.throws(
      () => validateKnowledgeArtifactProvenance(seal(changed)),
      { code: 'KNOWLEDGE_ARTIFACT_PROVENANCE_INVALID' },
      name
    );
  }
  assert.throws(() => validateKnowledgeArtifactProvenance({ ...record, outputHash: sha('tampered') }), {
    code: 'KNOWLEDGE_ARTIFACT_PROVENANCE_HASH_MISMATCH'
  });
});

test('Agent 来源摘要：沿用既有证据解析，当前笔记变化后标记 stale', async () => {
  const { record, candidate } = await fixture();
  const [source] = record.sources;
  const evidence = {
    id: source.evidenceId,
    knowledgeItemId: record.artifactId,
    noteId: 'note-1',
    sourceType: 'noteVersion',
    noteVersionId: 'version-1',
    quoteText: QUOTE.trim(),
    status: 'valid',
    applicabilityStatus: 'active'
  };
  const noteVersion = { id: 'version-1', noteId: 'note-1', contentHash: sha(CONTENT), content: CONTENT };
  const knowledgeItem = {
    id: candidate.candidateInput.id,
    sourceMode: 'ai',
    reviewStatus: 'candidate',
    deletedAt: null
  };
  const resolve = note =>
    resolveKnowledgeArtifactProvenanceSource({ record, source, evidence, noteVersion, note, knowledgeItem });
  assert.equal(resolve({ id: 'note-1', rawMarkdown: CONTENT, deleted: false }).sourceState, 'available');
  assert.equal(resolve({ id: 'note-1', rawMarkdown: `${CONTENT}\n新增`, deleted: false }).sourceState, 'stale');
  assert.equal(resolve({ id: 'note-1', rawMarkdown: CONTENT, deleted: true }).sourceState, 'unavailable');
  assert.throws(() => resolve({ id: 'other-note', rawMarkdown: CONTENT }), {
    code: 'KNOWLEDGE_ARTIFACT_PROVENANCE_SOURCE_MISMATCH'
  });
});

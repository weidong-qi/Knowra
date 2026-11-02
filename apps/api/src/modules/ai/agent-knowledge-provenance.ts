import { calculateContentHash } from '@study-accelerator/content-anchor';
import { hashRecord } from './record-contract.ts';
import {
  knowledgeArtifactProvenanceId,
  hashKnowledgeArtifactProvenance,
  validateKnowledgeArtifactProvenance
} from '../knowledge/domain/knowledge-artifact-provenance-contract.ts';

// 只描述构建器读取的最小视图；外部事实仍由原来源验证器判定。
export interface ProposalCandidateIdentity {
  candidateInput: { id?: unknown };
}
export interface ProvenanceProposalPlan {
  requestId?: unknown;
  inputHash?: unknown;
  outputHash?: unknown;
  spaceId?: unknown;
  candidates: readonly ProposalCandidateIdentity[];
}
export interface ProposalProvenanceSource {
  sourceId?: unknown;
  noteId?: unknown;
  noteVersionId?: unknown;
  contentHash?: unknown;
  start?: unknown;
  end?: unknown;
  quoteText: string;
}
export interface ProvenanceProposalCandidate {
  candidateInput: { id?: unknown; evidence: readonly { id?: unknown }[] };
  provenance: readonly ProposalProvenanceSource[];
}
export interface AgentProvenanceOrigin {
  conversationId?: unknown;
  turnId?: unknown;
  toolCallId?: unknown;
}
export interface McpProvenanceOrigin {
  pairingId?: unknown;
  callId?: unknown;
}
export interface AgentProvenanceInput {
  plan: ProvenanceProposalPlan;
  candidate: ProvenanceProposalCandidate;
  origin: AgentProvenanceOrigin;
  provider: unknown;
  modelId: unknown;
  committedAt: unknown;
}
export interface McpProvenanceInput {
  plan: ProvenanceProposalPlan;
  candidate: ProvenanceProposalCandidate;
  origin: McpProvenanceOrigin;
  committedAt: unknown;
}

export const AGENT_KNOWLEDGE_PROMPT_VERSION = 'agent-knowledge-propose-v1';
export const AGENT_KNOWLEDGE_RESULT_SCHEMA = 'knowledge-extraction-v1';
export const MCP_KNOWLEDGE_PROMPT_VERSION = 'mcp-knowledge-propose-v1';

/**
 * 把已校验的 Agent 知识提议转为来源摘要记录。只挑选白名单事实：候选 ID、引文位置与原文、
 * 生成它的对话回合与工具调用，以及整份提议的哈希；不包含对话文本、请求原文或凭据。
 * 引文位置是相对笔记版本的绝对偏移，标注修订在 Agent 路径不跟踪，固定为空。
 */
export function createKnowledgeArtifactProvenanceFromProposal({
  plan,
  candidate,
  origin,
  provider,
  modelId,
  committedAt
}: AgentProvenanceInput) {
  const artifactId = candidate.candidateInput.id;
  const receiptHash = hashRecord({
    requestId: plan.requestId,
    inputHash: plan.inputHash,
    outputHash: plan.outputHash,
    conversationId: origin.conversationId,
    turnId: origin.turnId,
    toolCallId: origin.toolCallId,
    candidateIds: plan.candidates.map(item => item.candidateInput.id)
  });
  const record = {
    id: knowledgeArtifactProvenanceId(artifactId),
    schemaVersion: 1,
    state: 'recorded',
    artifactKind: 'knowledgeItem',
    artifactId,
    executionMode: 'agent',
    provider,
    modelId,
    promptVersion: AGENT_KNOWLEDGE_PROMPT_VERSION,
    resultSchemaVersion: AGENT_KNOWLEDGE_RESULT_SCHEMA,
    origin: {
      conversationId: origin.conversationId,
      turnId: origin.turnId,
      toolCallId: origin.toolCallId,
      requestId: plan.requestId,
      spaceId: plan.spaceId,
      receiptHash
    },
    inputHash: plan.inputHash,
    outputHash: plan.outputHash,
    committedAt,
    sources: sourcesOf(candidate)
  };
  return validateKnowledgeArtifactProvenance({ ...record, provenanceHash: hashKnowledgeArtifactProvenance(record) });
}

const sourcesOf = (candidate: ProvenanceProposalCandidate) =>
  candidate.provenance.map((source, index) => ({
    evidenceId: candidate.candidateInput.evidence[index].id,
    sourceId: source.sourceId,
    noteId: source.noteId,
    originNoteVersionId: source.noteVersionId,
    contentHash: source.contentHash,
    start: source.start,
    end: source.end,
    quoteText: source.quoteText,
    quoteHash: calculateContentHash(source.quoteText),
    annotationRevisions: []
  }));

/**
 * 外部 AI 客户端（本机 MCP）提议的候选的来源摘要。客户端不报告可信的模型信息，所以 provider 固定为 external-client、
 * modelId 固定为 unreported；origin 只有配对 ID 与调用 ID（客户端给的幂等键或由提议内容派生），不含对话内容与客户端自述。
 */
export function createKnowledgeArtifactProvenanceFromMcpProposal({
  plan,
  candidate,
  origin,
  committedAt
}: McpProvenanceInput) {
  const artifactId = candidate.candidateInput.id;
  const receiptHash = hashRecord({
    requestId: plan.requestId,
    inputHash: plan.inputHash,
    outputHash: plan.outputHash,
    pairingId: origin.pairingId,
    callId: origin.callId,
    candidateIds: plan.candidates.map(item => item.candidateInput.id)
  });
  const record = {
    id: knowledgeArtifactProvenanceId(artifactId),
    schemaVersion: 1,
    state: 'recorded',
    artifactKind: 'knowledgeItem',
    artifactId,
    executionMode: 'mcp',
    provider: 'external-client',
    modelId: 'unreported',
    promptVersion: MCP_KNOWLEDGE_PROMPT_VERSION,
    resultSchemaVersion: AGENT_KNOWLEDGE_RESULT_SCHEMA,
    origin: {
      pairingId: origin.pairingId,
      callId: origin.callId,
      requestId: plan.requestId,
      spaceId: plan.spaceId,
      receiptHash
    },
    inputHash: plan.inputHash,
    outputHash: plan.outputHash,
    committedAt,
    sources: sourcesOf(candidate)
  };
  return validateKnowledgeArtifactProvenance({ ...record, provenanceHash: hashKnowledgeArtifactProvenance(record) });
}

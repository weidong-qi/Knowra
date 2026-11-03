import { apiClient } from '@study-accelerator/web-core';

export interface Conversation {
  conversationId: string;
  spaceId: string;
  createdAt: string;
  updatedAt: string;
  historicalDataset: boolean;
  readOnly: boolean;
}

export interface SourceRef {
  noteId: string;
  noteVersionId: string;
  contentHash: string;
  start: number;
  end: number;
  quoteHash: string;
}

export interface ConversationMessage {
  messageId: string;
  turnId: string;
  sequence: number;
  role: 'user' | 'assistant';
  content: string;
  sourceRefs: SourceRef[];
  citations?: SourceRef[];
  sourceFree: boolean;
  createdAt: string;
}

export interface ToolCall {
  callId: string;
  ordinal: number;
  toolName: 'notes_search' | 'notes_read' | 'notes_create' | 'notes_append' | 'notes_propose_patch' | 'notes_propose_organize' | 'annotations_list' | 'knowledge_propose';
  argumentsJson: Record<string, unknown>;
  resultJson: Record<string, unknown> | null;
  status: 'requested' | 'succeeded' | 'failed';
  sourceRefs: SourceRef[];
  errorCode: string | null;
}

export interface ConversationTurn {
  turnId: string;
  conversationId: string;
  requestedPolicyId: string | null;
  status: 'staged' | 'running' | 'interrupted' | 'succeeded' | 'failed' | 'cancelled';
  phase: 'waiting' | 'retrieving' | 'generating' | 'validating' | 'finished';
  errorCode: string | null;
  assistantMessageId?: string | null;
  toolCalls?: ToolCall[];
  checkpoint?: { handledAttemptOrdinal: number };
  modelAttempts?: Array<{ attemptId: string; status: string; actualMicrounits: number | null; ordinal?: number; modelResult?: unknown }>;
}

export interface AccessPolicy {
  policyId: string;
  revision: number;
  spaceId: string;
  scope: { kind: 'library' } | { kind: 'folder'; folderId: string } | { kind: 'fixed'; noteIds: string[] };
  /** 范围内被明确排除的笔记；排除项优先于范围，服务端读取时同样拒绝。 */
  excludedNoteIds?: string[];
  read?: boolean;
  egress: boolean;
  recipients: string[];
  expiresAt: string;
  revokedAt: string | null;
}

const root = '/api/ai/conversations';
const accessRoot = '/api/ai/access-policies';
const conversationHeaders = { 'X-Knowra-AI-Conversation': '1' };
const accessHeaders = { 'X-Knowra-AI-Access': '1' };
const data = async <T>(url: string, options?: Parameters<typeof apiClient.requestJson>[1]) =>
  (await apiClient.requestJson<{ data: T }>(url, options)).data;
const path = (id: string) => `${root}/${encodeURIComponent(id)}`;

export const conversationApi = {
  list: (spaceId: string) => data<Conversation[]>(`${root}?spaceId=${encodeURIComponent(spaceId)}`),
  create: (spaceId: string, conversationId: string) => data<Conversation>(root, {
    method: 'POST', headers: conversationHeaders, body: JSON.stringify({ spaceId, conversationId })
  }),
  messages: (id: string, afterSequence = 0) => data<ConversationMessage[]>(
    `${path(id)}/messages?afterSequence=${afterSequence}&limit=100`),
  send: (id: string, input: { content: string; idempotencyKey: string; requestedPolicyId: string | null; writeIntent?: { toolName: string; noteId?: string } }) =>
    data<ConversationTurn>(`${path(id)}/messages`, {
      method: 'POST', headers: conversationHeaders, body: JSON.stringify({ ...input, execute: true })
    }),
  turn: (id: string, turnId: string) => data<ConversationTurn>(
    `${path(id)}/turns/${encodeURIComponent(turnId)}`),
  cancel: (id: string, turnId: string) => data<ConversationTurn>(
    `${path(id)}/turns/${encodeURIComponent(turnId)}/cancel`, { method: 'POST', headers: conversationHeaders }),
  retry: (id: string, turnId: string) => data<ConversationTurn>(
    `${path(id)}/turns/${encodeURIComponent(turnId)}/retry`, { method: 'POST', headers: conversationHeaders }),
  resume: (id: string, turnId: string) => data<ConversationTurn>(
    `${path(id)}/turns/${encodeURIComponent(turnId)}/resume`, { method: 'POST', headers: conversationHeaders }),
  policies: (spaceId: string) => data<AccessPolicy[]>(
    `${accessRoot}?spaceId=${encodeURIComponent(spaceId)}`, { headers: accessHeaders }),
  createPolicy: (input: { spaceId: string; scope: AccessPolicy['scope']; expiresAt: string }) =>
    data<AccessPolicy>(accessRoot, { method: 'POST', headers: accessHeaders,
      body: JSON.stringify({ ...input, excludedNoteIds: [], includeAttachments: false,
        read: true, egress: true, recipients: ['deepseek'] }) }),
  revokePolicy: (policy: AccessPolicy) => data<AccessPolicy>(`${accessRoot}/${encodeURIComponent(policy.policyId)}`, {
    method: 'PATCH', headers: accessHeaders, body: JSON.stringify({ revision: policy.revision, revoke: true })
  })
};

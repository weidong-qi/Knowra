/** 持久化 v2 记录的 AJV 字段契约；校验逻辑仍由原 schema 与记录校验器执行。 */
export interface RecordBoundary {
  contractVersion: 2;
  ownerId: string;
  datasetId: string;
  datasetEpoch: string;
  spaceId: string;
}
export interface AiAccessPolicy extends RecordBoundary {
  kind: 'aiAccessPolicy';
  policyId: string;
  revision: number;
  actorId: string;
  scope: { kind: 'library' } | { kind: 'folder'; folderId: string } | { kind: 'fixed'; noteIds: string[] };
  excludedNoteIds: string[];
  includeAttachments: false;
  read: boolean;
  egress: boolean;
  recipients: 'deepseek'[];
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}
export interface AiRunGrant extends RecordBoundary {
  kind: 'aiRunGrant';
  grantId: string;
  policyId: string;
  policyRevision: number;
  actorId: string;
  conversationId: string;
  allowedTools: ('notes_search' | 'notes_read')[];
  maxBudgetMicrounits: number;
  issuedAt: string;
  expiresAt: string;
}
export interface AiRequestManifest extends RecordBoundary {
  kind: 'aiRequestManifest';
  manifestId: string;
  grantId: string;
  policyId: string;
  policyRevision: number;
  recipient: 'deepseek';
  sources: import('./access-service-types.ts').SourceReference[];
  historySources: import('./access-service-types.ts').SourceReference[];
  excludedNoteIds: string[];
  omissions: string[];
  catalog?: {
    kind: 'folders' | 'notes';
    parentId?: string | null;
    folderId?: string | null;
    titleQuery?: string | null;
    recursive?: boolean;
    sortBy?: 'updated' | 'annotations';
    offset: number;
    limit: number;
    resultHash: string;
    noteIds?: string[];
    folderIds?: string[];
  }[];
  historyCatalog?: { noteIds: string[]; folderIds: string[] };
  estimatedInputTokens: number;
  payloadHash: string;
  createdAt: string;
}
export interface AccessRecordByKind {
  aiAccessPolicy: AiAccessPolicy;
  aiRunGrant: AiRunGrant;
  aiRequestManifest: AiRequestManifest;
}
export type AccessRecord = AccessRecordByKind[keyof AccessRecordByKind];
export interface ValidatedAccessState {
  accessPolicies: AiAccessPolicy[];
  runGrants: AiRunGrant[];
  requestManifests: AiRequestManifest[];
  datasetId: string;
  datasetEpoch: string;
}
export interface AiConversation extends RecordBoundary {
  kind: 'aiConversation';
  conversationId: string;
  actorId: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}
export interface AiConversationTurn extends RecordBoundary {
  executionStartedAt?: string;
  checkpoint?: ReturnType<typeof import('./agent-checkpoint.ts').emptyAgentCheckpoint>;
  kind: 'aiConversationTurn';
  turnId: string;
  conversationId: string;
  jobId: string;
  ordinal: number;
  idempotencyKey: string;
  inputHash: string;
  userMessageId: string;
  assistantMessageId: string | null;
  requestedPolicyId: string | null;
  writeIntent?: {
    toolName: 'notes_create' | 'notes_append' | 'notes_propose_patch' | 'notes_propose_organize';
    noteId?: string;
  };
  status: 'staged' | 'running' | 'interrupted' | 'succeeded' | 'failed' | 'cancelled';
  phase: 'waiting' | 'retrieving' | 'generating' | 'validating' | 'finished';
  leaseGeneration: number;
  leaseExpiresAt: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface AiConversationMessage extends RecordBoundary {
  kind: 'aiConversationMessage';
  messageId: string;
  conversationId: string;
  turnId: string;
  sequence: number;
  role: 'user' | 'assistant';
  content: string;
  sourceRefs: import('./access-service-types.ts').SourceReference[];
  citations?: import('./access-service-types.ts').SourceReference[];
  provenanceManifestId: string | null;
  sourceFree: boolean;
  finishReason: 'stop' | 'tool_calls' | null;
  createdAt: string;
}
export interface AiConversationToolCall extends RecordBoundary {
  kind: 'aiConversationToolCall';
  callId: string;
  conversationId: string;
  turnId: string;
  ordinal: number;
  toolName:
    | 'notes_search'
    | 'notes_read'
    | 'notes_create'
    | 'notes_append'
    | 'notes_propose_patch'
    | 'notes_propose_organize'
    | 'web_search'
    | 'annotations_list'
    | 'knowledge_propose'
    | 'folders_list'
    | 'notes_list';
  argumentsJson: object;
  resultJson: object | null;
  provenanceManifestId: string | null;
  status: 'requested' | 'succeeded' | 'failed';
  sourceRefs: import('./access-service-types.ts').SourceReference[];
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface AiConversationModelAttempt extends RecordBoundary {
  responseRejectedCode?: string | null;
  responseRejectedAt?: string;
  modelResult?: object;
  kind: 'aiConversationModelAttempt';
  attemptId: string;
  conversationId: string;
  turnId: string;
  ordinal: number;
  leaseGeneration: number;
  modelId: string;
  recipient: 'deepseek';
  payloadHash: string;
  manifestId: string | null;
  grantId: string | null;
  reservedMicrounits: number;
  actualMicrounits: number | null;
  status: 'prepared' | 'reserved' | 'sent' | 'settled' | 'unknown' | 'released';
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface AiConversationAttachment extends RecordBoundary {
  kind: 'aiConversationAttachment';
  attachmentId: string;
  conversationId: string;
  uploadKey: string;
  fileName: string;
  mimeType:
    | 'application/pdf'
    | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    | 'text/plain'
    | 'text/markdown'
    | 'image/png'
    | 'image/jpeg';
  size: number;
  sha256: string;
  storageStatus: 'pending' | 'ready' | 'missing' | 'removed';
  parseStatus: 'not_parsed' | 'failed';
  parserVersion: null;
  parsedTextHash: null;
  segments: [];
  imageMetadata: null;
  errorCode: string | null;
  revision: number;
  removedAt: string | null;
  cleanupStatus: 'none' | 'pending' | 'complete';
  createdAt: string;
  updatedAt: string;
}
export interface ConversationRecordByKind {
  aiConversation: AiConversation;
  aiConversationTurn: AiConversationTurn;
  aiConversationMessage: AiConversationMessage;
  aiConversationToolCall: AiConversationToolCall;
  aiConversationModelAttempt: AiConversationModelAttempt;
  aiConversationAttachment: AiConversationAttachment;
}
export type ConversationRecord = ConversationRecordByKind[keyof ConversationRecordByKind];
export interface ValidatedConversationState {
  conversations: AiConversation[];
  conversationTurns: AiConversationTurn[];
  conversationMessages: AiConversationMessage[];
  conversationToolCalls: AiConversationToolCall[];
  conversationModelAttempts: AiConversationModelAttempt[];
  conversationAttachments: AiConversationAttachment[];
}

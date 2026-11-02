import type { DatasetIdentity } from '../task-workspaces/repository-port.ts';

export type AiRecordKind = keyof AiRecordByKind;
export type AiScopeKind = 'empty' | 'selection' | 'heading' | 'note' | 'multiNote' | 'folder' | 'knowledgeItems';
export type AiAwaitable<Value> = Value | PromiseLike<Value>;
export interface AiRecordBoundary extends DatasetIdentity {
  ownerId: string;
  spaceId: string;
}
interface AiEnvelope<Kind extends AiRecordKind> {
  contractVersion: 1;
  kind: Kind;
}
export interface AiSourceRef {
  sourceId: string;
  noteId: string;
  noteVersionId: string;
  contentHash: string;
  start: number;
  end: number;
  quoteHash: string;
  characters: number;
  estimatedTokens: number;
}
export interface AiScopeSnapshot extends AiEnvelope<'scopeSnapshot'>, AiRecordBoundary {
  scopeSnapshotId: string;
  scopeKind: AiScopeKind;
  allowedSources: AiSourceRef[];
  allowedFolderIds: string[];
  excludedSourceIds: string[];
  scopeHash: string;
  createdAt: string;
}
export interface AiContextManifest extends AiEnvelope<'contextManifest'>, AiRecordBoundary {
  manifestId: string;
  scopeSnapshotId: string;
  scopeKind: AiScopeKind;
  scopeHash: string;
  recipient: 'deepseek';
  sources: AiSourceRef[];
  excludedSourceIds: string[];
  omissions: string[];
  attachmentIds: [];
  estimatedInputTokens: number;
  payloadHash: string;
  createdAt: string;
}
export interface AiGrant extends AiEnvelope<'aiGrant'>, AiRecordBoundary {
  grantId: string;
  actorId: string;
  entrypoint: 'assistant' | 'analysisScope' | 'trustedApproval';
  scopeSnapshotId: string;
  scopeHash: string;
  allowedTools: (
    | 'notes_search'
    | 'notes_read'
    | 'folders_list'
    | 'tags_list'
    | 'notes_create'
    | 'notes_append'
    | 'notes_propose_patch'
    | 'notes_propose_organize'
  )[];
  actionKinds: ('read' | 'create' | 'append' | 'patchProposal' | 'organizeProposal')[];
  maxTargets: number;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}
export interface AiAnswerResult {
  answer: string;
  citations: AiSourceRef[];
}
export interface AiJob extends AiEnvelope<'aiJob'>, AiRecordBoundary {
  jobId: string;
  requestId: string;
  parentJobId: string | null;
  grantId: string;
  jobKind: 'answer' | 'knowledgeExtraction' | 'noteActionPlan' | 'questionDraft' | 'gradingProposal';
  idempotencyKey: string;
  inputHash: string;
  manifestId: string;
  manifestHash: string;
  credentialRef: string;
  provider: 'deepseek';
  modelId: string;
  promptVersion: string;
  resultSchemaVersion: string;
  status: 'pending' | 'running' | 'retrying' | 'cancelling' | 'cancelled' | 'succeeded' | 'failed';
  phase: 'preparing' | 'retrieving' | 'generating' | 'validating' | 'committing' | 'finished';
  acceptedAttemptId: string | null;
  outputHash: string | null;
  question?: string;
  resultJson?: AiAnswerResult;
  createdAt: string;
  updatedAt: string;
}
export interface AiJobAttempt extends AiEnvelope<'aiJobAttempt'> {
  attemptId: string;
  jobId: string;
  ordinal: number;
  leaseGeneration: number;
  leaseOwner: string;
  leaseExpiresAt: string;
  providerRequestId: string | null;
  deliveryUncertain: boolean;
  status: 'leased' | 'sent' | 'validated' | 'rejected' | 'timedOut' | 'cancelled';
  startedAt: string;
  finishedAt: string | null;
}
export interface AiUsageRecord extends AiEnvelope<'aiUsageRecord'> {
  usageId: string;
  jobId: string;
  attemptId: string;
  beijingDay: string;
  currency: 'CNY';
  priceVersion: string;
  inputTokens: number | null;
  outputTokens: number | null;
  reservedMicrounits: number;
  actualMicrounits: number | null;
  usageUnknown: boolean;
  createdAt: string;
}
export interface AiRecordByKind {
  scopeSnapshot: AiScopeSnapshot;
  contextManifest: AiContextManifest;
  aiGrant: AiGrant;
  aiJob: AiJob;
  aiJobAttempt: AiJobAttempt;
  aiUsageRecord: AiUsageRecord;
}
export type AiRecord = AiRecordByKind[AiRecordKind];
export type AiMutableRecordKind = 'aiGrant' | 'aiJob' | 'aiJobAttempt';
export interface AiCollectionByKind {
  scopeSnapshot: 'scopeSnapshots';
  contextManifest: 'contextManifests';
  aiGrant: 'grants';
  aiJob: 'jobs';
  aiJobAttempt: 'attempts';
  aiUsageRecord: 'usageRecords';
}
export interface AiIdByKind {
  scopeSnapshot: 'scopeSnapshotId';
  contextManifest: 'manifestId';
  aiGrant: 'grantId';
  aiJob: 'jobId';
  aiJobAttempt: 'attemptId';
  aiUsageRecord: 'usageId';
}
export type AiRecordDefinitions = {
  [Kind in AiRecordKind]: { collection: AiCollectionByKind[Kind]; id: AiIdByKind[Kind] };
};
export type AiRecordCollections = {
  [Kind in AiRecordKind as AiCollectionByKind[Kind]]: AiRecordByKind[Kind][];
};
export type AiEventPayloadKey =
  | 'phase'
  | 'status'
  | 'attemptId'
  | 'usageId'
  | 'code'
  | 'deliveryUncertain'
  | 'stage'
  | 'priceVersion'
  | 'inputUpperBoundBytes'
  | 'maxOutputTokens'
  | 'sourceCount'
  | 'reservedMicrounits'
  | 'responseId'
  | 'finishReason'
  | 'inputTokens'
  | 'outputTokens'
  | 'usageUnknown'
  | 'actualMicrounits'
  | 'budgetDisposition'
  | 'httpStatus';
/** 校验器只约束允许键和 primitive 联合，没有逐键语义。 */
export type AiEventPayload = Partial<Record<AiEventPayloadKey, string | number | boolean>>;
/** 普通 SQL 读取只 JSON.parse payload，未执行 validateAiEvent。 */
export interface AiReadEvent {
  jobId: string;
  sequence: number;
  eventKind: string;
  safePayload: unknown;
  createdAt: string;
}
export interface AiEvent extends Omit<AiReadEvent, 'safePayload'> {
  safePayload: AiEventPayload;
}
/** 同时供同步 JSON/SQLite 和异步 PostgreSQL 的应用服务使用。 */
export interface AiRecordRepositoryPort {
  identity(): AiAwaitable<DatasetIdentity>;
  get<Kind extends AiRecordKind>(kind: Kind, id: string): AiAwaitable<AiRecordByKind[Kind] | null>;
  list<Kind extends AiRecordKind>(
    kind: Kind,
    filter?: Partial<AiRecordByKind[Kind]>
  ): AiAwaitable<AiRecordByKind[Kind][]>;
  insert<Kind extends AiRecordKind>(kind: Kind, input: AiRecordByKind[Kind]): AiAwaitable<AiRecordByKind[Kind]>;
  replace<Kind extends AiRecordKind>(
    kind: Kind,
    input: AiRecordByKind[Kind],
    expectedHash: string
  ): AiAwaitable<AiRecordByKind[Kind]>;
  appendEvent(input: AiEvent): AiAwaitable<AiEvent>;
  listEvents(jobId: string): AiAwaitable<AiReadEvent[]>;
  rotateEpoch(): AiAwaitable<string>;
}
export interface SyncAiRecordRepository extends AiRecordRepositoryPort {
  identity(): DatasetIdentity;
  get<Kind extends AiRecordKind>(kind: Kind, id: string): AiRecordByKind[Kind] | null;
  list<Kind extends AiRecordKind>(kind: Kind, filter?: Partial<AiRecordByKind[Kind]>): AiRecordByKind[Kind][];
  insert<Kind extends AiRecordKind>(kind: Kind, input: AiRecordByKind[Kind]): AiRecordByKind[Kind];
  replace<Kind extends AiRecordKind>(
    kind: Kind,
    input: AiRecordByKind[Kind],
    expectedHash: string
  ): AiRecordByKind[Kind];
  appendEvent(input: AiEvent): AiEvent;
  listEvents(jobId: string): AiReadEvent[];
  rotateEpoch(): string;
}
export interface AiRecordStorage extends Pick<
  SyncAiRecordRepository,
  'identity' | 'get' | 'listEvents' | 'rotateEpoch'
> {
  list<Kind extends AiRecordKind>(kind: Kind): AiRecordByKind[Kind][];
  insert<Kind extends AiRecordKind>(kind: Kind, record: AiRecordByKind[Kind]): void;
  replace<Kind extends AiRecordKind>(kind: Kind, record: AiRecordByKind[Kind]): void;
  insertEvent(event: AiEvent): void;
  transaction<Result>(operation: () => Result): Result;
}

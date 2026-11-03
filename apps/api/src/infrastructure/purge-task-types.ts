import type { AppError } from '../errors/app-error.ts';

// 仅列出清理核查读取的字段；schema/hash 仍由原有 AI/提炼校验器检查，不重建或过滤正文。
interface PurgeIdentity {
  ownerId: string;
  datasetId: string;
  datasetEpoch: string;
  spaceId: string;
}
export type PurgeComparisonField =
  | keyof PurgeIdentity
  | 'jobId'
  | 'inputHash'
  | 'createdAt'
  | 'scopeId'
  | 'executionMode'
  | 'requestId'
  | 'outputHash'
  | 'modelId'
  | 'promptVersion'
  | 'resultSchemaVersion';
export type PurgeComparable = Partial<Record<PurgeComparisonField, string | null>>;
interface SourceView {
  sourceId: string;
}
interface ScopeView extends PurgeIdentity {
  scopeSnapshotId: string;
  scopeKind: string;
  scopeHash: string;
  allowedSources: SourceView[];
  excludedSourceIds: string[];
}
interface ManifestView extends PurgeIdentity {
  manifestId: string;
  scopeSnapshotId: string;
  scopeKind: string;
  scopeHash: string;
  recipient: string;
  sources: SourceView[];
}
interface GrantView extends PurgeIdentity {
  grantId: string;
  scopeSnapshotId: string;
  scopeHash: string;
}
interface JobView extends PurgeIdentity {
  jobId: string;
  manifestId: string;
  grantId: string;
  manifestHash: string;
  jobKind: string;
  provider: string;
  credentialRef: string;
  status: string;
  phase: string;
  parentJobId: string | null;
  acceptedAttemptId: string | null;
  resultJson?: object;
  inputHash: string;
  outputHash: string | null;
  createdAt: string;
  requestId: string;
  modelId: string;
  promptVersion: string;
  resultSchemaVersion: string;
}
interface AttemptView {
  attemptId: string;
  jobId: string;
  ordinal: number;
  leaseGeneration: number;
}
interface UsageView {
  usageId: string;
  jobId: string;
  attemptId: string;
}
export type PurgeAiCollections = {
  scopeSnapshots: ScopeView[];
  contextManifests: ManifestView[];
  grants: GrantView[];
  jobs: JobView[];
  attempts: AttemptView[];
  usageRecords: UsageView[];
};
export type PurgeAiCollection = keyof PurgeAiCollections;
export type PurgeAiRecord = PurgeAiCollections[PurgeAiCollection][number];
export type PurgeAiId = 'scopeSnapshotId' | 'manifestId' | 'grantId' | 'jobId' | 'attemptId' | 'usageId';
export type PurgeAiKind = 'scopeSnapshot' | 'contextManifest' | 'aiGrant' | 'aiJob' | 'aiJobAttempt' | 'aiUsageRecord';
export interface PurgeExtractionTask extends PurgeIdentity {
  jobId: string;
  scopeId: string;
  inputHash: string;
  createdAt: string;
  executionMode: string;
}
export interface PurgeExtractionReceipt extends PurgeIdentity {
  jobId: string;
  scopeId: string;
  inputHash: string;
  requestId: string;
  outputHash: string;
  modelId: string;
  promptVersion: string;
  resultSchemaVersion: string;
  attemptId: string;
  executionMode: string;
  receiptHash: string;
}
export type PurgeExtension = PurgeExtractionTask | PurgeExtractionReceipt;
export type PurgeExtensionKind = 'tasks' | 'receipts';
export interface PurgeTaskState {
  ai: PurgeAiCollections;
  tasks: PurgeExtractionTask[];
  receipts: PurgeExtractionReceipt[];
}
export interface PurgeSqlDefinition {
  table: string;
  fields: string[];
  document?: string;
}
export type RawPurgeSqlRow = Record<string, unknown>;
interface PurgeSqliteStatement {
  all(): RawPurgeSqlRow[];
  get(parameter: string): RawPurgeSqlRow | undefined;
}
export interface PurgeSqliteDatabase {
  prepare(query: string): PurgeSqliteStatement;
}
export interface LocalPurgeTaskDataStore {
  getPurgeTaskState?: () => PurgeTaskState;
  readSync?<T>(operation: (db: PurgeSqliteDatabase) => T): T;
  aiRuntimeError?: Partial<AppError> | null;
  knowledgeExtractionTaskStoreError?: Partial<AppError> | null;
  knowledgeExtractionCommitStoreError?: Partial<AppError> | null;
}

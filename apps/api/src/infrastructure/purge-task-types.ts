import type { AppError } from '../errors/app-error.ts';
import type { AiIdByKind, AiRecordBoundary, AiRecordCollections, AiRecordKind } from '../modules/ai/record-types.ts';

// 核心记录复用 AI 校验契约；提炼扩展只列清理核查读取的字段，不重建或过滤正文。
type PurgeIdentity = AiRecordBoundary;
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
export type PurgeAiCollections = AiRecordCollections;
export type PurgeAiCollection = keyof PurgeAiCollections;
export type PurgeAiRecord = PurgeAiCollections[PurgeAiCollection][number];
export type PurgeAiId = AiIdByKind[AiRecordKind];
export type PurgeAiKind = AiRecordKind;
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

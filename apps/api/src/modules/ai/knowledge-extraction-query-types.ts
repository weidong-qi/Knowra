import type { AppError } from '../../errors/app-error.ts';
import type { DatasetIdentity } from '../task-workspaces/repository-port.ts';
import type { KnowledgeSpaceRecord } from '../knowledge/infrastructure/knowledge-space-repository.ts';
import type { NoteRecord } from '../knowledge/infrastructure/note-repository.ts';
import type { NoteVersionRecord } from '../knowledge/infrastructure/note-version-repository.ts';
import type { AnalysisScopeRecord } from '../knowledge/infrastructure/annotation-support-repositories.ts';

export type Awaitable<Value> = Value | PromiseLike<Value>;
export interface ExtractionPageRow {
  jobId: string;
  createdAt: string;
}
export interface ExtractionPage extends DatasetIdentity {
  ownerId: string;
  /** 原请求校验后仍重读这两个外部属性；不快照或转换可变化getter的后次原值。 */
  spaceId: unknown;
  idempotencyKey?: unknown;
  limit: number;
  before?: ExtractionPageRow;
}
export interface ExtractionPageJob extends ExtractionPageRow, DatasetIdentity {
  ownerId: string;
  spaceId: string;
  jobKind: string;
  idempotencyKey: string;
}
export interface ExtractionQueryJob extends ExtractionPageRow {
  spaceId: string;
  status: string;
  phase: string;
  updatedAt: string;
}
export interface ExtractionLoadedTask {
  job: ExtractionQueryJob;
  descriptor: { scopeId: string };
}
export interface ExtractionJobSummary extends ExtractionQueryJob {
  contractVersion: 1;
  kind: 'knowledgeExtraction';
  scopeId: string;
  executionMode: 'mock';
}
export interface ExtractionSafeError<Code = string> {
  code: Code | 'KNOWLEDGE_EXTRACTION_FAILED';
  message: string;
}
export interface ExtractionJobDetail extends ExtractionJobSummary {
  candidateIds: string[];
  error: ExtractionSafeError<unknown> | null;
  actions: {
    canCancel: boolean;
    canRetry: boolean;
    retryUnavailableReason: ExtractionSafeError<string | undefined> | null;
  };
}
export interface ExtractionJobPage {
  items: ExtractionJobSummary[];
  nextCursor: string | null;
}
export interface ExtractionQueryEvent {
  eventKind: string;
  /** PostgreSQL事件读取只JSON.parse；此字段未经过本地事件校验器。 */
  safePayload?: unknown;
}
interface ExtractionQueryAttempt {
  attemptId: string;
}
/** 遗留读取器在各自原校验点消费的数据库/持久化原始字段，不冒充完整 AI DTO。 */
type RawExtractionRecord = Record<string, unknown>;
type ExtractionReadValue =
  | DatasetIdentity
  | KnowledgeSpaceRecord
  | NoteRecord
  | NoteVersionRecord
  | AnalysisScopeRecord
  | RawExtractionRecord
  | ExtractionPageRow[]
  | ExtractionQueryAttempt[]
  | ExtractionQueryEvent[]
  | NoteRecord[]
  | null;
export type ExtractionQuerySteps<Result> = Generator<Awaitable<ExtractionReadValue>, Result, ExtractionReadValue>;
export interface ExtractionQueryContext<Transaction = object | undefined> {
  transaction: Transaction;
  aiRepository: {
    identity(): Awaitable<DatasetIdentity>;
    get(
      kind: 'aiJob' | 'aiGrant' | 'contextManifest' | 'scopeSnapshot',
      id: string
    ): Awaitable<RawExtractionRecord | null>;
    list(kind: 'aiJobAttempt', input: { jobId: string }): Awaitable<ExtractionQueryAttempt[]>;
    listEvents(jobId: string): Awaitable<ExtractionQueryEvent[]>;
  };
  repositories: {
    knowledgeSpaceRepository: { findById(id: unknown): Awaitable<KnowledgeSpaceRecord | null> };
    analysisScopeRepository: { findById(id: string): Awaitable<AnalysisScopeRecord | null> };
    noteRepository: {
      findById(id: string): Awaitable<NoteRecord | null>;
      findByIds?(ids: string[]): Awaitable<NoteRecord[]>;
    };
    noteVersionRepository: { findById(id: string): Awaitable<NoteVersionRecord | null> };
  };
}
export interface ExtractionQueryOptions<Transaction = object | undefined> {
  read<Result>(
    operation: (context: ExtractionQueryContext<Transaction>) => ExtractionQuerySteps<Result>,
    jobId?: string
  ): Promise<Result>;
  load(context: ExtractionQueryContext<Transaction>, jobId: string): ExtractionQuerySteps<ExtractionLoadedTask>;
  view(context: ExtractionQueryContext<Transaction>, jobId: string): ExtractionQuerySteps<{ candidateIds: string[] }>;
  store: { listPage?(input: ExtractionPage, transaction: Transaction): Awaitable<ExtractionPageRow[]> };
  ownerId: string;
  clock(): Date;
  canUse(): boolean;
}
export interface ExtractionHttpTasks {
  ready(): Promise<boolean>;
  recover(): Promise<number>;
  list(input: unknown): Promise<ExtractionJobPage>;
  inspect(jobId: string): Promise<ExtractionJobDetail>;
  start(input: unknown): Promise<{ jobId: string }>;
  cancel(jobId: string): Promise<{ jobId: string }>;
  retry(jobId: string): Promise<{ jobId: string }>;
}
export interface ExtractionHttpOptions {
  tasks?: ExtractionHttpTasks | null;
  location?: string;
  enabled?: () => boolean;
  logger?: { warn?(message: string, detail: { code: string }): void };
}
/** 捕获值的 code 尚未校验；保留原 AppError 实例与其未经转换的 code 原值。 */
export type RawExtractionHttpError = Omit<AppError, 'code'> & { code: unknown };

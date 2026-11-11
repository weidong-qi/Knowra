import type { ExtractionTaskDescriptor } from './knowledge-extraction-task-types.ts';
import type { KnowledgeExtractionCommitReceipt } from './knowledge-extraction-commit-types.ts';
import type { AppError } from '../../errors/app-error.ts';
import type { DatasetIdentity } from '../task-workspaces/repository-port.ts';
import type { KnowledgeSpaceRecord } from '../knowledge/infrastructure/knowledge-space-repository.ts';
import type { NoteRecord } from '../knowledge/infrastructure/note-repository.ts';
import type { NoteVersionRecord } from '../knowledge/infrastructure/note-version-repository.ts';
import type { AnalysisScopeRecord } from '../knowledge/infrastructure/annotation-support-repositories.ts';
import type { AiJob, AiRecord, AiRecordRepositoryPort, AiReadEvent } from './record-types.ts';

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
export type ExtractionPageJob = Pick<
  AiJob,
  'jobId' | 'createdAt' | 'datasetId' | 'datasetEpoch' | 'ownerId' | 'spaceId' | 'jobKind' | 'idempotencyKey'
>;
export type ExtractionQueryJob = Pick<AiJob, 'jobId' | 'createdAt' | 'spaceId' | 'status' | 'phase' | 'updatedAt'>;
export interface ExtractionLoadedTask {
  job: AiJob;
  descriptor: ExtractionTaskDescriptor;
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
export type ExtractionQueryEvent = Pick<AiReadEvent, 'eventKind' | 'safePayload'>;
interface ExtractionQueryAttempt {
  attemptId: string;
}
/** 遗留读取器在各自原校验点消费的数据库/持久化原始字段，不冒充完整 AI DTO。 */
type RawExtractionRecord = Record<string, unknown>;
type ExtractionReadValue =
  | DatasetIdentity
  | ExtractionTaskDescriptor
  | ExtractionTaskDescriptor[]
  | KnowledgeExtractionCommitReceipt
  | AiReadEvent
  | number
  | void
  | KnowledgeSpaceRecord
  | NoteRecord
  | NoteVersionRecord
  | AnalysisScopeRecord
  | AiRecord
  | AiRecord[]
  | RawExtractionRecord
  | ExtractionPageRow[]
  | ExtractionQueryAttempt[]
  | ExtractionQueryEvent[]
  | NoteRecord[]
  | null;
export type ExtractionQuerySteps<Result> = Generator<Awaitable<ExtractionReadValue>, Result, ExtractionReadValue>;
export interface ExtractionQueryContext<Transaction = object | undefined> {
  transaction: Transaction;
  aiRepository: Pick<AiRecordRepositoryPort, 'identity' | 'get' | 'list' | 'listEvents'>;
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
export interface ExtractionQueryOptions<
  Transaction = object | undefined,
  Context extends ExtractionQueryContext<Transaction> = ExtractionQueryContext<Transaction>
> {
  read<Result>(operation: (context: Context) => ExtractionQuerySteps<Result>, jobId?: string): Promise<Result>;
  load(context: Context, jobId: string): ExtractionQuerySteps<ExtractionLoadedTask>;
  view(context: Context, jobId: string): ExtractionQuerySteps<{ candidateIds: string[] }>;
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

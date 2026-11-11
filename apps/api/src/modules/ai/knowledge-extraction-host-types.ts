import type { createMaintenanceGate } from '../../infrastructure/maintenance-gate.ts';
import type { DatasetIdentity } from '../task-workspaces/repository-port.ts';
import type { AiRecordRepositoryPort } from './record-types.ts';
import type { AiSqlClient, AiSqlTransaction } from './record-infrastructure-types.ts';
import type { ExtractionTaskDescriptor, ExtractionMockGateway } from './knowledge-extraction-task-types.ts';
import type { KnowledgeExtractionCommitReceipt } from './knowledge-extraction-commit-types.ts';
import type { ExtractionMockWorkerOptions } from './knowledge-extraction-mock-worker.ts';
import type {
  ExtractionQueryContext,
  ExtractionQuerySteps,
  ExtractionPage,
  ExtractionPageRow
} from './knowledge-extraction-query-types.ts';

export interface ExtractionTaskContext<Transaction> extends ExtractionQueryContext<Transaction> {
  aiRepository: Pick<
    AiRecordRepositoryPort,
    'identity' | 'get' | 'list' | 'listEvents' | 'insert' | 'replace' | 'appendEvent'
  >;
}
export interface ExtractionTaskStore<Transaction> {
  supportsAsync: boolean;
  runTransaction<Result>(
    operation: (tx: Transaction) => Result | PromiseLike<Result>,
    input: { jobId?: string }
  ): Result | PromiseLike<Result>;
  get(
    input: DatasetIdentity & { ownerId: string; jobId: string },
    tx: Transaction
  ): ExtractionTaskDescriptor | null | PromiseLike<ExtractionTaskDescriptor | null>;
  list(
    input: DatasetIdentity & { ownerId: string },
    tx: Transaction
  ): ExtractionTaskDescriptor[] | PromiseLike<ExtractionTaskDescriptor[]>;
  listPage?(input: ExtractionPage, tx: Transaction): ExtractionPageRow[] | PromiseLike<ExtractionPageRow[]>;
  insert(input: ExtractionTaskDescriptor, tx: Transaction): void | number | PromiseLike<void | number>;
}
export interface ExtractionTaskLifecycleOptions<Transaction> {
  store: Pick<ExtractionTaskStore<Transaction>, 'get' | 'list'>;
  ownerId: string;
  clock(): Date;
  workerId: string;
}
export type ExtractionCommitInput = Parameters<
  ExtractionMockWorkerOptions<KnowledgeExtractionCommitReceipt, void>['accept']
>[0];
export interface ExtractionTaskServiceOptions<Transaction> extends Omit<
  ExtractionTaskLifecycleOptions<Transaction>,
  'clock' | 'workerId'
> {
  clock?: () => Date;
  workerId?: string;
  store: ExtractionTaskStore<Transaction>;
  createContext(tx: Transaction): ExtractionTaskContext<Transaction>;
  commit: {
    commit(
      input: ExtractionCommitInput
    ): KnowledgeExtractionCommitReceipt | PromiseLike<KnowledgeExtractionCommitReceipt>;
  };
  receiptStore: {
    get(
      input: DatasetIdentity & { ownerId: string; jobId: string },
      tx: Transaction
    ): KnowledgeExtractionCommitReceipt | null | PromiseLike<KnowledgeExtractionCommitReceipt | null>;
  };
  gateway: ExtractionMockGateway;
  maintenanceGate?: Pick<ReturnType<typeof createMaintenanceGate>, 'runMutation' | 'runOperation' | 'getState'> | null;
  schedule?: ExtractionMockWorkerOptions<KnowledgeExtractionCommitReceipt, void>['schedule'];
  logger?: ExtractionMockWorkerOptions<KnowledgeExtractionCommitReceipt, void>['logger'];
}
export type ExtractionTaskOperation<Transaction, Result> = (
  context: ExtractionTaskContext<Transaction>
) => ExtractionQuerySteps<Result>;
export interface PostgresExtractionStoreOptions {
  client: AiSqlClient;
  ownerId: string;
}
export interface ExtractionSqlTransaction extends AiSqlTransaction {
  $queryRawUnsafe<Result = Record<string, unknown>[]>(sql: string, ...values: unknown[]): Promise<Result>;
}

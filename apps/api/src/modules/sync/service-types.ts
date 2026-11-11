import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Prisma } from '@prisma/client';
import type { Note } from '../knowledge/domain/note.ts';
import type { SyncContract, SyncSnapshotBinding } from './protocol-contract.ts';
import type { SyncEntry, SyncJournal, SyncReceiptResult, SyncSnapshot } from './journal.ts';
import type {
  SyncAwaitable,
  SyncBackend,
  SyncBatchProvider,
  SyncProviderState,
  SyncNoteMutationResult,
  SyncNoteOperation
} from './domain-types.ts';

export interface SyncPushRequest extends SyncNoteOperation {
  protocolVersion: 1;
  deviceId: string;
  operationId: string;
  datasetEpoch: string;
  baseRevision: number | null;
}
export interface SyncRawPushRequest {
  protocolVersion?: unknown;
  deviceId?: unknown;
  operationId?: unknown;
  datasetEpoch?: unknown;
  noteId?: unknown;
  baseRevision?: unknown;
  value?: { [field: string]: unknown } | null;
}
export type SyncPushHandler = (input: unknown) => SyncAwaitable<SyncReceiptResult>;
export type SyncReleaseHandler = (input: unknown) => SyncAwaitable<{ released: boolean }>;
export interface SyncPageQuery {
  snapshotId?: string;
  offset?: string | number;
  limit?: string | number;
  cursor?: string;
  deviceId?: string;
  operationId?: string;
  recoveryId?: string;
  datasetEpoch?: string;
  requestHash?: string;
  entitySchemaVersion?: string | number;
  capabilities?: string | string[];
}
export interface SyncSnapshotPage extends Omit<SyncSnapshotBinding, 'datasetEpoch'> {
  datasetEpoch: string | null;
  entries: SyncEntry[] | Prisma.JsonValue[] | null;
  nextOffset: number | null;
}
export interface SyncSnapshotRequest {
  snapshotId: string;
  start: number;
  size: number;
  contract: SyncContract;
  ownerId: string;
}
export interface SyncNoteProvider<Backend extends SyncBackend = 'local'> extends SyncBatchProvider<Backend> {
  snapshotEntries?: (
    state: SyncProviderState<Backend>,
    journal: SyncJournal
  ) => {
    entries?: SyncEntry[];
    entriesEncoding?: string;
    entryPageSize?: number;
    entryPages?: string[];
    count: number;
  };
  readSnapshotEntries?: (snapshot: SyncSnapshot, start: number, end: number) => SyncEntry[];
  snapshotPage?: (request: SyncSnapshotRequest) => SyncAwaitable<SyncSnapshotPage>;
  applyNote(
    operation: SyncNoteOperation,
    current: Pick<Note, 'deleted'> | null
  ): SyncAwaitable<SyncNoteMutationResult | void>;
}
/** HTTP 边界保留原始请求；各方法沿现有校验流程解释载荷。 */
export interface SyncHttpService {
  device(input: SyncPageQuery): SyncAwaitable<object>;
  status(): SyncAwaitable<object>;
  bootstrap(input: unknown): SyncAwaitable<object>;
  operationReceipt(input: SyncPageQuery): SyncAwaitable<object>;
  deviceRetirement(input: SyncPageQuery): SyncAwaitable<object>;
  retireDevice(input: unknown): SyncAwaitable<object>;
  snapshot(input: SyncPageQuery): SyncAwaitable<object>;
  releaseSnapshot(input: unknown): SyncAwaitable<object>;
  changes(input: SyncPageQuery): SyncAwaitable<object>;
  pushBatch(input: unknown): SyncAwaitable<SyncReceiptResult>;
  uploadBlob(input: unknown): SyncAwaitable<object>;
  uploadBlobStream(input: unknown): SyncAwaitable<object>;
  push(input: unknown): SyncAwaitable<SyncReceiptResult>;
}
export interface SyncRouteDependencies {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  sync?: SyncHttpService | null;
}

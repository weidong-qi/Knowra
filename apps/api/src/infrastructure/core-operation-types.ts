export type CoreOperationKind =
  | 'notes_create'
  | 'notes_append'
  | 'notes_propose_patch'
  | 'notes_propose_organize'
  | 'notes_undo'
  | 'knowledge_propose';
export interface CoreOperationLookup {
  ownerId: string;
  datasetId: string;
  operationId: string;
}
export interface CoreOperationInput extends CoreOperationLookup {
  datasetEpoch: string;
  actorId: string;
  spaceId: string;
  requestId: string;
  kind: CoreOperationKind;
  planHash: string;
}
export interface CoreOperationChange {
  noteId: string;
  beforeVersionId: string | null;
  afterVersionId: string;
  contentHash: string;
  metadataBefore: { title: string; folderId: string | null; tagIds: string[] } | null;
}
export interface CoreNoteResult {
  saveState: 'localCommitted';
  changes: CoreOperationChange[];
}
export interface CoreKnowledgeResult {
  saveState: 'localCommitted';
  candidates: { candidateId: string; provenanceId: string }[];
}
export type CoreOperationResult = CoreNoteResult | CoreKnowledgeResult;
export type CoreOperationReceipt = CoreOperationInput & {
  schemaVersion: 1;
  status: 'applied';
  appliedAt: string;
  result: CoreOperationResult;
  receiptHash: string;
};
export interface CoreOperationState {
  version: 1;
  receipts: CoreOperationReceipt[];
}

export interface SyncCoreOperationStoreDependencies {
  transaction<T>(operation: () => T): T;
  get(input: CoreOperationLookup): CoreOperationReceipt | null | undefined;
  insert(receipt: CoreOperationReceipt): void;
}
export interface AsyncCoreOperationStoreDependencies<Transaction extends object> {
  transaction<T>(operation: (tx: Transaction) => Promise<T>): Promise<T>;
  get(input: CoreOperationLookup, tx?: Transaction): Promise<CoreOperationReceipt | null | undefined>;
  insert(receipt: CoreOperationReceipt, tx: Transaction): Promise<void>;
}
/** 数据库返回的原始列；JSON 文档仍须通过既有回执校验。 */
export interface CoreOperationSqlRow extends Record<string, unknown> {
  owner_id: string;
  dataset_id: string;
  operation_id: string;
  plan_hash: unknown;
  receipt_hash: unknown;
  receipt_json: unknown;
}
export interface QuerySqlPort {
  $queryRawUnsafe(query: string, ...parameters: string[]): Promise<Record<string, unknown>[]>;
}
export interface CoreOperationSqlTransaction extends QuerySqlPort {
  $executeRawUnsafe(query: string, ...parameters: string[]): Promise<unknown>;
}

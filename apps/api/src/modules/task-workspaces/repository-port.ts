/**
 * 固定同步仓储端口（本地 JSON / SQLite 共用）。
 * store.available: boolean
 * store.readSnapshot(callback): callback(tx) 的同步返回值，只读快照。
 * store.runTransaction(callback, {beforeCommit}?): 同步、原子事务；回调抛错必须回滚。
 * beforeCommit 在最后持久提交点调用（SQLite COMMIT / JSON atomic rename 前），Promise/false 必须拒绝。
 * tx仅在readSnapshot/runTransaction同步作用域存活，退出后全部方法失效。
 * tx.identity(): { datasetId:string, datasetEpoch:string }
 * tx.get(collection,id): 深拷贝记录或 null
 * tx.list(collection): 深拷贝记录数组
 * tx.insert(collection,record): 唯一 id；重复时抛 CONFLICT
 * tx.replace(collection,record,expectedRevision?): 不存在或 CAS 不符抛 CONFLICT
 * collections 固定为 workspaces/documents/tasks/attempts/receipts。
 * 所有记录均携带 datasetId/datasetEpoch（不外发）。receipt.id 由服务生成唯一键。
 * 事务禁止 Promise、文件/网络 IO；提交前 guard/authorize 由 service 执行。
 * files 可选独立端口：stage({workspaceId,documentId,attachmentId,fileName,mimeType,bytes})
 *   => {metadata:{fileName,mimeType,size,sha256,storageKey,...}, commit(), discard()}
 * files.read(attachment) => {bytes,mimeType,width,height}，必须核验 hash/大小/像素。
 * stage 在事务前完成所有验证和最终受管文件安置；commit 仅标记成功，discard 清理。
 */
import type {
  Actor,
  AttemptDTO,
  DocumentDTO,
  DocumentReference,
  MutationResult,
  RequirementRevision,
  Review,
  TaskEvent,
  TaskSummary,
  UploadAttachmentResult,
  Workspace,
  WorkspaceAttachment
} from '../../../../../packages/web-core/src/task-workspaces/types.ts';

export interface DatasetIdentity {
  datasetId: string;
  datasetEpoch: string;
}
export interface WorkspaceRecord extends DatasetIdentity, Workspace {}
export interface AttachmentRecord extends WorkspaceAttachment {
  storageKey: string;
  width?: number;
  height?: number;
}
export type DocumentVersion = DocumentDTO['version'] & { markdown: string };
export interface DocumentRecord extends DatasetIdentity {
  id: string;
  workspaceId: string;
  title: string;
  revision: number;
  currentVersionId: string;
  versions: DocumentVersion[];
  attachments: AttachmentRecord[];
  createdAt: string;
  updatedAt: string;
}
export type EventData = Partial<Record<'requirementId' | 'reviewId' | 'submissionId' | 'attemptId', string>> & {
  generation?: number;
};
export interface TaskRecord
  extends
    DatasetIdentity,
    Pick<
      TaskSummary,
      'id' | 'workspaceId' | 'title' | 'status' | 'revision' | 'currentRequirementId' | 'activeAttemptId' | 'updatedAt'
    > {
  requirements: RequirementRevision[];
  reviews: Review[];
  events: (Omit<TaskEvent, 'data'> & { data: EventData })[];
  createdAt: string;
}
export interface AttemptRecord extends DatasetIdentity, AttemptDTO {}
export interface MutationData extends Partial<UploadAttachmentResult> {
  workspace?: Workspace;
  document?: DocumentDTO;
  task?: TaskSummary;
  attempt?: AttemptDTO | null;
  review?: Review;
}
export interface ReceiptRecord extends DatasetIdentity {
  id: string;
  operationId: string;
  actor: Actor;
  workspaceId: string;
  kind: string;
  requestHash: string;
  result: MutationData;
  createdAt: string;
}
export interface TaskWorkspaceRecords {
  workspaces: WorkspaceRecord;
  documents: DocumentRecord;
  tasks: TaskRecord;
  attempts: AttemptRecord;
  receipts: ReceiptRecord;
}
export type Collection = keyof TaskWorkspaceRecords;
export type TaskWorkspaceSnapshot = DatasetIdentity & { version: number } & {
  [K in Collection]: TaskWorkspaceRecords[K][];
};
export const TASK_WORKSPACE_COLLECTIONS: readonly Collection[] = Object.freeze([
  'workspaces',
  'documents',
  'tasks',
  'attempts',
  'receipts'
]);
export interface TaskWorkspaceTransaction {
  identity(): DatasetIdentity;
  get<K extends Collection>(collection: K, id: string): TaskWorkspaceRecords[K] | null;
  list<K extends Collection>(collection: K): TaskWorkspaceRecords[K][];
  insert<K extends Collection>(collection: K, record: TaskWorkspaceRecords[K]): void;
  replace<K extends Collection>(collection: K, record: TaskWorkspaceRecords[K], expectedRevision?: number): void;
}
export interface TaskWorkspaceStore {
  available?: boolean;
  readSnapshot<T>(callback: (tx: TaskWorkspaceTransaction) => T): T;
  runTransaction<T>(callback: (tx: TaskWorkspaceTransaction) => T, options?: { beforeCommit?: () => void }): T;
}
export type GuardResult = boolean | void | PromiseLike<boolean | void>;
export interface TaskWorkspaceContext {
  datasetId?: string | null;
  datasetEpoch?: string | null;
  actor: Actor;
  guard?: () => GuardResult;
  authorizationRevision?: string | number;
}
export type AuthorizeTaskWorkspace = (
  ctx: TaskWorkspaceContext,
  scope: { action: string; workspaceId: string | null },
  tx: TaskWorkspaceTransaction
) => GuardResult;
export interface TaskWorkspaceQuery {
  workspaceId?: string;
  documentId?: string;
  taskId?: string;
  versionId?: string;
  attachmentId?: string;
  limit?: number;
  cursor?: string;
  status?: string;
  start?: number;
  afterSequence?: number;
}
export interface TaskWorkspaceMutation extends TaskWorkspaceQuery {
  operationId: string;
  expectedRevision?: number;
  name?: string;
  description?: string | DocumentReference;
  title?: string;
  markdown?: string;
  acceptanceCriteria?: string[];
  inScope?: string;
  outOfScope?: string;
  submissionId?: string;
  decision?: 'accepted' | 'returned';
  comment?: string;
  attemptId?: string;
  generation?: number;
  message?: string;
  summary?: string;
  artifacts?: DocumentReference[];
}
export interface UploadAttachmentInput {
  operationId: string;
  workspaceId: string;
  documentId: string;
  expectedRevision: number;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}
export interface TaskWorkspaceFiles {
  stage(input: UploadAttachmentInput & { attachmentId: string }): Promise<{
    metadata: Omit<AttachmentRecord, 'id' | 'documentId' | 'status' | 'createdAt'>;
    commit(): void;
    discard(): void | Promise<void>;
  }>;
  read(attachment: AttachmentRecord): Promise<{ bytes: Uint8Array; mimeType: string; width: number; height: number }>;
}
export interface TransactionHelpers {
  now: number;
  iso: string;
  id(): string;
  bound(): DatasetIdentity;
  entity<K extends Collection>(
    collection: K,
    id: string | null | undefined,
    workspaceId?: string
  ): TaskWorkspaceRecords[K];
  liveWorkspace(id: string | undefined): WorkspaceRecord;
  versionRef(
    ref: DocumentReference | string | undefined,
    workspaceId: string
  ): { document: DocumentRecord; version: DocumentVersion };
  event(task: TaskRecord, type: string, data?: EventData): void;
  save<K extends 'workspaces' | 'documents' | 'tasks'>(collection: K, row: TaskWorkspaceRecords[K]): void;
}
export interface TaskWorkspaceTransactions {
  read<T>(
    ctx: TaskWorkspaceContext,
    action: string,
    input: TaskWorkspaceQuery,
    fn: (tx: TaskWorkspaceTransaction, helpers: TransactionHelpers) => T
  ): T;
  mutate<T extends MutationData>(
    ctx: TaskWorkspaceContext,
    kind: string,
    input: TaskWorkspaceMutation,
    operation: (tx: TaskWorkspaceTransaction, helpers: TransactionHelpers) => T,
    onCommitted?: (result: MutationResult<T>) => void
  ): MutationResult<T>;
}

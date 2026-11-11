import type { DatasetIdentity } from '../task-workspaces/repository-port.ts';
import type { AiSqlError } from './record-infrastructure-types.ts';
import type { BudgetLimits, BudgetSettlement } from './boundary-types.ts';
export type { AiSqlError, BudgetLimits, BudgetSettlement };
export type StoreSqlValue = string | number | bigint | null | undefined;
export interface PrivateSqlTransaction {
  $queryRawUnsafe<Result = Record<string, unknown>[]>(sql: string, ...values: StoreSqlValue[]): Promise<Result>;
  $executeRawUnsafe(sql: string, ...values: StoreSqlValue[]): Promise<number>;
}
export interface PrivateSqlClient extends PrivateSqlTransaction {
  $transaction<Result>(
    operation: (db: PrivateSqlTransaction) => Promise<Result>,
    options?: {
      isolationLevel: 'Serializable' | 'ReadCommitted';
      maxWait: number;
      timeout: number;
    }
  ): Promise<Result>;
}
export interface PrivateStoreOptions {
  client: PrivateSqlClient;
  repository: { identity(): DatasetIdentity | Promise<DatasetIdentity> };
  ownerId: string;
}
/** 存储适配器只传递完整状态；动作与草稿内容由动作账本负责校验。 */
export interface ActionState {
  version: number;
  actions: object[];
  drafts: object[];
}
export type AccessKind = 'aiAccessPolicy' | 'aiRunGrant' | 'aiRequestManifest';
/** 此视图仅描述持久适配器核对的索引；校验器保留记录的其余字段。 */
export interface AccessIndexRecord extends DatasetIdentity {
  ownerId: string;
  spaceId: string;
  policyId?: string;
  grantId?: string;
  manifestId?: string;
  revision?: number;
}
export interface AccessSqlRow {
  policy_id?: string;
  grant_id?: string;
  manifest_id?: string;
  owner_id: string;
  dataset_id: string;
  dataset_epoch: string;
  space_id: string;
  revision?: number;
  record_json: string;
  record_hash: string;
}
export type ConversationKind =
  | 'aiConversation'
  | 'aiConversationTurn'
  | 'aiConversationMessage'
  | 'aiConversationToolCall'
  | 'aiConversationModelAttempt'
  | 'aiConversationAttachment';
export type ConversationCollection =
  | 'conversations'
  | 'conversationTurns'
  | 'conversationMessages'
  | 'conversationToolCalls'
  | 'conversationModelAttempts'
  | 'conversationAttachments';
export interface ConversationIndexRecord extends DatasetIdentity {
  ownerId: string;
  spaceId: string;
  conversationId?: string;
  turnId?: string;
  messageId?: string;
  callId?: string;
  attemptId?: string;
  attachmentId?: string;
}
export type ConversationState = Record<ConversationCollection, ConversationIndexRecord[]>;
export interface ConversationSqlRow {
  kind: ConversationKind;
  record_id: string;
  owner_id: string;
  dataset_id: string;
  dataset_epoch: string;
  space_id: string;
  record_json: string;
  record_hash: string;
}
export interface BudgetDayRow {
  account_ref: string;
  beijing_day: string;
  spent_microunits: string | number | bigint;
  held_microunits: string | number | bigint;
}
export interface BudgetReservationRow {
  reservation_id: string;
  account_ref: string;
  beijing_day: string;
  job_id: string;
  attempt_id: string;
  price_version: string;
  reserved_microunits: string | number | bigint;
  actual_microunits: string | number | bigint | null;
  status: string;
  created_at: string;
  settled_at: string | null;
  usage_detail?: string | null;
}
export interface BudgetReservation {
  reservationId: string;
  accountRef: string;
  day: string;
  jobId: string;
  attemptId: string;
  priceVersion: string;
  reservedMicrounits: number;
  actualMicrounits: number | null;
  status: string;
  createdAt: string;
  settledAt: string | null;
  usage?: object | null;
}
export interface BudgetState {
  budgetDays: {
    accountRef: string;
    day: string;
    spentMicrounits: number;
    heldMicrounits: number;
    archivedSpentMicrounits?: number;
  }[];
  budgetMonths?: BudgetMonth[];
  budgetReservations: BudgetReservation[];
}
export interface BudgetReserveInput {
  accountRef: string;
  jobId: string;
  attemptId: string;
  priceVersion: string;
  reservedMicrounits: number;
  limits?: BudgetLimits;
}

export interface BudgetMonth {
  accountRef: string;
  month: string;
  requests: number;
  spentMicrounits: number;
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens: number;
}

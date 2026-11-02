import type { AppError } from '../../errors/app-error.ts';
import type { DatasetIdentity } from '../task-workspaces/repository-port.ts';
import type { AiReadEvent, AiRecord, AiRecordCollections } from './record-types.ts';

export type AiRecordFields = {
  [Key in AiRecord extends infer Row ? (Row extends AiRecord ? keyof Row : never) : never]?: AiRecord extends infer Row
    ? Row extends AiRecord
      ? Key extends keyof Row
        ? Row[Key]
        : never
      : never
    : never;
};
/** 只描述本状态模块使用的侧域视图，其余字段由各自校验器处理。 */
export type AiAccessCollections = {
  accessPolicies: { policyId: string }[];
  runGrants: { grantId: string }[];
  requestManifests: { manifestId: string }[];
};
export type AiConversationCollections = {
  conversations: object[];
  conversationTurns: object[];
  conversationMessages: object[];
  conversationToolCalls: object[];
  conversationModelAttempts: object[];
  conversationAttachments: object[];
};
export interface AiPrivateState
  extends AiRecordCollections, AiAccessCollections, AiConversationCollections, DatasetIdentity {
  version: number;
  actionLedger: { version: 1 | 2; actions: object[]; drafts: object[] };
  events: AiReadEvent[];
  budgetDays: object[];
  budgetReservations: object[];
  budgetMonths: object[];
}
export interface JsonAiRepositoryOptions {
  getState(): AiRecordCollections & DatasetIdentity & { events: AiReadEvent[] };
  runTransaction<Result>(operation: () => Result): Result;
  onChange(): void;
}
export type RawAiSqlRow = Record<string, unknown>;
export type AiSqlValue = string | number | null;
export type AiSqlRow = Record<string, AiSqlValue>;
export interface AiSqlDefinition {
  table: string;
  id: string;
  document?: string;
  fields: (keyof AiRecordFields)[];
}
export interface AiSqlTransaction {
  $queryRawUnsafe<Result = RawAiSqlRow[]>(sql: string, ...values: AiSqlValue[]): Promise<Result>;
  $executeRawUnsafe(sql: string, ...values: AiSqlValue[]): Promise<number>;
}
export interface AiSqlClient extends AiSqlTransaction {
  $transaction<Result>(
    operation: (db: AiSqlTransaction) => Promise<Result>,
    options?: { isolationLevel: 'Serializable'; maxWait: number; timeout: number }
  ): Promise<Result>;
}
export interface PostgresAiRepositoryOptions {
  client: AiSqlClient;
  ownerId: string;
}
export interface AiSqlEpochRow {
  dataset_id: string;
  dataset_epoch: string;
}
export interface AiSqlEventRow {
  job_id: string;
  sequence: number;
  event_kind: string;
  safe_payload_json: string;
  created_at: string;
}
export type AiSqlError = Omit<Partial<AppError>, 'code'> & { code?: unknown; meta?: { code?: unknown } };

import type { DatasetIdentity } from '../task-workspaces/repository-port.ts';
import type { CoreOperationReceipt } from '../../infrastructure/core-operation-types.ts';
import type { NotePlanItem, ActionReference } from './note-plan-types.ts';
import type { SourceReference } from './access-service-types.ts';
export interface ActionIdentity extends DatasetIdentity {
  ownerId: string;
  actorId: string;
  spaceId: string;
  requestId: string;
  operationId: string;
}
export interface ActionPlan extends ActionIdentity {
  schemaVersion: number;
  toolVersion: number;
  toolName: string;
  items: (NotePlanItem & { softDelete?: boolean })[];
  references: ActionReference[];
  provenance: object | null;
  approvalMode: string;
  planHash: string;
}
export interface AssistantMessageSource {
  sourceKind: 'assistantMessage';
  conversationId: string;
  messageId: string;
  turnId: string;
  originGeneration: number;
  contentHash: string;
  sourceFree: boolean;
  sourceRefs: SourceReference[];
  provenanceManifestId: string | null;
  manifestHash: string | null;
  policyId: string | null;
  policyRevision: number | null;
}
export interface ActionGrant extends ActionIdentity {
  requestHash: string;
  toolName: string;
  targetIds: string[];
  expiresAt: string;
  revoked: boolean;
  originTurnId?: string;
  originGeneration?: number;
  autonomousOrigin?: true;
  policyId?: string | null;
  policyRevision?: number | null;
  catalogDeps?: { noteIds: string[]; folderIds: string[] };
  sourceRefs?: SourceReference[];
}
export interface ActionInboxEvent {
  kind: 'revise' | 'repreview';
  requestId: string;
  inputHash: string;
  createdAt: string;
  previousPlan: ActionPlan;
  resultPlanHash: string;
  originTurnId?: string;
  originGeneration?: number;
}
export interface ActionRecord extends ActionIdentity {
  actionId: string;
  inputHash: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  plan: ActionPlan;
  grant: ActionGrant;
  approval?: { planHash: string; actorId: string; expiresAt: string } | null;
  receipt?: CoreOperationReceipt | null;
  inboxEvents?: ActionInboxEvent[];
  errorCode?: string | null;
  source?: AssistantMessageSource;
}
export interface DraftLease extends DatasetIdentity {
  ownerId: string;
  noteId: string;
  clientId: string;
  dirty: boolean;
  leaseExpiresAt: string;
}
export interface ActionState {
  version: number;
  actions: ActionRecord[];
  drafts: DraftLease[];
}
export type MaybePromise<Result> = Result | Promise<Result>;
export interface ActionAdapter {
  transaction<Result>(operation: () => Result): MaybePromise<Result>;
  identity(): MaybePromise<DatasetIdentity>;
  read(): MaybePromise<ActionState>;
  write<Result>(
    operation: (state: ActionState, identity: DatasetIdentity) => { state: ActionState; result: Result }
  ): MaybePromise<Result>;
}
export interface ActionStore extends Omit<ActionAdapter, 'write'> {
  read(): MaybePromise<ActionState>;
  write<Result>(operation: (state: ActionState, identity: DatasetIdentity) => Result): MaybePromise<Result>;
}
export interface JsonActionOptions {
  getState(): DatasetIdentity & { actionLedger: ActionState };
  runTransaction<Result>(operation: () => Result): MaybePromise<Result>;
  onChange(): void;
}

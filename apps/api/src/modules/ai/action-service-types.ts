import type { ActionRecord, ActionStore, ActionState, ActionPlan, DraftLease } from './action-state-types.ts';
import type { MessageSourceGuardOptions, RevisionArguments, Awaitable, InboxStep } from './action-inbox-types.ts';
import type { SourceReference, CatalogDependencies } from './access-service-types.ts';
import type { AiConversationTurn, AiAccessPolicy } from './private-record-types.ts';
import type { ReadNote as NoteRecord } from './access-service-types.ts';
import type { NoteVersionRecord } from '../knowledge/infrastructure/note-version-repository.ts';
import type { KnowledgeSpaceRecord } from '../knowledge/infrastructure/knowledge-space-repository.ts';
import type { TagRecord } from '../knowledge/infrastructure/tag-repository.ts';
import type { createNoteService } from '../knowledge/application/note-service.ts';
import type { createAiAccessService } from './access-service.ts';
import type {
  CoreOperationInput,
  CoreOperationLookup,
  CoreOperationReceipt,
  CoreNoteResult,
  CoreOperationResult
} from '../../infrastructure/core-operation-types.ts';
import type { createActionInboxMethods } from './action-inbox.ts';

export interface ActionArguments extends RevisionArguments {
  actionId?: string;
}
export interface ActionInput {
  spaceId: string;
  requestId: string;
  toolName: string;
  arguments: ActionArguments;
  sourceMessageId?: string;
  conversationId?: string;
}
export interface ActionCall {
  name: string;
  arguments: ActionArguments;
}
export interface ActionSourceOptions {
  sourceRefs?: SourceReference[];
  grantId?: string | null;
  catalogDeps?: CatalogDependencies | null;
}
export interface ActionOrigin extends ActionSourceOptions {
  turnId: string;
  leaseGeneration: number;
  writePolicy?: AiAccessPolicy | null;
  autonomousOrigin?: boolean;
}
export interface ActionResult extends ActionRecord {
  reconciliationPending?: boolean;
  cancellation?: string;
}
export type ActionValue =
  | InboxStep
  | NoteRecord
  | NoteVersionRecord
  | KnowledgeSpaceRecord
  | AiConversationTurn
  | AiAccessPolicy
  | CoreOperationReceipt
  | undefined;
export type ActionFlow<Result> = Generator<Awaitable<ActionValue>, Result, ActionValue>;
type NoteService = ReturnType<typeof createNoteService>;
type NoteMethod<Name extends 'createNote' | 'updateNote' | 'deleteNote'> = (
  ...args: Parameters<NoteService[Name]>
) => Awaitable<Omit<ReturnType<NoteService[Name]>, 'internalLinks'> | null>;
export interface ActionServiceOptions extends Pick<MessageSourceGuardOptions, 'ownerId'> {
  store: ActionStore;
  core: {
    get(input: CoreOperationLookup): Awaitable<CoreOperationReceipt | null | undefined>;
    commit(
      input: CoreOperationInput,
      operation: () => CoreOperationResult | PromiseLike<CoreOperationResult>
    ): Awaitable<CoreOperationReceipt>;
  };
  knowledge: {
    repositories: MessageSourceGuardOptions['repositories'] & {
      knowledgeSpaceRepository: { findById(id: string | null | undefined): Awaitable<KnowledgeSpaceRecord | null> };
      tagRepository: { findById(id: string): Awaitable<TagRecord | null> };
      noteVersionRepository: {
        findByNoteIdAndContentHash(id: string, hash: string): Awaitable<NoteVersionRecord | null>;
      };
    };
    noteService: { [Name in 'createNote' | 'updateNote' | 'deleteNote']: NoteMethod<Name> };
  };
  conversationStore?: MessageSourceGuardOptions['conversationStore'];
  accessStore?: MessageSourceGuardOptions['accessStore'];
  access?: Pick<ReturnType<typeof createAiAccessService>, 'verifyRead' | 'assertCatalogDeps'> | null;
  now?: () => Date;
  asyncDomain?: boolean;
}
export interface ActionServiceMethods {
  resumeForTurn(id: string, turn: AiConversationTurn, options?: ActionSourceOptions): Promise<ActionRecord>;
  planForAssistantTurn(
    turn: AiConversationTurn,
    call: ActionCall,
    options?: ActionSourceOptions
  ): Promise<ActionRecord>;
  planForTurn(
    turn: AiConversationTurn,
    intent: NonNullable<AiConversationTurn['writeIntent']>,
    call: ActionCall,
    options?: ActionSourceOptions
  ): Promise<ActionRecord>;
  list(spaceId: string | null): Promise<ActionResult[]>;
  get(id: string): Promise<ActionResult>;
  plan(input: ActionInput, origin?: ActionOrigin | null): Promise<ActionRecord>;
  approve(id: string, input: { planHash: string }): Promise<ActionRecord>;
  apply(id: string): Promise<ActionResult>;
  cancel(id: string, reject?: boolean): Promise<ActionResult>;
  draft(input: Pick<DraftLease, 'noteId' | 'clientId' | 'dirty'>): Promise<Omit<DraftLease, 'ownerId'>>;
  undoPreview(id: string, input: { requestId: string }): Promise<ActionRecord>;
}
export type NoteActionService = ActionServiceMethods & ReturnType<typeof createActionInboxMethods>;
export type {
  ActionRecord,
  ActionState,
  ActionPlan,
  NoteRecord,
  NoteVersionRecord,
  KnowledgeSpaceRecord,
  AiConversationTurn,
  AiAccessPolicy,
  CoreNoteResult
};

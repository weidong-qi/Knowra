import type { ActionRecord, ActionState, ActionPlan, ActionStore } from './action-state-types.ts';
import type { DatasetIdentity } from '../task-workspaces/repository-port.ts';
import type { ActionReference, NoteEdit } from './note-plan-types.ts';
import type { SourceReference, CatalogDependencies } from './access-service-types.ts';
import type { NoteRepository } from '../knowledge/infrastructure/note-repository.ts';
import type { FolderRepository, FolderRecord } from '../knowledge/infrastructure/folder-repository.ts';
import type { Tag } from '../knowledge/domain/tag.ts';
import type { AiConversationTurn, AiAccessPolicy, AiRequestManifest, AiRunGrant } from './private-record-types.ts';
export type Awaitable<T> = T | Promise<T>;
export interface RevisionChange {
  noteId: string;
  title?: string;
  folderId?: string | null;
  tagIds?: string[];
}
/** HTTP/模型修订输入在既有检查中逐步验证。 */
export interface RevisionArguments extends RevisionChange {
  changes?: RevisionChange[];
  rawMarkdown?: string;
  replacements?: NoteEdit[];
}
export interface InboxInput {
  requestId: string;
  planHash: string;
  arguments?: RevisionArguments;
}
export interface InboxOrigin {
  turnId: string;
  leaseGeneration: number;
  catalogDeps?: CatalogDependencies;
  sourceRefs?: SourceReference[];
}
export type InboxStep =
  ActionState | ActionRecord | ActionPlan | DatasetIdentity | ActionReference[] | FolderRecord | Tag | null | void;
export type InboxFlow<Result> = Generator<Awaitable<InboxStep>, Result, InboxStep>;
export interface ActionInboxOptions {
  service: {
    get(id: string): Awaitable<ActionRecord>;
    list(spaceId: string | null): Awaitable<ActionRecord[]>;
  };
  store: ActionStore;
  ownerId: string;
  now(): Date;
  run<Result>(flow: InboxFlow<Result>): Awaitable<Result>;
  rowFor(state: ActionState, actionId: string, ownerId: string): ActionRecord;
  references(
    spaceId: string,
    ids: { folders: (string | null | undefined)[]; tags: string[] }
  ): InboxFlow<ActionReference[]>;
  verifyDraft(row: ActionRecord, state: ActionState, identity: DatasetIdentity): Awaitable<void>;
  verifyRevisionTurn(origin: InboxOrigin, row: ActionRecord): Awaitable<void>;
}
type AsyncFind<Repository extends { findById: (...args: never[]) => object | null }> = {
  findById(...args: Parameters<Repository['findById']>): Awaitable<ReturnType<Repository['findById']>>;
};
export interface MessageSourceGuardOptions {
  conversationStore: Pick<
    ReturnType<typeof import('./conversation-store.ts').createAiConversationStore>,
    'peekTurn' | 'getConversation' | 'listMessages'
  > | null;
  accessStore: Pick<ReturnType<typeof import('./access-records.ts').createAiAccessStore>, 'peek' | 'get'> | null;
  repositories: { noteRepository: AsyncFind<NoteRepository>; folderRepository: AsyncFind<FolderRepository> };
  ownerId: string;
  now(): Date;
}
export interface MessageSourceScope extends DatasetIdentity {
  spaceId: string;
}
export type GuardStep =
  | AiConversationTurn
  | AiAccessPolicy
  | AiRequestManifest
  | AiRunGrant
  | ReturnType<NoteRepository['findById']>
  | ReturnType<FolderRepository['findById']>
  | undefined;
export type GuardFlow = Generator<Awaitable<GuardStep>, void, GuardStep>;

import type { DatasetIdentity } from '../task-workspaces/repository-port.ts';
import type { ExtractionTaskContext, ExtractionCommitInput } from './knowledge-extraction-host-types.ts';
import type { ExtractionQuerySteps, Awaitable } from './knowledge-extraction-query-types.ts';
import type { KnowledgeExtractionCommitReceipt } from './knowledge-extraction-commit-types.ts';
import type { KnowledgeItemServiceRecord } from '../knowledge/application/service-dependencies.ts';
import type { createAsyncKnowledgeItemService } from '../knowledge/application/postgres-async/knowledge-domain-service.ts';
import type { createKnowledgeItemService } from '../knowledge/application/knowledge-item-service.ts';
import type { KnowledgeArtifactProvenance } from '../knowledge/domain/knowledge-artifact-provenance-contract.ts';
import type { FolderRecord } from '../knowledge/infrastructure/folder-repository.ts';
import type { NoteRecord } from '../knowledge/infrastructure/note-repository.ts';
import type { NoteVersionRecord } from '../knowledge/infrastructure/note-version-repository.ts';
import type { AiAccessPolicy, AiRunGrant, AiConversationTurn } from './private-record-types.ts';
import type {
  CoreOperationInput,
  CoreOperationLookup,
  CoreOperationReceipt,
  CoreKnowledgeResult
} from '../../infrastructure/core-operation-types.ts';
import type { buildKnowledgeProposalPlan } from './knowledge-propose-tool.ts';

type CandidateResult =
  | ReturnType<ReturnType<typeof createKnowledgeItemService>['createCandidate']>
  | Awaited<ReturnType<ReturnType<typeof createAsyncKnowledgeItemService>['createCandidate']>>;
type QueryValue = Parameters<ExtractionQuerySteps<void>['next']>[0];
export type CommitValue =
  | QueryValue
  | CandidateResult
  | CommitItem
  | CommitItem[]
  | KnowledgeItemServiceRecord
  | KnowledgeItemServiceRecord[]
  | KnowledgeArtifactProvenance
  | FolderRecord
  | AiAccessPolicy
  | AiRunGrant
  | AiConversationTurn;
export type CommitSteps<Result> = Generator<Awaitable<CommitValue>, Result, CommitValue>;
export interface CommitItem {
  id: string;
  title?: string;
  canonicalStatement?: string;
  knowledgeType?: unknown;
}
export type CommitNote = Pick<
  NoteRecord,
  'id' | 'rawMarkdown' | 'spaceId' | 'folderId' | 'deleted' | 'contentKind' | 'aiVisibility'
>;
type QueryRepositories = Omit<ExtractionTaskContext<object>['repositories'], 'noteRepository'>;
export interface CommitRepositories extends QueryRepositories {
  noteRepository: {
    findById(id: string): Awaitable<CommitNote | null>;
    findByIds?(ids: string[]): Awaitable<CommitNote[]>;
  };
  knowledgeItemRepository: {
    findById(id: string): Awaitable<CommitItem | null>;
    list(options: object): Awaitable<CommitItem[]>;
  };
  knowledgeArtifactProvenanceRepository: {
    create(record: KnowledgeArtifactProvenance): Awaitable<KnowledgeArtifactProvenance | null>;
    findByArtifactId(id: string): Awaitable<KnowledgeArtifactProvenance | null>;
  };
  folderRepository: { findById(id: string): Awaitable<FolderRecord | null> };
}
export interface CommitKnowledge {
  repositories: CommitRepositories;
  knowledgeItemService: {
    createCandidate(
      input: Parameters<ReturnType<typeof createKnowledgeItemService>['createCandidate']>[0]
    ): Awaitable<CandidateResult>;
  };
}
export interface ExtractionCommitContext<Transaction> extends Omit<
  ExtractionTaskContext<Transaction>,
  'repositories' | 'transaction'
> {
  transaction?: Transaction;
  repositories: Omit<
    CommitRepositories,
    'folderRepository' | 'knowledgeItemRepository' | 'knowledgeArtifactProvenanceRepository'
  > & {
    knowledgeItemRepository: Pick<CommitRepositories['knowledgeItemRepository'], 'findById'>;
    knowledgeArtifactProvenanceRepository: Pick<CommitRepositories['knowledgeArtifactProvenanceRepository'], 'create'>;
  };
  knowledgeItemService: CommitKnowledge['knowledgeItemService'];
}
export interface ExtractionCommitStore<Transaction> {
  supportsAsync: boolean;
  runTransaction<Result>(
    operation: (tx: Transaction) => Awaitable<Result>,
    input: { jobId: string }
  ): Awaitable<Result>;
  get(input: DatasetIdentity & { jobId: string }, tx?: Transaction): Awaitable<KnowledgeExtractionCommitReceipt | null>;
  insert(input: KnowledgeExtractionCommitReceipt, tx?: Transaction): Awaitable<void | number>;
}
export interface ExtractionCommitOptions<Transaction> {
  store: ExtractionCommitStore<Transaction>;
  createContext(tx: Transaction): ExtractionCommitContext<Transaction>;
  ownerId: string;
  clock?: () => Date;
}
export type MockCommitInput = ExtractionCommitInput;
export type ProposalPlan = Awaited<ReturnType<typeof buildKnowledgeProposalPlan>>;
export interface ProposalOrigin {
  conversationId?: string;
  turnId?: string;
  toolCallId?: string;
  pairingId?: string;
  callId?: string;
}
export interface ProposalCommitInput {
  plan: ProposalPlan;
  origin: ProposalOrigin;
  identity: DatasetIdentity;
  grantId: string | null;
  generation?: number;
  provider?: string;
  modelId?: string;
  mode?: string;
  guard?: (() => void) | null;
}
export interface ProposalFindInput {
  origin: ProposalOrigin;
  identity: DatasetIdentity;
  mode?: string;
}
export interface ProposalApplyInput extends ProposalCommitInput {
  committedAt: string;
}
export interface AgentKnowledgeCommitOptions {
  core: {
    commit(input: CoreOperationInput, operation: () => Awaitable<CoreKnowledgeResult>): Awaitable<CoreOperationReceipt>;
    get(input: CoreOperationLookup): Awaitable<CoreOperationReceipt | null | undefined>;
  };
  knowledge: Omit<CommitKnowledge, 'repositories'> & {
    repositories: Omit<CommitRepositories, 'analysisScopeRepository'>;
  };
  ownerId: string;
  conversationStore: { peekTurn(id: string | undefined): Awaitable<AiConversationTurn | null> };
  accessStore: {
    peek(kind: 'aiRunGrant', id: string): Awaitable<AiRunGrant | null>;
    peek(kind: 'aiAccessPolicy', id: string): Awaitable<AiAccessPolicy | null>;
  };
  asyncDomain?: boolean;
  now?: () => Date;
}
export type {
  NoteRecord,
  NoteVersionRecord,
  FolderRecord,
  KnowledgeItemServiceRecord,
  AiAccessPolicy,
  AiRunGrant,
  AiConversationTurn,
  CoreKnowledgeResult
};

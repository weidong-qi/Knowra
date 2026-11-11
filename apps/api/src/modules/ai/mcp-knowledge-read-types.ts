import type { SnapshotDependencies, SnapshotRepositories } from './mcp-read-snapshot-types.ts';
import type {
  KnowledgeItemRepository,
  KnowledgeItemRecord
} from '../knowledge/infrastructure/knowledge-item-repository.ts';
import type { KnowledgeArtifactProvenanceRepository } from '../knowledge/infrastructure/knowledge-artifact-provenance-repository.ts';
import type { DatasetIdentity } from '../task-workspaces/repository-port.ts';
import type { ProposalInput } from './boundary-types.ts';
import type { createAgentKnowledgeCommitService } from './agent-knowledge-commit.ts';

type Awaitable<T> = T | Promise<T>;
export interface McpKnowledgeRepositories extends SnapshotRepositories {
  knowledgeItemRepository: SnapshotRepositories['knowledgeItemRepository'] & {
    list: (
      ...args: Parameters<KnowledgeItemRepository<KnowledgeItemRecord<unknown>>['list']>
    ) => Awaitable<ReturnType<KnowledgeItemRepository<KnowledgeItemRecord<unknown>>['list']>>;
  };
  knowledgeArtifactProvenanceRepository: SnapshotRepositories['knowledgeArtifactProvenanceRepository'] & {
    list: (
      ...args: Parameters<KnowledgeArtifactProvenanceRepository['list']>
    ) => Awaitable<ReturnType<KnowledgeArtifactProvenanceRepository['list']>>;
  };
}
export interface McpKnowledgeReadDependencies {
  knowledge?: { repositories: McpKnowledgeRepositories };
  ownerId?: string;
  accessStore?: SnapshotDependencies['accessStore'] & { identity(): Awaitable<DatasetIdentity> };
  knowledgeCommit?: Pick<ReturnType<typeof createAgentKnowledgeCommitService>, 'findCommitted'>;
}
export type McpReadAccess = Pick<ProposalInput['access'], 'verifyRead' | 'assertSearchSources' | 'assertSearchGrant'>;
export type McpVerifiedRead = Awaited<ReturnType<McpReadAccess['verifyRead']>>;
export interface McpKnowledgeReadInput {
  grantId: string;
  access: McpReadAccess;
  knowledgeId: string;
}
export interface McpReceiptInput {
  grantId: string;
  access: McpReadAccess;
  pairing: { pairingId: string };
  callId: string;
  requestId?: string | null;
  discovery?:
    import('../knowledge/domain/knowledge-artifact-provenance-contract.ts').KnowledgeArtifactProvenance[] | null;
}
export type McpProposalInput = Omit<McpReceiptInput, 'callId'> & {
  input: { candidates?: unknown[]; idempotencyKey?: string };
  reused?: boolean;
};

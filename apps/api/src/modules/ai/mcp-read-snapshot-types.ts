import type { DatasetIdentity } from '../task-workspaces/repository-port.ts';
import type { ReadNote, ReadNoteRepository, ReadFolderRepository } from './access-service-types.ts';
import type { KnowledgeSpaceRepository } from '../knowledge/infrastructure/knowledge-space-repository.ts';
import type { KnowledgeItemRecord } from '../knowledge/infrastructure/knowledge-item-repository.ts';
import type {
  KnowledgeEvidenceListOptions,
  KnowledgeEvidenceRecord
} from '../knowledge/infrastructure/knowledge-evidence-repository.ts';
import type { KnowledgeArtifactProvenanceRepository } from '../knowledge/infrastructure/knowledge-artifact-provenance-repository.ts';
import type { ContentAnnotationRepository } from '../knowledge/infrastructure/content-annotation-repository.ts';
import type { NoteVersionRepository, NoteVersionRecord } from '../knowledge/infrastructure/note-version-repository.ts';

type Awaitable<T> = T | Promise<T>;
type AsyncMethods<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Awaitable<R> : T[K];
};
/** PostgreSQL 历史审核状态仍是字符串，消费端沿用既有允许值校验。 */
export type ReadKnowledgeItem = Omit<KnowledgeItemRecord<unknown>, 'reviewStatus'> & {
  reviewStatus?: string | null;
};
export type ReadKnowledgeEvidence = Omit<
  KnowledgeEvidenceRecord<unknown, unknown>,
  'status' | 'applicabilityStatus'
> & {
  status?: string | null;
  applicabilityStatus?: string | null;
};
export interface SnapshotRepositories {
  noteRepository: Pick<ReadNoteRepository, 'findById' | 'list'>;
  folderRepository: ReadFolderRepository;
  knowledgeSpaceRepository: AsyncMethods<Pick<KnowledgeSpaceRepository, 'findById'>>;
  knowledgeItemRepository: { findById(id: string): Awaitable<ReadKnowledgeItem | null> };
  knowledgeEvidenceRepository: { list(options?: KnowledgeEvidenceListOptions): Awaitable<ReadKnowledgeEvidence[]> };
  knowledgeArtifactProvenanceRepository: AsyncMethods<Pick<KnowledgeArtifactProvenanceRepository, 'findByArtifactId'>>;
  noteVersionRepository: AsyncMethods<Pick<NoteVersionRepository, 'findById' | 'findByNoteIdAndContentHash'>>;
  contentAnnotationRepository?: AsyncMethods<Pick<ContentAnnotationRepository, 'findById'>>;
}
interface Grant extends DatasetIdentity {
  ownerId: string;
  actorId: string;
  policyId: string;
  expiresAt: string;
  allowedTools: string[];
  policyRevision: number;
  spaceId: string;
}
interface Policy extends DatasetIdentity {
  ownerId: string;
  actorId: string;
  expiresAt: string;
  revokedAt?: string | null;
  read: boolean;
  revision: number;
  spaceId: string;
  excludedNoteIds: string[];
  scope: { kind: string; noteIds?: string[]; folderId?: string };
}
export interface SnapshotDependencies {
  repos: SnapshotRepositories;
  ownerId: string;
  accessStore: {
    peekIdentity(): Awaitable<DatasetIdentity>;
    peek(kind: 'aiRunGrant', id: string): Awaitable<Grant | null>;
    peek(kind: 'aiAccessPolicy', id: string): Awaitable<Policy | null>;
  };
  unavailable(): Error;
}
export interface CheckedSnapshot {
  knowledgeId?: string;
  state: {
    item: { id: string } | null;
    evidence: object[];
    provenance: object | null;
  };
  reads: Map<string, { note: ReadNote; version: NoteVersionRecord }>;
  versions?: Map<string, NoteVersionRecord | null>;
  annotations?: Map<unknown, object | null>;
}
export interface OutputGuard {
  grantId: string;
  identity: DatasetIdentity;
  checkedItems: CheckedSnapshot[];
  outputHash?: string;
}

import type { NoteRepository } from '../knowledge/infrastructure/note-repository.ts';
import type { FolderRepository } from '../knowledge/infrastructure/folder-repository.ts';
import type { KnowledgeSpaceRepository } from '../knowledge/infrastructure/knowledge-space-repository.ts';
import type { ContentAnnotationRepository } from '../knowledge/infrastructure/content-annotation-repository.ts';
import type { NoteVersion } from '../knowledge/domain/note-version.ts';
import type { CatalogSpec } from './catalog-tool.ts';

type Awaitable<T> = T | Promise<T>;
type AsyncMethods<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Awaitable<R> : T[K];
};
export interface ReadRepositories {
  noteRepository?: AsyncMethods<Pick<NoteRepository, 'findById' | 'list'>> &
    Partial<AsyncMethods<Pick<NoteRepository, 'findByIds'>>>;
  noteVersionRepository?: {
    findById(id: string): Awaitable<NoteVersion | null>;
    findByNoteIdAndContentHash(noteId: string, contentHash: string): Awaitable<NoteVersion | null>;
  };
  folderRepository?: AsyncMethods<Pick<FolderRepository, 'findById' | 'list'>>;
  spaceRepository?: AsyncMethods<Pick<KnowledgeSpaceRepository, 'findById'>>;
  ownerId?: string;
  now?: () => Date;
}
export interface AiAccessServiceDependencies extends ReadRepositories {
  store?: Pick<
    ReturnType<typeof import('./access-records.ts').createAiAccessStore>,
    'identity' | 'get' | 'list' | 'insert' | 'replacePolicy'
  >;
  annotationRepository?: AsyncMethods<Pick<ContentAnnotationRepository, 'list'>> | null;
}
export interface RunGrantInput {
  policyId?: string;
  conversationId?: string;
  allowedTools?: string[];
  maxBudgetMicrounits?: number;
  expiresAt?: string;
}
export interface SourceRange {
  noteId: string;
  start: number;
  end: number;
}
export interface SourceReference extends SourceRange {
  noteVersionId: string;
  contentHash: string;
  quoteHash: string;
}
export interface CatalogDependencies {
  noteIds: string[];
  folderIds: string[];
}
export interface RequestHistoryEntry {
  role: string;
  content: string;
  sourceRefs: SourceReference[];
  sourceFree?: boolean;
  provenanceHash: string;
  provenanceManifestId?: string | null;
}
export interface PrepareRequestInput {
  grantId?: string;
  recipient?: string;
  modelId?: string;
  credentialRef?: string;
  userMessage?: string;
  history?: RequestHistoryEntry[];
  sourceRanges?: SourceRange[];
  omissions?: string[];
  maxTokens?: number;
  tools?: ReturnType<typeof import('./gateway.js').normalizeAiRequest>['tools'];
  format?: string;
  writeToolName?: string | null;
  assistantTools?: boolean;
  catalog?: CatalogSpec[];
  inheritedCatalog?: CatalogDependencies | null;
}

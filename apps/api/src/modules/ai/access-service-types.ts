import type { NoteRepository, NoteRecord } from '../knowledge/infrastructure/note-repository.ts';
import type { FolderRepository, FolderRecord } from '../knowledge/infrastructure/folder-repository.ts';
import type { KnowledgeSpaceRepository } from '../knowledge/infrastructure/knowledge-space-repository.ts';
import type { ContentAnnotationRepository } from '../knowledge/infrastructure/content-annotation-repository.ts';
import type { NoteVersionRecord } from '../knowledge/infrastructure/note-version-repository.ts';
import type { CatalogSpec } from './catalog-tool.ts';

type Awaitable<T> = T | Promise<T>;
type AsyncMethods<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Awaitable<R> : T[K];
};
/** AI 只读流程不使用链接数据；本地与 PostgreSQL 保留各自的链接存储形状。 */
export type ReadNote = Omit<NoteRecord, 'internalLinks'>;
export interface ReadNoteRepository {
  findById(...args: Parameters<NoteRepository['findById']>): Awaitable<ReadNote | null>;
  list(...args: Parameters<NoteRepository['list']>): Awaitable<ReadNote[]>;
  findByIds?(ids: string[]): Awaitable<ReadNote[]>;
}
/** 读取授权目录不依赖删除包的持久化载荷。 */
export type ReadFolder = Omit<FolderRecord, 'deletionPackage'>;
export interface ReadFolderRepository {
  findById(...args: Parameters<FolderRepository['findById']>): Awaitable<ReadFolder | null>;
  list(...args: Parameters<FolderRepository['list']>): Awaitable<ReadFolder[]>;
}
export interface ReadRepositories {
  noteRepository?: ReadNoteRepository;
  noteVersionRepository?: {
    findById(id: string): Awaitable<NoteVersionRecord | null>;
    findByNoteIdAndContentHash(noteId: string, contentHash: string): Awaitable<NoteVersionRecord | null>;
  };
  folderRepository?: ReadFolderRepository;
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
  tools?: ReturnType<typeof import('./gateway.ts').normalizeAiRequest>['tools'];
  format?: string;
  writeToolName?: string | null;
  assistantTools?: boolean;
  catalog?: CatalogSpec[];
  inheritedCatalog?: CatalogDependencies | null;
}

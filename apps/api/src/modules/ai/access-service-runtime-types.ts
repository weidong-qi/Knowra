import type { CatalogSpec } from './catalog-tool.ts';
import type { CatalogDependencies } from './access-service-types.ts';
import type { NoteRecord } from '../knowledge/infrastructure/note-repository.ts';
import type { GatewayRequest } from './gateway.ts';

/** 受信调用及HTTP JSON的支持字段；服务保留原有逐项运行校验。 */
export interface AccessScopeInput {
  kind: string;
  folderId?: string;
  noteIds?: string[];
}
export interface CreatePolicyInput {
  spaceId: string;
  scope: AccessScopeInput;
  excludedNoteIds?: string[];
  includeAttachments: boolean;
  read: boolean;
  egress: boolean;
  recipients: string[];
  expiresAt: string;
}
export interface NarrowPolicyInput {
  revision: number;
  scope?: AccessScopeInput;
  excludedNoteIds?: string[];
  read?: boolean;
  egress?: boolean;
  recipients?: string[];
  expiresAt?: string;
  revoke?: boolean;
}
interface CatalogPage {
  offset: number;
  total: number;
  hasMore: boolean;
  unavailable?: never;
}
export interface FolderCatalogEntry extends CatalogPage {
  kind: 'folders';
  parentId: string | null;
  folders: { folderId: string; name: string; parentId: string | null; noteCount: number; childCount: number }[];
  notes?: never;
}
export interface NoteCatalogEntry extends CatalogPage {
  kind: 'notes';
  folderId: string | null;
  titleQuery: string | null;
  recursive: boolean;
  sortBy: string;
  notes: {
    noteId: string;
    title: string;
    folderId: string | null;
    updatedAt: string | null;
    highlightCount?: number;
    importantCount?: number;
  }[];
  folders?: never;
}
export type CatalogEntry = FolderCatalogEntry | NoteCatalogEntry;
export interface BuiltCatalog extends CatalogDependencies {
  spec: CatalogSpec;
  entry: CatalogEntry | { kind: CatalogSpec['kind']; unavailable: true; notes?: never; folders?: never };
  resultHash: string;
}
export interface SourceSnapshot extends Partial<CatalogDependencies> {
  sourceRefs?: { noteId: string; contentHash?: string }[];
}
export interface SearchCandidateInput {
  grantId: string;
  scoreNote(note: Pick<NoteRecord, 'title' | 'rawMarkdown' | 'createdAt' | 'updatedAt'>): number;
  maxCandidates: number;
  maxScanNotes: number;
  maxScanChars: number;
  maxNoteChars: number;
}
export interface AssertRequestInput {
  grantId: string;
  manifestId: string;
  request: GatewayRequest & { tools: NonNullable<GatewayRequest['tools']> };
  recipient: string;
}

/** 同空间且可读的仓库返回值；旧 deletedAt 扩展由下游单独检查。 */
export interface ScopedAccessNote extends NoteRecord {
  spaceId: string;
  deletedAt?: unknown;
}

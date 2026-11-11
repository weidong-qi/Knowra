import type { ContentAnchor } from '@study-accelerator/content-anchor';
import type { ContentAnnotationRecord } from '../infrastructure/content-annotation-repository.ts';
import type { NoteRecord, NoteRepository } from '../infrastructure/note-repository.ts';
import type { NoteVersionRecord, NoteVersionRepository } from '../infrastructure/note-version-repository.ts';
import type { KnowledgeEvidenceRepository } from '../infrastructure/knowledge-evidence-repository.ts';
import type { KnowledgeItemRepository } from '../infrastructure/knowledge-item-repository.ts';
import type {
  AnalysisScopeRecord,
  AnalysisScopeRepository,
  AnnotationExclusionRecord
} from '../infrastructure/annotation-support-repositories.ts';
import type { PostgresRepositories } from './postgres-async/service-dependencies.ts';

export interface ScopeInput {
  spaceId?: unknown;
  mode?: unknown;
  noteIds?: unknown;
  annotationIds?: unknown;
  overrideExclusionIds?: unknown;
  selections?: unknown;
  onceExclusions?: unknown;
  previewHash?: unknown;
  idempotencyKey?: unknown;
  expectedUpdatedAt?: unknown;
}
export interface ScopeSelection {
  noteId: string;
  anchor: ContentAnchor;
}
export interface ScopeInterval {
  noteId: string;
  start: number;
  end: number;
  exclusionId?: string;
}
export interface ScopeContribution extends ScopeInterval {
  annotationId: string | null;
}
export interface ScopeOmission {
  annotationId?: string;
  noteId?: string;
  sourceStart?: number | null;
  sourceEnd?: number | null;
  reason?: unknown;
}
export interface ScopeSegment extends ScopeInterval {
  noteVersionId: unknown;
  markdown: string;
  annotationIds: string[];
}
/** 只描述旧服务已有的属性操作；仓储历史值仍原样返回，不在读取处补校验或转换。 */
export type ScopeAnnotationView = Omit<ContentAnnotationRecord, 'id' | 'noteId' | 'scopeType' | 'anchor'> & {
  id: string;
  noteId: string;
  scopeType: string;
  anchor?: (Partial<ContentAnchor> & { markId?: string }) | null;
};
export interface ScopeExclusionView extends AnnotationExclusionRecord {
  id: string;
  noteVersionId?: unknown;
  anchor?: (ContentAnchor & { unresolved?: boolean }) | null;
}
export interface ScopeSnapshotRecord extends AnalysisScopeRecord {
  inputHash?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}
export interface ScopeResolutionView {
  status: unknown;
  reason?: unknown;
  quoteText?: unknown;
  candidates?: { sourceStart: number; sourceEnd: number }[];
}
export interface AnnotationScopeDependencies {
  annotationRepository: { findById(id: string): ContentAnnotationRecord | null };
  exclusionRepository: {
    list(options: { parentAnnotationId: string; includeDeleted?: boolean }): AnnotationExclusionRecord[];
  };
  analysisScopeRepository: Pick<
    AnalysisScopeRepository<ScopeSnapshotRecord>,
    'findById' | 'findByIdempotencyKey' | 'list' | 'save'
  > & {
    update?(record: ScopeSnapshotRecord, expectedUpdatedAt: unknown): ScopeSnapshotRecord;
  };
  noteRepository: Pick<NoteRepository, 'findById'>;
  noteVersionRepository: Pick<NoteVersionRepository, 'findById' | 'findByNoteIdAndContentHash'>;
  evidenceRepository: Pick<KnowledgeEvidenceRepository, 'list'>;
  knowledgeItemRepository: Pick<KnowledgeItemRepository, 'findById'>;
}
export interface AsyncAnnotationScopeDependencies {
  annotationRepository: Pick<PostgresRepositories['contentAnnotationRepository'], 'findById'>;
  exclusionRepository: Pick<PostgresRepositories['annotationExclusionRepository'], 'list'>;
  analysisScopeRepository: Pick<
    PostgresRepositories['analysisScopeRepository'],
    'findById' | 'findByIdempotencyKey' | 'list' | 'save' | 'update'
  >;
  noteRepository: Pick<PostgresRepositories['noteRepository'], 'findById'>;
  noteVersionRepository: Pick<PostgresRepositories['noteVersionRepository'], 'findById' | 'findByNoteIdAndContentHash'>;
  evidenceRepository: Pick<PostgresRepositories['knowledgeEvidenceRepository'], 'list'>;
  knowledgeItemRepository: Pick<PostgresRepositories['knowledgeItemRepository'], 'findById'>;
}
export type ScopeNote = Pick<NoteRecord, 'id' | 'rawMarkdown' | 'title' | 'spaceId' | 'deleted' | 'contentKind'>;
export type ScopeVersion = Pick<NoteVersionRecord, 'id' | 'noteId' | 'content' | 'contentHash'>;

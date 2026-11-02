import type {
  Attachment,
  AttachmentCleanupStatus,
  AttachmentDeleteResult,
  AttachmentDeletionPreflight
} from '../../../../packages/web-core/src/workspace/types.ts';
import type { KnowledgeSpace } from '../modules/knowledge/domain/knowledge-space.ts';
import type { Folder } from '../modules/knowledge/domain/folder.ts';
import type { Tag } from '../modules/knowledge/domain/tag.ts';
import type { TagGroup } from '../modules/knowledge/domain/tag-group.ts';
import type { Note } from '../modules/knowledge/domain/note.ts';
import type { NoteVersion } from '../modules/knowledge/domain/note-version.ts';
import type { KnowledgeItem } from '../modules/knowledge/domain/knowledge-item.ts';
import type { KnowledgeEvidence } from '../modules/knowledge/domain/knowledge-evidence.ts';
import type { KnowledgeArtifactProvenance } from '../modules/knowledge/domain/knowledge-artifact-provenance-contract.ts';
import type { LearningObjective } from '../modules/knowledge/domain/learning-objective.ts';
import type { ExamProfile } from '../modules/knowledge/domain/exam-profile.ts';
import type { ExamFocus } from '../modules/knowledge/domain/exam-focus.ts';
import type { Question } from '../modules/knowledge/domain/question.ts';
import type { QuestionSource } from '../modules/knowledge/domain/question-source.ts';
import type { ContentAnnotation, ContentAnnotationAnchor } from '../modules/knowledge/domain/content-annotation.ts';

type StorageResult<Value> = Value | Promise<Value>;

export interface AnnotationExclusionSnapshot {
  id: string;
  parentAnnotationId: string;
  anchor: ContentAnnotationAnchor & { unresolved?: boolean };
  noteVersionId?: string | null;
  status?: string;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface AnnotationRevisionSnapshot {
  id: string;
  annotationId: string;
  revision: number;
  operation: string;
  oldAnchor?: ContentAnnotationAnchor | null;
  newAnchor?: ContentAnnotationAnchor | null;
  rangeSummary?: { scopeType: string; quoteText: string } | null;
  reason?: string | null;
  createdAt?: string;
}

export interface AnalysisScopeSegment {
  noteId: string;
  noteVersionId: string;
  start: number;
  end: number;
  markdown: string;
  annotationIds: string[];
}

export interface AnalysisScopeSnapshot {
  id: string;
  spaceId: string;
  mode: 'all' | 'marked';
  inputHash: string;
  idempotencyKey: string;
  noteVersions: { noteId: string; noteVersionId: string; contentHash: string; title: string }[];
  selections: { noteId: string; anchor: ContentAnnotationAnchor }[];
  segments: AnalysisScopeSegment[];
  contextSegments: AnalysisScopeSegment[];
  exclusions: { noteId: string; start: number; end: number; exclusionId?: string }[];
  omittedItems: (
    | { annotationId: string; reason: string | null }
    | { noteId: string; sourceStart: number; sourceEnd: number; reason: string }
  )[];
  annotationRevisions: { annotationId: string; revision: number }[];
  summary: { noteCount: number; segmentCount: number; annotationCount: number };
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface KnowledgeBaseSnapshot {
  exportedAt: string;
  version: string;
  schemaVersion: number;
  data: {
    spaces: KnowledgeSpace[];
    folders: Folder[];
    tags: Tag[];
    tagGroups: TagGroup[];
    notes: Note[];
    noteVersions: NoteVersion[];
    knowledgeItems: KnowledgeItem[];
    knowledgeEvidence: KnowledgeEvidence[];
    knowledgeArtifactProvenance: KnowledgeArtifactProvenance[];
    learningObjectives: LearningObjective[];
    examProfiles: ExamProfile[];
    examFocuses: ExamFocus[];
    questions: Question[];
    questionObjectives: { id: string; questionId: string; learningObjectiveId: string; order: number }[];
    questionSources: QuestionSource[];
    attachments: Attachment[];
    contentAnnotations: ContentAnnotation[];
    annotationExclusions: AnnotationExclusionSnapshot[];
    annotationRevisions: AnnotationRevisionSnapshot[];
    analysisScopeSnapshots: AnalysisScopeSnapshot[];
  };
  attachmentFiles: (Attachment & { contentBase64: string })[];
}

export interface StorageRouteServices {
  exportKnowledgeBase(): StorageResult<KnowledgeBaseSnapshot>;
  importKnowledgeBase(body: unknown): StorageResult<KnowledgeBaseSnapshot>;
  listAttachments(query: Record<string, string>): StorageResult<Attachment[]>;
  listAttachmentCleanup(): StorageResult<AttachmentCleanupStatus>;
  verifyAttachment(params: { id: string }): StorageResult<Attachment>;
  restoreAttachment(params: { id: string }, body: unknown): StorageResult<Attachment>;
  retryAttachmentCleanup(): StorageResult<{ completed: number; pending: number }>;
  uploadAttachment(body: unknown): StorageResult<Attachment>;
  getAttachmentContent(params: { id: string }): StorageResult<{
    content: Uint8Array;
    attachment: Pick<Attachment, 'mimeType' | 'fileName'>;
  }>;
  inspectAttachmentDeletion(params: { id: string }): StorageResult<AttachmentDeletionPreflight>;
  deleteAttachment(params: { id: string }): StorageResult<AttachmentDeleteResult>;
  updateAttachment(params: { id: string }, body: unknown): StorageResult<Attachment>;
}

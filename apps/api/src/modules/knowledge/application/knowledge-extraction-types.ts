import type { NoteVersion } from '../domain/note-version.ts';
export interface ExtractionScope {
  id: string;
  spaceId: string;
  inputHash: string;
  noteVersions: { noteVersionId: string; noteId: string; contentHash: string }[];
  annotationRevisions: { annotationId: string; revision: number }[];
  segments: {
    noteVersionId: string;
    noteId: string;
    start: number;
    end: number;
    markdown: string;
    annotationIds: string[];
  }[];
}
export interface PrepareExtractionInput {
  scope?: ExtractionScope;
  noteVersions?: NoteVersion[];
  idempotencyKey?: string;
}
/** 模型输出在校验入口采用结构视图；字段仍须通过运行时白名单与范围校验。 */
export interface ExtractionOutput {
  contractVersion: number;
  requestId: string;
  candidates: {
    title: string;
    canonicalStatement: string;
    knowledgeType: string;
    citations: { sourceId: string; start: number; end: number; quote: string }[];
  }[];
}
export interface ExtractionSource {
  sourceId: string;
  noteId: string;
  noteVersionId: string;
  contentHash: string;
  start: number;
  end: number;
  markdown: string;
  annotationRevisions: { annotationId: string; revision: number }[];
}
export interface ExtractionRequest {
  contractVersion: 1;
  requestId: string;
  scopeId: string | null;
  spaceId: string;
  inputHash: string;
  sources: ExtractionSource[];
}
export interface ExtractionCandidatePlan {
  reviewStatus: 'candidate';
  provenance: (Omit<ExtractionSource, 'markdown'> & { quoteText: string })[];
  candidateInput: {
    id: string;
    title: string;
    canonicalStatement: string;
    knowledgeType: string;
    sourceMode: 'ai';
    userExplanation: '';
    evidence: {
      id: string;
      sourceType: 'noteVersion';
      noteId: string;
      noteVersionId: string;
      quoteText: string;
      headingPath: string[];
    }[];
  };
}
export interface ExtractionPlan {
  requestId: string;
  scopeId: string | null;
  inputHash: string;
  outputHash: string;
  candidates: ExtractionCandidatePlan[];
}
export interface ValidateExtractionInput {
  request?: Omit<ExtractionRequest, 'contractVersion'> & { contractVersion: number };
  result?: unknown;
}

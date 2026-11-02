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
export interface ValidateExtractionInput {
  request?: ReturnType<typeof import('./knowledge-extraction-contract.js').prepareKnowledgeExtraction>;
  result?: unknown;
}

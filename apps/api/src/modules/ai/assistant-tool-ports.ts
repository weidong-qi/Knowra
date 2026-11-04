import type { NoteRecord } from '../knowledge/infrastructure/note-repository.ts';
import type { CandidateReference } from './boundary-types.ts';
import type { SourceReference } from './access-service-types.ts';

export interface AssistantSearchHit {
  noteId: string;
  title: string;
  text: string;
  ref: SourceReference;
}
export interface AssistantSearchResult {
  hits: AssistantSearchHit[];
  inspected: number;
  truncated: boolean;
  mode?: string;
  fallbackReason?: string;
  timeRange?: { createdFrom: string; createdBefore: string };
}
export interface AssistantSearch {
  search(input: { grantId: string; query: unknown; limit: number }): Promise<AssistantSearchResult>;
}
type SearchNote = Pick<NoteRecord, 'id' | 'title' | 'rawMarkdown' | 'createdAt'>;
export interface AssistantSearchAccess {
  findAuthorizedSearchCandidates(input: {
    grantId: string;
    maxCandidates: number;
    maxScanNotes: number;
    maxScanChars: number;
    maxNoteChars: number;
    scoreNote(note: Pick<SearchNote, 'title' | 'rawMarkdown' | 'createdAt'>): number;
  }): Promise<{ candidates: CandidateReference[]; truncated: boolean }>;
  verifyRead(input: { grantId: string; noteId: string; tool: 'notes_search' }): Promise<{
    note: SearchNote;
    version: { id: string; content: string };
    contentHash: string;
  }>;
  assertSearchGrant(input: { grantId: string }): Promise<void>;
  assertSearchSources(input: { grantId: string; sourceRefs: SourceReference[] }): Promise<void>;
}
export interface AssistantNoteSearchOptions {
  search: AssistantSearch;
  access: AssistantSearchAccess;
  grantId: string;
  args: unknown;
}
/** 第三方合成适配器的能力/结果仍在原调用点检查。 */
export interface AssistantWebSearchAdapter {
  capabilities?(): { mode?: unknown; egress?: unknown };
  search?(input: { query: string; limit: number; signal?: AbortSignal }): Promise<unknown>;
}

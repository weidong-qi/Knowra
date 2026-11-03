export interface DocumentDraft { title: string; markdown: string; baseRevision: number }
export function documentDraftKey(datasetId: string, datasetEpoch: string, workspaceId: string, documentId: string) {
  return `knowra:task-document:${JSON.stringify([datasetId, datasetEpoch, workspaceId, documentId])}`;
}
export function readDocumentDraft(key: string): DocumentDraft | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!value || typeof value !== 'object') return null;
    const draft = value as DocumentDraft;
    return typeof draft.title === 'string' && typeof draft.markdown === 'string' && Number.isInteger(draft.baseRevision) && draft.baseRevision > 0 ? draft : null;
  } catch { return null; }
}
export function writeDocumentDraft(key: string, draft: DocumentDraft) {
  try { localStorage.setItem(key, JSON.stringify(draft)); return true; } catch { return false; }
}
export function clearDocumentDraft(key: string) {
  try { localStorage.removeItem(key); } catch { /* Current editor still retains its text. */ }
}

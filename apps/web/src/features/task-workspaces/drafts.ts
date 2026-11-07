export interface DocumentDraft {
  title: string;
  markdown: string;
  baseRevision: number;
}
export function documentDraftKey(datasetId: string, datasetEpoch: string, workspaceId: string, documentId: string) {
  return `knowra:task-document:${JSON.stringify([datasetId, datasetEpoch, workspaceId, documentId])}`;
}
export function readDocumentDraft(key: string): DocumentDraft | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!value || typeof value !== 'object') return null;
    const draft = value as DocumentDraft;
    return typeof draft.title === 'string' &&
      typeof draft.markdown === 'string' &&
      Number.isInteger(draft.baseRevision) &&
      draft.baseRevision > 0
      ? draft
      : null;
  } catch {
    return null;
  }
}
export function writeDocumentDraft(key: string, draft: DocumentDraft) {
  try {
    localStorage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}
/** localStorage 的比较后删除不是跨标签原子操作；不匹配或读取失败时保留草稿。 */
export function clearDocumentDraft(key: string, expected: DocumentDraft) {
  try {
    if (localStorage.getItem(key) !== JSON.stringify(expected)) return false;
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
/** 旧回执只可重定基本实例仍持有的草稿，不能覆盖其他实例的新草稿。 */
export function rebaseDocumentDraft(key: string, expected: DocumentDraft, next: DocumentDraft) {
  try {
    if (localStorage.getItem(key) !== JSON.stringify(expected)) return false;
    return writeDocumentDraft(key, next);
  } catch {
    return false;
  }
}

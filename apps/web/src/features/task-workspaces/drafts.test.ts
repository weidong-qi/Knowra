import { beforeEach, expect, it } from 'vitest';
import { clearDocumentDraft, documentDraftKey, readDocumentDraft, writeDocumentDraft } from './drafts';
beforeEach(() => localStorage.clear());
it('isolates draft identities across datasets, restored epochs, workspaces and documents', () => {
  const keys = [['a','e','w','d'],['b','e','w','d'],['a','f','w','d'],['a','e','x','d'],['a','e','w','q']].map(([dataset, epoch, workspace, document]) => documentDraftKey(dataset!, epoch!, workspace!, document!));
  expect(new Set(keys).size).toBe(5);
  const draft = { title: '合成文档', markdown: '未保存正文', baseRevision: 2 };
  expect(writeDocumentDraft(keys[0]!, draft)).toBe(true);
  expect(readDocumentDraft(keys[0]!)).toEqual(draft);
  keys.slice(1).forEach(key => expect(readDocumentDraft(key)).toBeNull());
  clearDocumentDraft(keys[0]!); expect(readDocumentDraft(keys[0]!)).toBeNull();
});
it('ignores invalid cached content', () => {
  localStorage.setItem('key', '{'); expect(readDocumentDraft('key')).toBeNull();
  localStorage.setItem('key', JSON.stringify({ title: 'x', markdown: 'x', baseRevision: 0 })); expect(readDocumentDraft('key')).toBeNull();
});

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { MilkdownNoteEditorProps } from '../editor/MilkdownNoteEditor';
import { WorkspaceDocumentEditor } from './WorkspaceDocumentEditor';
import { syntheticDocument } from './testFixtures';
import { documentDraftKey, readDocumentDraft } from './drafts';
vi.mock('../editor/MilkdownNoteEditor', () => ({ MilkdownNoteEditor: ({ markdown, onChange, readOnly }: MilkdownNoteEditorProps) => <textarea aria-label="合成正文" value={markdown} readOnly={readOnly} onChange={event => onChange(event.target.value)} /> }));
afterEach(() => { cleanup(); localStorage.clear(); });
function props() { return { document: syntheticDocument(), datasetId: 'dataset', datasetEpoch: 'epoch', onSave: vi.fn().mockRejectedValue({ status: 409 }), onReload: vi.fn().mockResolvedValue(syntheticDocument({ revision: 2, markdown: '服务端新增正文' })), onUpload: vi.fn() }; }
it('retains a conflicting local draft and never silently rebases it', async () => {
  const input = props(); render(<WorkspaceDocumentEditor {...input} />);
  fireEvent.change(screen.getByRole('textbox', { name: '合成正文' }), { target: { value: '我的未保存修改' } });
  fireEvent.click(screen.getByRole('button', { name: '保存文档' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('草稿仍保留'));
  expect(input.onSave).toHaveBeenCalledWith({ title: '合成说明', markdown: '我的未保存修改', baseRevision: 1 });
  expect(readDocumentDraft(documentDraftKey('dataset', 'epoch', 'workspace', 'doc'))?.markdown).toBe('我的未保存修改');
  fireEvent.click(screen.getByRole('button', { name: '核对最新版本' }));
  await screen.findByRole('dialog');
  expect(screen.getByText('服务端新增正文')).toBeInTheDocument();
  expect(readDocumentDraft(documentDraftKey('dataset', 'epoch', 'workspace', 'doc'))?.baseRevision).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: '以此版本为合并基线' }));
  expect(readDocumentDraft(documentDraftKey('dataset', 'epoch', 'workspace', 'doc'))).toMatchObject({ markdown: '我的未保存修改', baseRevision: 2 });
});
it('a late save from an unmounted document cannot clear another document draft', async () => {
  let resolve!: (value: ReturnType<typeof syntheticDocument>) => void;
  const input = props(); input.onSave.mockImplementation(() => new Promise(done => { resolve = done; }));
  const view = render(<WorkspaceDocumentEditor key="old" {...input} />);
  fireEvent.change(screen.getByRole('textbox', { name: '合成正文' }), { target: { value: '旧文档修改' } });
  fireEvent.click(screen.getByRole('button', { name: '保存文档' }));
  view.rerender(<WorkspaceDocumentEditor key="new" {...input} document={syntheticDocument({ id: 'another' })} />);
  fireEvent.change(screen.getByRole('textbox', { name: '合成正文' }), { target: { value: '新文档修改' } });
  resolve(syntheticDocument({ revision: 2, markdown: '旧文档修改' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: '合成正文' })).toHaveValue('新文档修改'));
  expect(readDocumentDraft(documentDraftKey('dataset', 'epoch', 'workspace', 'another'))?.markdown).toBe('新文档修改');
});

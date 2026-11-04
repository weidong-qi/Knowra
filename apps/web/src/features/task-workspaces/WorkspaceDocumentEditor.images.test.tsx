import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceDocumentEditor } from './WorkspaceDocumentEditor';
import { syntheticDocument } from './testFixtures';
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); URL.createObjectURL = vi.fn(() => 'blob:controlled-preview'); URL.revokeObjectURL = vi.fn(); });
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
it('inserts only the acknowledged uploaded image and saves its canonical reference with the new CAS revision', async () => {
  const url = '/api/task-workspaces/workspace/documents/doc/attachments/image/content';
  const upload = vi.fn().mockResolvedValue({ imageUri: url, documentRevision: 2, attachment: { id: 'image', documentId: 'doc', fileName: 'synthetic.png', mimeType: 'image/png', size: 12, sha256: 'synthetic-hash', status: 'ready', createdAt: '2026-10-15T12:00:00Z' } });
  const save = vi.fn(async draft => syntheticDocument({ revision: 3, markdown: draft.markdown }));
  const view = render(<WorkspaceDocumentEditor document={syntheticDocument()} datasetId="dataset" datasetEpoch="epoch" onSave={save} onReload={vi.fn()} onUpload={upload} />);
  await waitFor(() => expect(view.container.querySelector('[data-editor-ready]')).toHaveAttribute('data-editor-ready', 'true'));
  fireEvent.change(screen.getByLabelText('上传工作区图片'), { target: { files: [new File(['synthetic'], 'synthetic.png', { type: 'image/png' })] } });
  await waitFor(() => expect(view.container.querySelector('img[data-editor-image]')).toHaveAttribute('src', 'blob:controlled-preview'));
  fireEvent.click(screen.getByRole('button', { name: '保存文档' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ baseRevision: 2, markdown: expect.stringContaining(url) })));
});

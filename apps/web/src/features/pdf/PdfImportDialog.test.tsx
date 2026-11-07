import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Note } from '@study-accelerator/web-core';
import { PdfImportDialog } from './PdfImportDialog';
import { importPdf } from './pdfApi';

const state = vi.hoisted(() => ({
  serverData: { currentSpaceId: 'space-a' },
  navigation: { selectedFolderId: null },
  canWriteWorkspace: () => true,
  loadWorkspace: vi.fn<() => Promise<void>>()
}));
vi.mock('../../store/AppStoreProvider', () => ({
  useAppStore: (select: (value: typeof state) => unknown) => select(state)
}));
vi.mock('./pdfApi', async importOriginal => ({
  ...(await importOriginal<typeof import('./pdfApi')>()),
  importPdf: vi.fn()
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
const imported = { id: 'imported-pdf' } as Note;
const upload = vi.mocked(importPdf);
function mount() {
  const onClose = vi.fn();
  const onImported = vi.fn((id: string) => {
    window.location.hash = `/notes/${id}`;
  });
  const view = render(<PdfImportDialog onClose={onClose} onImported={onImported} />);
  fireEvent.change(screen.getByLabelText('选择 PDF'), {
    target: { files: [new File(['%PDF-synthetic'], 'synthetic.pdf', { type: 'application/pdf' })] }
  });
  fireEvent.click(screen.getByRole('button', { name: '导入并打开' }));
  return { ...view, onClose, onImported };
}

beforeEach(() => {
  state.serverData.currentSpaceId = 'space-a';
  state.loadWorkspace.mockReset();
  state.loadWorkspace.mockResolvedValue(undefined);
  upload.mockReset();
  upload.mockResolvedValue(imported);
  window.location.hash = '/notes';
});
afterEach(cleanup);

it.each(['取消', '关闭对话框'])('刷新资料库期间点击%s，迟到完成不改变路由', async name => {
  const refresh = deferred<void>();
  state.loadWorkspace.mockReturnValue(refresh.promise);
  const view = mount();
  await waitFor(() => expect(state.loadWorkspace).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name }));
  expect(view.onClose).toHaveBeenCalledOnce();
  await act(async () => refresh.resolve());
  expect(view.onImported).not.toHaveBeenCalled();
  expect(view.onClose).toHaveBeenCalledOnce();
  expect(window.location.hash).toBe('#/notes');
});

it('刷新期间卸载后不打开迟到的 PDF', async () => {
  const refresh = deferred<void>();
  state.loadWorkspace.mockReturnValue(refresh.promise);
  const view = mount();
  await waitFor(() => expect(state.loadWorkspace).toHaveBeenCalledOnce());
  view.unmount();
  await act(async () => refresh.resolve());
  expect(view.onImported).not.toHaveBeenCalled();
  expect(window.location.hash).toBe('#/notes');
});

it('刷新期间切换空间，迟到完成不覆盖新路由', async () => {
  const refresh = deferred<void>();
  state.loadWorkspace.mockReturnValue(refresh.promise);
  const view = mount();
  await waitFor(() => expect(state.loadWorkspace).toHaveBeenCalledOnce());
  state.serverData.currentSpaceId = 'space-b';
  view.rerender(<PdfImportDialog onClose={view.onClose} onImported={view.onImported} />);
  window.location.hash = '/spaces/space-b';
  await act(async () => refresh.resolve());
  expect(view.onImported).not.toHaveBeenCalled();
  expect(window.location.hash).toBe('#/spaces/space-b');
});

it('上传期间取消后忽略迟到结果，不刷新也不跳转', async () => {
  const request = deferred<Note>();
  upload.mockReturnValue(request.promise);
  const view = mount();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await act(async () => request.resolve(imported));
  expect(upload.mock.calls[0][2].aborted).toBe(true);
  expect(state.loadWorkspace).not.toHaveBeenCalled();
  expect(view.onImported).not.toHaveBeenCalled();
  expect(window.location.hash).toBe('#/notes');
});

it('正常导入等待刷新完成后只打开一次', async () => {
  const refresh = deferred<void>();
  state.loadWorkspace.mockReturnValue(refresh.promise);
  const view = mount();
  await waitFor(() => expect(state.loadWorkspace).toHaveBeenCalledOnce());
  expect(view.onImported).not.toHaveBeenCalled();
  await act(async () => refresh.resolve());
  expect(view.onImported).toHaveBeenCalledExactlyOnceWith('imported-pdf');
  expect(view.onClose).toHaveBeenCalledOnce();
  expect(window.location.hash).toBe('#/notes/imported-pdf');
});

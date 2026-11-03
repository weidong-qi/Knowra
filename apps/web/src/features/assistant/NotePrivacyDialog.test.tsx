import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Note } from '@study-accelerator/web-core';
import { NotePrivacyDialog } from './NotePrivacyDialog';
const state = vi.hoisted(() => ({ canWrite: true, canWriteWorkspace: () => state.canWrite, setNoteAiVisibility: vi.fn() }));
vi.mock('../../store/AppStoreProvider', () => ({ useAppStoreApi: () => ({ getState: () => state }), useAppStore: (select: (s: typeof state) => unknown) => select(state) }));
const note = { id: 'note', title: '私人资料', updatedAt: 'version-1', aiVisibility: 'normal' } as Note;
beforeEach(() => { vi.resetAllMocks(); state.canWrite = true; state.setNoteAiVisibility.mockResolvedValue(undefined); });
it('改为私密前说明普通不公开、历史残留与无法收回，确认调用版本CAS', async () => {
  const close = vi.fn(); render(<NotePrivacyDialog note={note} isOpen onOpenChange={close} />);
  expect(screen.getByText(/普通不代表公开共享/)).toBeInTheDocument(); expect(screen.getByText(/已经发送的内容无法收回/)).toBeInTheDocument();
  expect(state.setNoteAiVisibility).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: '设为私密' }));
  await waitFor(() => expect(close).toHaveBeenCalledWith(false));
  expect(state.setNoteAiVisibility).toHaveBeenCalledWith('note', { aiVisibility: 'private', expectedUpdatedAt: 'version-1' });
});
it('版本冲突显示错误并保留确认界面', async () => {
  state.setNoteAiVisibility.mockRejectedValue(new Error('笔记版本已变化，请刷新'));
  const close = vi.fn(); render(<NotePrivacyDialog note={note} isOpen onOpenChange={close} />);
  fireEvent.click(screen.getByRole('button', { name: '设为私密' })); expect(await screen.findByRole('alert')).toHaveTextContent('笔记版本已变化');
  expect(close).not.toHaveBeenCalled();
});
it('只读和缺少版本信息不能提交', async () => {
  state.canWrite = false; const view = render(<NotePrivacyDialog note={note} isOpen onOpenChange={vi.fn()} />);
  expect(screen.getByRole('button', { name: '设为私密' })).toBeDisabled(); state.canWrite = true;
  view.rerender(<NotePrivacyDialog note={{ ...note, updatedAt: undefined }} isOpen onOpenChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '设为私密' })); expect(await screen.findByRole('alert')).toHaveTextContent('缺少版本信息');
  expect(state.setNoteAiVisibility).not.toHaveBeenCalled();
});

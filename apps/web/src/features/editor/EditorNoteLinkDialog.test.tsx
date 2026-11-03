import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import { EditorNoteLinkDialog } from './EditorNoteLinkDialog';

it('搜索限定当前空间，保留显示文本，取消不写并可选择同名目标', async () => {
  const apply = vi.fn().mockResolvedValue(undefined), close = vi.fn();
  const search = vi.fn().mockResolvedValue([{ id: 'target-a', title: '同名', folderId: 'a', snippet: '' }, { id: 'target-b', title: '同名', folderId: 'b', snippet: '' }]);
  const props = { session: { document: {}, from: 1, to: 3, label: '原文字' }, spaceId: 'current-space',
    search, folderPath: (id: string | null) => id ?? '', canWrite: true, onApply: apply, onClose: close };
  const { unmount } = render(<EditorNoteLinkDialog {...props} />);
  await waitFor(() => expect(search).toHaveBeenCalledWith({ query: '', spaceId: 'current-space' }));
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(apply).not.toHaveBeenCalled(); expect(close).toHaveBeenCalled();
  unmount();
  render(<EditorNoteLinkDialog {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: '同名 · b' }));
  fireEvent.click(screen.getByRole('button', { name: '确认' }));
  await waitFor(() => expect(apply).toHaveBeenCalledWith('target-b', '原文字'));
});

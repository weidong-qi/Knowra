import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditorDocumentHeader } from './EditorDocumentHeader';

const folder = { id: 'folder-1', name: '产品设计', parentId: null, children: [] };
const note = {
  id: 'note-1',
  title: '原始标题',
  folderId: 'folder-1',
  tagIds: [],
  internalLinks: [],
  rawMarkdown: '',
  contentLoaded: true,
  favorite: false,
  deleted: false,
  status: 'draft',
  updatedAt: '2026-08-29T08:00:00.000Z'
};

describe('EditorDocumentHeader', () => {
  it('saves a trimmed title on Enter', async () => {
    const onRenameNote = vi.fn().mockResolvedValue(undefined);
    render(<EditorDocumentHeader note={note} folder={folder} canWrite onRenameNote={onRenameNote} />);

    const input = screen.getByRole('textbox', { name: '笔记标题' });
    fireEvent.change(input, { target: { value: '  新标题  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onRenameNote).toHaveBeenCalledWith('新标题'));
  });

  it('restores the original title on Escape without saving', () => {
    const onRenameNote = vi.fn();
    render(<EditorDocumentHeader note={note} folder={folder} canWrite onRenameNote={onRenameNote} />);

    const input = screen.getByRole('textbox', { name: '笔记标题' });
    fireEvent.change(input, { target: { value: '不保存的标题' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(input).toHaveValue('原始标题');
    expect(onRenameNote).not.toHaveBeenCalled();
  });

  it('rejects an empty title and exposes an inline error', async () => {
    const onRenameNote = vi.fn();
    render(<EditorDocumentHeader note={note} folder={folder} canWrite onRenameNote={onRenameNote} />);

    const input = screen.getByRole('textbox', { name: '笔记标题' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);

    expect(input).toHaveValue('原始标题');
    expect(await screen.findByRole('alert')).toHaveTextContent('标题不能为空，已恢复原标题');
    expect(onRenameNote).not.toHaveBeenCalled();
  });

  it('keeps the draft visible when saving fails so it can be retried', async () => {
    const onRenameNote = vi.fn().mockRejectedValue(new Error('网络错误'));
    render(<EditorDocumentHeader note={note} folder={folder} canWrite onRenameNote={onRenameNote} />);

    const input = screen.getByRole('textbox', { name: '笔记标题' });
    fireEvent.change(input, { target: { value: '待重试标题' } });
    fireEvent.blur(input);

    expect(await screen.findByRole('alert')).toHaveTextContent('网络错误');
    expect(input).toHaveValue('待重试标题');
  });

  it('is read-only outside backend online mode', () => {
    render(<EditorDocumentHeader note={note} folder={folder} canWrite={false} onRenameNote={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: '笔记标题' })).toHaveAttribute('readonly');
  });

  it('标题含公式时失焦渲染公式，聚焦后回到源码编辑', async () => {
    const { container } = render(<EditorDocumentHeader note={{ ...note, title: '证明 $x^2$' }} folder={folder} canWrite onRenameNote={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('.katex')).toBeInTheDocument());
    const input = screen.getByRole('textbox', { name: '笔记标题' });
    expect(input).toHaveValue('证明 $x^2$');
    fireEvent.focus(input);
    await waitFor(() => expect(container.querySelector('.katex')).toBeNull());
  });
});

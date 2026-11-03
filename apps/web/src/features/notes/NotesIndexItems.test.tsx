import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyWorkspaceSnapshot, type Note, type WorkspaceApi } from '@study-accelerator/web-core';
import { AppStoreProvider } from '../../store/AppStoreProvider';
import { createAppStore } from '../../store/createAppStore';
import { IndexTile, NotesTable } from './NotesIndexItems';
import { ItemFavorite, notePreview } from './NotesIndexItemMeta';
import { NotesIndexArt } from './NotesIndexArt';
import { formatUpdatedAt } from './notesIndexModel';
import { DEFAULT_DISPLAY_PROPERTIES } from './notesIndexPresentation';

const note: Note = { id: 'note', title: '真实笔记', folderId: null, rawMarkdown: '# 研究\n正文 **重点** [链接](https://example.com)', tagIds: ['tag'], internalLinks: [], favorite: true, deleted: false, contentLoaded: true, status: 'draft' };
const tags = [{ id: 'tag', name: '研究', color: 'blue' as const }, { id: 'other', name: '不相关', color: 'red' as const }];
function tileProps(overrides: Partial<ComponentProps<typeof IndexTile>> = {}): ComponentProps<typeof IndexTile> {
  return { item: { kind: 'note', note }, notes: [note], selectedNoteId: null, onSelectFolder: vi.fn(), onSelectNote: vi.fn(), isRecycleView: false, recyclePendingId: null, onRestore: vi.fn(), onRequestPermanentDelete: vi.fn(), selectionMode: false, selected: false, onToggleSelection: vi.fn(), canWrite: true, onItemAction: vi.fn(), view: 'card', tags, ...overrides };
}
function mount(ui: ReactNode) {
  const dependencies = { api: {} as WorkspaceApi, cacheKey: 'index-items', mockSnapshot: createEmptyWorkspaceSnapshot() };
  const store = createAppStore(dependencies);
  store.setState({ dataMode: 'api', workspaceLoadState: 'ready' });
  return render(<AppStoreProvider dependencies={dependencies} store={store}>{ui}</AppStoreProvider>);
}

describe('Notes index item views', () => {
  it.each(['list', 'grid', 'card'] as const)('主按钮名称只包含标题，日期独立作为描述（%s）', async view => {
    const dated = { ...note, updatedAt: '2026-08-31T02:32:00.000Z' };
    const props = tileProps({ item: { kind: 'note', note: dated }, view: view === 'list' ? 'grid' : view });
    const { container } = mount(view === 'list'
      ? <NotesTable {...props} items={[props.item]} selectedNoteIds={new Set()} foldersById={{}} />
      : <IndexTile {...props} />);
    const primary = screen.getByRole('button', { name: '真实笔记' });
    expect(primary).toHaveAttribute('data-index-primary');
    expect(primary).toHaveAccessibleDescription(expect.stringContaining('最近更新'));
    expect(primary.getAttribute('aria-description')).toContain(formatUpdatedAt(dated.updatedAt));
    expect(container.textContent).toContain(formatUpdatedAt(dated.updatedAt));
    await userEvent.click(primary);
    expect(props.onSelectNote).toHaveBeenCalledExactlyOnceWith('note');
  });

  it('关闭日期属性不改变主按钮名称，也不读出隐藏日期', () => {
    mount(<IndexTile {...tileProps({ properties: { ...DEFAULT_DISPLAY_PROPERTIES, updated: false } })} />);
    const primary = screen.getByRole('button', { name: '真实笔记' });
    expect(primary.getAttribute('aria-description')).not.toContain('最近更新');
  });

  it('opens a real card and renders only its associated tags and plain preview', async () => {
    const props = tileProps();
    const { container } = mount(<IndexTile {...props} />);
    await userEvent.click(screen.getByRole('button', { name: '真实笔记' }));
    expect(props.onSelectNote).toHaveBeenCalledWith('note');
    expect(screen.getByText('研究 正文 重点 链接')).toBeInTheDocument();
    expect(screen.getByText('研究', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByText('不相关')).not.toBeInTheDocument();
    expect(container.querySelector('[data-art-kind="document"]')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('button button')).toBeNull();
  });

  it('keeps card keyboard context menus and read-only action protections', async () => {
    mount(<IndexTile {...tileProps({ canWrite: false })} />);
    const card = screen.getByRole('button', { name: '真实笔记' });
    expect(card).toHaveAttribute('draggable', 'false');
    fireEvent.keyDown(card, { key: 'F10', shiftKey: true });
    expect(await screen.findByRole('menu')).toHaveAttribute('aria-label', '真实笔记笔记操作');
    expect(screen.getByRole('menuitem', { name: '删除' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('uses selection instead of opening the note in selection mode', async () => {
    const props = tileProps({ selectionMode: true });
    mount(<IndexTile {...props} />);
    await userEvent.click(screen.getByRole('button', { name: '真实笔记' }));
    expect(props.onToggleSelection).toHaveBeenCalledWith('note', true);
    expect(props.onSelectNote).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: '选择真实笔记' })).toBeInTheDocument();
  });

  it('offers direct selection before entering batch mode and hides it in read-only and trash views', async () => {
    const props = tileProps();
    const { unmount } = mount(<IndexTile {...props} />);
    await userEvent.click(screen.getByRole('checkbox', { name: '选择真实笔记' }));
    expect(props.onToggleSelection).toHaveBeenCalledWith('note', true);
    expect(props.onSelectNote).not.toHaveBeenCalled();
    unmount();
    const readOnly = mount(<IndexTile {...tileProps({ canWrite: false })} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    readOnly.unmount();
    mount(<IndexTile {...tileProps({ isRecycleView: true, item: { kind: 'note', note: { ...note, deleted: true } } })} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('retains list table semantics, real metadata and independent open actions', async () => {
    const props = tileProps();
    mount(<NotesTable {...props} items={[props.item]} selectedNoteIds={new Set()} foldersById={{}} properties={DEFAULT_DISPLAY_PROPERTIES} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('table').querySelectorAll('colgroup > col')).toHaveLength(7);
    expect(screen.getByRole('columnheader', { name: '标签' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '选择真实笔记' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '真实笔记' }));
    expect(props.onSelectNote).toHaveBeenCalledWith('note');
  });

  it('never interprets raw source markup or emits HTML in a preview', () => {
    const unsafe = { ...note, summary: '<img src=x onerror=alert(1)>实际内容<script>alert(1)</script>' };
    const { container } = mount(<IndexTile {...tileProps({ item: { kind: 'note', note: unsafe } })} />);
    expect(container.querySelector('img, script')).toBeNull();
    expect(notePreview(unsafe)).toContain('实际内容');
    expect(notePreview({ ...note, summary: '  ', plainText: '保存的纯文本' })).toBe('保存的纯文本');
  });

  it('gives every folder its own gradient and removes extra paper in plain mode', () => {
    const item = { kind: 'folder' as const, folder: { id: 'folder', name: '资料', parentId: null, children: [] } };
    const { container, rerender } = render(<><NotesIndexArt item={item} noteCount={1} /><NotesIndexArt item={item} noteCount={1} /></>);
    const gradients = [...container.querySelectorAll('linearGradient')];
    expect(gradients).toHaveLength(2);
    expect(gradients[0].id).not.toBe(gradients[1].id);
    gradients.forEach(gradient => {
      expect(gradient.querySelectorAll('stop')).toHaveLength(2);
      expect(container.querySelector(`[fill="url(#${gradient.id})"]`)).not.toBeNull();
    });
    expect(container.querySelectorAll('[data-folder-paper]')).toHaveLength(2);
    rerender(<><NotesIndexArt item={item} noteCount={2} /><NotesIndexArt item={item} noteCount={8} /><NotesIndexArt item={item} /></>);
    expect(container.querySelectorAll('[data-folder-paper]')).toHaveLength(1 + 3 + 0);
  });

  it('always renders the favorite emphasis', () => {
    render(<ItemFavorite />);
    expect(screen.getByLabelText('已收藏')).toBeInTheDocument();
  });

});

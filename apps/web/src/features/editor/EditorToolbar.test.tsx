import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EditorToolbar } from './EditorToolbar';

const props = {
  toolbarRef: { current: null },
  pinned: false,
  canWrite: true,
  canEditContent: true,
  favorite: false,
  inspectorOpen: false,
  favoritePending: false,
  view: { mode: 'edit', modeBeforeFocus: null, showLeftSidebar: true, showRightSidebar: false, showSourceEditor: false, contentMode: 'edit', preferredShowLeftSidebar: true, preferredShowRightSidebar: false },
  onRunCommand: vi.fn(),
  onEditAction: vi.fn(),
  onViewAction: vi.fn(),
  onFileAction: vi.fn(),
  onToggleFavorite: vi.fn(),
  onToggleInspector: vi.fn(),
  onInsertImage: vi.fn()
} as unknown as Parameters<typeof EditorToolbar>[0];

describe('EditorToolbar 菜单', () => {
  it('鼠标悬停菜单按钮即可打开，移到另一个按钮时切换，移走后关闭', async () => {
    const user = userEvent.setup();
    render(<EditorToolbar {...props} />);
    await user.hover(screen.getByRole('button', { name: '文件' }));
    expect(await screen.findByRole('menu', { name: '文件' })).toBeVisible();
    await user.hover(screen.getByRole('button', { name: '编辑' }));
    expect(await screen.findByRole('menu', { name: '编辑' })).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('menu', { name: '文件' })).not.toBeInTheDocument());
    await user.unhover(screen.getByRole('button', { name: '编辑' }));
    await waitFor(() => expect(screen.queryByRole('menu', { name: '编辑' })).not.toBeInTheDocument());
  });

  it('点击仍然可以打开菜单', async () => {
    const user = userEvent.setup();
    render(<EditorToolbar {...props} />);
    await user.click(screen.getByRole('button', { name: '视图' }));
    expect(await screen.findByRole('menu', { name: '视图' })).toBeVisible();
  });

  it('悬停并固定后，Esc 一次就能关闭', async () => {
    const user = userEvent.setup();
    render(<EditorToolbar {...props} />);
    await user.click(screen.getByRole('button', { name: '文件' }));
    expect(await screen.findByRole('menu', { name: '文件' })).toBeVisible();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu', { name: '文件' })).not.toBeInTheDocument());
  });
});

it('悬停已打开后按下固定，移出超过悬停关闭时间仍可选择菜单项', async () => {
  const user = userEvent.setup();
  const onFileAction = vi.fn();
  render(<EditorToolbar {...props} onFileAction={onFileAction} />);
  const trigger = screen.getByRole('button', { name: '文件' });
  await user.hover(trigger);
  await screen.findByRole('menu', { name: '文件' });
  await user.click(trigger);
  await user.unhover(trigger);
  await new Promise(resolve => setTimeout(resolve, 250));
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await user.click(screen.getByRole('menuitem', { name: '导入 Markdown' }));
  expect(onFileAction).toHaveBeenCalledWith('import-markdown');
  await waitFor(() => expect(screen.queryByRole('menu', { name: '文件' })).not.toBeInTheDocument());
});

it('文件固定后悬停编辑只保留一个展开菜单', async () => {
  const user = userEvent.setup();
  render(<EditorToolbar {...props} />);
  const file = screen.getByRole('button', { name: '文件' });
  const edit = screen.getByRole('button', { name: '编辑' });
  await user.click(file);
  await user.hover(edit);
  await waitFor(() => expect(screen.getAllByRole('menu')).toHaveLength(1));
  expect(screen.getByRole('menu', { name: '编辑' })).toBeVisible();
  expect(file).toHaveAttribute('aria-expanded', 'false');
  expect(edit).toHaveAttribute('aria-expanded', 'true');
});

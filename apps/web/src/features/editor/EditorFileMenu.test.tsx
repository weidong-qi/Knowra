import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PressableButton } from '../../components/ui/button';
import { Menu, MenuPopover, MenuTrigger } from '../../components/ui/overlay';
import { renderEditorFileMenu } from './EditorFileMenu';

function renderFileMenu(onAction = vi.fn(), canWrite = true) {
  render(
    <MenuTrigger>
      <PressableButton>文件</PressableButton>
      <MenuPopover>
        <Menu ariaLabel="文件菜单">
          {renderEditorFileMenu({ canWrite, favorite: false, onAction })}
        </Menu>
      </MenuPopover>
    </MenuTrigger>
  );
  return onAction;
}

describe('EditorFileMenu', () => {
  it('exposes imported and newly completed file actions', async () => {
    const user = userEvent.setup();
    const onAction = renderFileMenu();
    await user.click(screen.getByRole('button', { name: '文件' }));

    expect(screen.getByRole('menuitem', { name: '新建笔记' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: '新建文件夹' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: '导入 Markdown' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: '保存' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: '另存为' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: '重命名' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: '收藏笔记' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: '删除' })).toHaveAttribute('data-danger', 'true');
    expect(screen.getByRole('menuitem', { name: '导出 Markdown' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: '导出 PDF' })).toBeEnabled();

    await user.click(screen.getByRole('menuitem', { name: '另存为' }));
    expect(onAction).toHaveBeenCalledWith('save-as');
  });

  it('keeps download actions available in read-only recovery mode', async () => {
    const user = userEvent.setup();
    renderFileMenu(vi.fn(), false);
    await user.click(screen.getByRole('button', { name: '文件' }));

    expect(screen.getByRole('menuitem', { name: '保存' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: '删除' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: '导入 Markdown' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: '导出 Markdown' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: '导出 PDF' })).toBeEnabled();
  });
});

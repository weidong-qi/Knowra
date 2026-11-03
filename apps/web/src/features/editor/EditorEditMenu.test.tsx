import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PressableButton } from '../../components/ui/button';
import { Menu, MenuPopover, MenuTrigger } from '../../components/ui/overlay';
import { renderEditorEditMenu } from './EditorEditMenu';

function renderMenu(canWrite = true, onAction = vi.fn()) {
  render(
    <MenuTrigger>
      <PressableButton>编辑</PressableButton>
      <MenuPopover><Menu ariaLabel="编辑菜单">{renderEditorEditMenu({ canWrite, onAction })}</Menu></MenuPopover>
    </MenuTrigger>
  );
  return onAction;
}

describe('EditorEditMenu', () => {
  it('exposes the complete migrated edit command set and shortcuts', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole('button', { name: '编辑' }));
    for (const label of ['撤销', '重做', '剪切', '复制', '粘贴', '查找', '替换', '全选', '检查异常格式']) {
      expect(screen.getByRole('menuitem', { name: label })).toBeEnabled();
    }
    expect(screen.getByRole('menuitem', { name: '撤销' })).toHaveTextContent('Ctrl+Z');
    expect(screen.getByRole('menuitem', { name: '粘贴' })).toHaveTextContent('Ctrl+V');
  });

  it('keeps read-only discovery actions available while disabling mutations', async () => {
    const user = userEvent.setup();
    renderMenu(false);
    await user.click(screen.getByRole('button', { name: '编辑' }));
    expect(screen.getByRole('menuitem', { name: '剪切' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: '粘贴' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: '替换' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: '检查异常格式' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: '复制' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: '查找' })).toBeEnabled();
  });

  it('dispatches the selected edit action', async () => {
    const user = userEvent.setup();
    const onAction = renderMenu();
    await user.click(screen.getByRole('button', { name: '编辑' }));
    await user.click(screen.getByRole('menuitem', { name: '全选' }));
    expect(onAction).toHaveBeenCalledWith('select-all');
  });
});

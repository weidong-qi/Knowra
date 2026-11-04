import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PressableButton } from '../../components/ui/button';
import { Menu, MenuPopover, MenuTrigger } from '../../components/ui/overlay';
import { renderEditorViewMenu } from './EditorViewMenu';
import { getEffectiveEditorViewState, initialEditorViewState } from './editorViewState';
import styles from './EditorViewMenu.module.css';

describe('EditorViewMenu', () => {
  it('renders all migrated view commands and exposes current states', async () => {
    const user = userEvent.setup();
    render(
      <MenuTrigger>
        <PressableButton>视图</PressableButton>
        <MenuPopover><Menu ariaLabel="视图菜单">{renderEditorViewMenu({
          view: getEffectiveEditorViewState(initialEditorViewState),
          onAction: vi.fn()
        })}</Menu></MenuPopover>
      </MenuTrigger>
    );
    await user.click(screen.getByRole('button', { name: '视图' }));
    for (const label of ['阅读模式', '编辑模式', '专注模式', '隐藏左侧目录区', '显示右侧辅助区', '显示源码编辑器']) {
      expect(screen.getByRole('menuitem', { name: label })).toBeEnabled();
    }
    expect(screen.getByRole('menuitem', { name: '编辑模式' })).toHaveClass(styles.active);
    expect(screen.getByRole('menuitem', { name: '编辑模式' })).toHaveAccessibleDescription('当前已启用');
    expect(screen.getByRole('menuitem', { name: '隐藏左侧目录区' })).toHaveClass(styles.active);
  });

  it('dispatches the selected action', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <MenuTrigger>
        <PressableButton>视图</PressableButton>
        <MenuPopover><Menu ariaLabel="视图菜单">{renderEditorViewMenu({
          view: getEffectiveEditorViewState(initialEditorViewState), onAction
        })}</Menu></MenuPopover>
      </MenuTrigger>
    );
    await user.click(screen.getByRole('button', { name: '视图' }));
    await user.click(screen.getByRole('menuitem', { name: '专注模式' }));
    expect(onAction).toHaveBeenCalledWith('mode-focus');
  });
});

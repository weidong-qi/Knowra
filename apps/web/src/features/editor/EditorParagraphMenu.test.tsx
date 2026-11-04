import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PressableButton } from '../../components/ui/button';
import { Menu, MenuPopover, MenuTrigger } from '../../components/ui/overlay';
import { renderEditorParagraphMenu } from './EditorParagraphMenu';

function renderParagraphMenu(onCommand = vi.fn()) {
  render(
    <MenuTrigger>
      <PressableButton>段落</PressableButton>
      <MenuPopover>
        <Menu ariaLabel="段落菜单">
          {renderEditorParagraphMenu({ onCommand })}
        </Menu>
      </MenuPopover>
    </MenuTrigger>
  );
  return onCommand;
}

describe('EditorParagraphMenu', () => {
  it('exposes every migrated paragraph action with reference shortcuts', async () => {
    const user = userEvent.setup();
    renderParagraphMenu();
    await user.click(screen.getByRole('button', { name: '段落' }));

    for (const label of [
      '正文', 'H1', 'H2', 'H3', 'H4',
      '无序列表', '有序列表', '任务列表',
      '引用块', '代码块', '公式块', '分割线', '表格'
    ]) {
      expect(screen.getByRole('menuitem', { name: label })).toBeEnabled();
    }
    expect(screen.getByRole('menuitem', { name: '正文' })).toHaveTextContent('Ctrl+0');
    expect(screen.getByRole('menuitem', { name: 'H4' })).toHaveTextContent('Ctrl+4');
    expect(screen.getByRole('menuitem', { name: '任务列表' })).toHaveTextContent('Ctrl+Shift+X');
  });

  it('dispatches the selected editor command', async () => {
    const user = userEvent.setup();
    const onCommand = renderParagraphMenu();
    await user.click(screen.getByRole('button', { name: '段落' }));
    await user.click(screen.getByRole('menuitem', { name: '代码块' }));
    expect(onCommand).toHaveBeenCalledWith('code-block');
  });
});

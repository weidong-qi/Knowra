/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Button } from '../components/ui/button/Button';
import { Menu, MenuItem, MenuPopover, MenuTrigger } from '../components/ui/overlay/Menu';
import { PointMenu } from '../components/ui/overlay/PointMenu';

// 取 global.css 中全局焦点环规则的选择器列表，按真实选择器判断元素是否会被画环。
const globalCss = readFileSync('src/styles/global.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const ringRule = globalCss.split('}').find(block => block.includes('box-shadow: var(--focus-ring)')) ?? '';
const ringSelectors = ringRule
  .split('{')[0]
  .split(/,\s*\n/)
  .map(selector => selector.trim())
  .filter(Boolean);

function hasFocusRing(element: Element | null) {
  if (!element) return false;
  return ringSelectors.some(selector => {
    try {
      return element.matches(selector);
    } catch {
      // jsdom 不支持 :focus-visible 时，非 React Aria 分支在此无法判定；本测试只覆盖 React Aria 元素。
      return false;
    }
  });
}

function TriggerMenu() {
  return (
    <MenuTrigger>
      <Button>文件</Button>
      <MenuPopover>
        <Menu ariaLabel="文件菜单">
          <MenuItem id="new">新建笔记</MenuItem>
          <MenuItem id="save">保存</MenuItem>
        </Menu>
      </MenuPopover>
    </MenuTrigger>
  );
}

function ContextMenuHarness() {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <div
        contentEditable
        suppressContentEditableWarning
        data-testid="editor"
        onContextMenu={event => {
          event.preventDefault();
          setPoint({ x: event.clientX, y: event.clientY });
        }}
      >
        正文
      </div>
      <PointMenu point={point} onOpenChange={open => !open && setPoint(null)}>
        <Menu ariaLabel="编辑器右键快捷功能" onAction={() => setPoint(null)}>
          <MenuItem id="bold">加粗</MenuItem>
          <MenuItem id="annotate">标记为重要内容</MenuItem>
        </Menu>
      </PointMenu>
    </>
  );
}

describe('全局焦点环只跟随键盘模态', () => {
  it('规则对 React Aria 元素读取 data-focus-visible，而不是浏览器 :focus-visible', () => {
    expect(ringSelectors).toEqual([
      ":where(button, [role='button'], a, [tabindex]):where(:not([data-rac])):focus-visible",
      ":where(button, [role='button'], a, [tabindex]):where([data-rac])[data-focus-visible]"
    ]);
  });

  it('打字后再用鼠标右键打开坐标菜单，浮层容器和菜单项都不画焦点环', async () => {
    const user = userEvent.setup();
    render(<ContextMenuHarness />);
    const editor = screen.getByTestId('editor');
    await user.click(editor);
    await user.keyboard('继续输入{Shift}');
    await user.pointer({ keys: '[MouseRight]', target: editor });

    const menu = await screen.findByRole('menu', { name: '编辑器右键快捷功能' });
    const popover = menu.closest('[role="dialog"]');
    expect(popover).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(popover));
    expect(hasFocusRing(document.activeElement)).toBe(false);
    expect(hasFocusRing(popover)).toBe(false);
    for (const item of screen.getAllByRole('menuitem')) expect(hasFocusRing(item)).toBe(false);
  });

  it('按过任意键后用鼠标点击打开菜单，自动聚焦的菜单项不画焦点环', async () => {
    const user = userEvent.setup();
    render(<TriggerMenu />);
    await user.keyboard('{Shift}');
    await user.click(screen.getByRole('button', { name: '文件' }));

    const menu = await screen.findByRole('menu');
    await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    expect(hasFocusRing(document.activeElement)).toBe(false);
    for (const item of screen.getAllByRole('menuitem')) expect(hasFocusRing(item)).toBe(false);
  });

  it('用键盘打开菜单时，触发器和当前菜单项仍画焦点环', async () => {
    const user = userEvent.setup();
    render(<TriggerMenu />);
    await user.tab();
    const trigger = screen.getByRole('button', { name: '文件' });
    expect(hasFocusRing(trigger)).toBe(true);

    await user.keyboard('{Enter}');
    await screen.findByRole('menu');
    await waitFor(() => expect(document.activeElement).toHaveAttribute('role', 'menuitem'));
    expect(hasFocusRing(document.activeElement)).toBe(true);

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toHaveTextContent('保存');
    expect(hasFocusRing(document.activeElement)).toBe(true);
  });
});

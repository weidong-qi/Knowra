import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, Menu, MenuItem, MenuPopover, MenuSeparator, MenuTrigger, PressableButton } from '../index';
import styles from './Overlay.module.css';

describe('V4-04 Menu', () => {
  it('keeps rich item names separate from their accessible descriptions', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<MenuTrigger><Button>新建</Button><MenuPopover>
      <Menu ariaLabel="新建选项" variant="rich" onAction={onAction}>
        <MenuItem id="folder" textValue="新建文件夹" description="在当前位置创建">新建文件夹</MenuItem>
      </Menu>
    </MenuPopover></MenuTrigger>);
    await user.click(screen.getByRole('button', { name: '新建' }));
    const item = await screen.findByRole('menuitem', { name: '新建文件夹' });
    expect(item).toHaveAccessibleDescription('在当前位置创建');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onAction.mock.calls.map(([key]) => key)).toEqual(['folder']);
  });

  it('toggles the menu between closed and open via the trigger', async () => {
    const user = userEvent.setup();
    render(
      <MenuTrigger>
        <Button>操作</Button>
        <Menu ariaLabel="操作">
          <MenuItem id="copy">复制</MenuItem>
          <MenuItem id="export">导出</MenuItem>
        </Menu>
      </MenuTrigger>
    );

    // 关闭状态：trigger aria-expanded=false；菜单容器已挂载但 menuitem 处于未激活态。
    const trigger = screen.getByRole('button', { name: '操作' });
    expect(trigger).toHaveAttribute('aria-haspopup');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: '操作' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  });

  it('marks separator with role="separator" when the menu is open', async () => {
    const user = userEvent.setup();
    render(
      <MenuTrigger>
        <Button>操作</Button>
        <Menu ariaLabel="操作">
          <MenuItem id="copy">复制</MenuItem>
          <MenuSeparator />
          <MenuItem id="delete" isDanger>删除</MenuItem>
        </Menu>
      </MenuTrigger>
    );

    await user.click(screen.getByRole('button', { name: '操作' }));
    expect(await screen.findByRole('separator')).toBeInTheDocument();
  });

  it('uses a position-only popover so the menu owns the only visible panel', async () => {
    const user = userEvent.setup();
    render(
      <MenuTrigger>
        <Button>更多</Button>
        <MenuPopover>
          <Menu ariaLabel="单层菜单">
            <MenuItem id="refresh">刷新</MenuItem>
          </Menu>
        </MenuPopover>
      </MenuTrigger>
    );

    await user.click(screen.getByRole('button', { name: '更多' }));
    expect(await screen.findByRole('menu')).toHaveClass(styles.menu);
    expect(document.querySelector(`.${styles.menuPopover}`)).toBeInTheDocument();
    expect(document.querySelector(`.${styles.popover}`)).not.toBeInTheDocument();
  });

  it('opens at a native context-menu trigger without a second panel', async () => {
    render(
      <MenuTrigger trigger="contextMenu">
        <PressableButton>目录节点</PressableButton>
        <MenuPopover placement="right top">
          <Menu ariaLabel="目录操作">
            <MenuItem id="rename">重命名</MenuItem>
          </Menu>
        </MenuPopover>
      </MenuTrigger>
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: '目录节点' }), {
      clientX: 120,
      clientY: 80
    });
    expect(await screen.findByRole('menu')).toHaveAttribute('aria-label', '目录操作');
    expect(document.querySelector(`.${styles.popover}`)).not.toBeInTheDocument();
  });

  it('marks danger items with the data-danger attribute', async () => {
    const user = userEvent.setup();
    render(
      <MenuTrigger>
        <Button>操作</Button>
        <Menu ariaLabel="操作">
          <MenuItem id="delete" isDanger>删除</MenuItem>
        </Menu>
      </MenuTrigger>
    );

    await user.click(screen.getByRole('button', { name: '操作' }));
    const item = await screen.findByRole('menuitem', { name: '删除' });
    expect(item).toHaveAttribute('data-danger', 'true');
  });

  it('exposes the keyboard hint slot in the menuitem markup', async () => {
    const user = userEvent.setup();
    render(
      <MenuTrigger>
        <Button>操作</Button>
        <Menu ariaLabel="操作">
          <MenuItem id="copy" kbd="⌘D">复制</MenuItem>
        </Menu>
      </MenuTrigger>
    );

    await user.click(screen.getByRole('button', { name: '操作' }));
    const item = await screen.findByRole('menuitem', { name: /复制/ });
    expect(item).toHaveTextContent('⌘D');
  });

  it('cleans up the menu on unmount', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <MenuTrigger>
        <Button>操作</Button>
        <Menu ariaLabel="操作">
          <MenuItem id="only">选项</MenuItem>
        </Menu>
      </MenuTrigger>
    );
    await user.click(screen.getByRole('button', { name: '操作' }));
    expect(screen.queryByRole('menu')).toBeInTheDocument();
    unmount();
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });
});

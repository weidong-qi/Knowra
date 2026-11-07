import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RouterProvider } from '../app/router';
import { ShellToolbar } from './ShellToolbar';

function ToolbarHarness({
  pathname: externalPath,
  charCount = 1,
  navigate = () => {}
}: {
  pathname?: string;
  charCount?: number;
  navigate?(to: string): void;
}) {
  const [path, setPath] = useState('/materials?folder=folder-1');
  const pathname = externalPath ?? path;
  const go = (to: string) => {
    navigate(to);
    setPath(to);
  };
  return (
    <RouterProvider location={{ pathname, navigate: go }}>
      <ShellToolbar
        status={{
          dataMode: 'api',
          charCount,
          path: pathname.includes('folder=')
            ? [
                { id: 'root', label: '笔记库', onNavigate: () => go('/materials?scope=root') },
                { id: 'folder', label: '工作', current: true }
              ]
            : [{ id: 'root', label: '笔记库', current: true }]
        }}
      />
    </RouterProvider>
  );
}

describe('ShellToolbar 状态弹层路由生命周期', () => {
  it.each(['{Enter}', ' ', 'click'])('祖先导航 %s 后关闭弹层并归还触发器焦点，重开后全局Escape可用', async action => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(<ToolbarHarness navigate={navigate} />);
    const trigger = screen.getByRole('button', { name: '工作区状态' });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: '工作区状态' });
    const parent = within(dialog).getByRole('button', { name: '跳转到「笔记库」' });
    if (action === 'click') await user.click(parent);
    else {
      parent.focus();
      await user.keyboard(action);
    }
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/materials?scope=root');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '工作区状态' })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: '工作区状态' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '工作区状态' })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('其他入口改变路由也关闭陈旧状态弹层', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ToolbarHarness pathname="/materials?folder=folder-1" />);
    const trigger = screen.getByRole('button', { name: '工作区状态' });
    await user.click(trigger);
    await screen.findByRole('dialog', { name: '工作区状态' });
    rerender(<ToolbarHarness pathname="/knowledge" />);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '工作区状态' })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('保存状态数据刷新不关闭同一路由的弹层', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ToolbarHarness charCount={1} />);
    await user.click(screen.getByRole('button', { name: '工作区状态' }));
    const dialog = await screen.findByRole('dialog', { name: '工作区状态' });
    rerender(<ToolbarHarness charCount={42} />);
    expect(screen.getByRole('dialog', { name: '工作区状态' })).toBe(dialog);
    expect(dialog).toHaveTextContent('42 字');
  });
});

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NotesIndexHeader } from './NotesIndexHeader';

describe('笔记索引路径导航', () => {
  it('保留长路径的完整说明、当前段和可键盘返回的父目录', async () => {
    const navigate = vi.fn();
    const parent = '父目录的完整名称，窄屏仍可返回';
    const current = '当前目录的完整名称，视觉可省略';
    render(<NotesIndexHeader path={[
      { id: 'root', label: '笔记库', onNavigate: vi.fn() },
      { id: 'parent', label: parent, onNavigate: navigate },
      { id: 'current', label: current }
    ]} count={4} canWrite isRecycleView={false} selectionMode={false}
      onToggleSelection={vi.fn()} onImport={vi.fn()} onCreate={vi.fn()} onOpenSpaces={vi.fn()} />);
    const trail = screen.getByRole('navigation', { name: '当前位置' });
    expect(trail).toHaveAttribute('title', `笔记库 / ${parent} / ${current}`);
    expect(within(trail).getByText(current)).toHaveAttribute('aria-current', 'page');
    within(trail).getByRole('button', { name: `跳转到「${parent}」` }).focus();
    await userEvent.setup().keyboard('{Enter}');
    expect(navigate).toHaveBeenCalledOnce();
  });
});

describe('紧凑索引路径导航', () => {
  it.each(['笔记库', '上级目录'])('更多菜单可到达%s，不重复当前目录', async label => {
    const root = vi.fn();
    const parent = vi.fn();
    const toggle = vi.fn();
    render(<NotesIndexHeader path={[
      { id: 'root', label: '笔记库', onNavigate: root },
      { id: 'parent', label: '上级目录', onNavigate: parent },
      { id: 'current', label: '当前目录', current: true, onNavigate: vi.fn() }
    ]} count={0} canWrite isRecycleView={false} selectionMode={false}
      onToggleSelection={toggle} onOpenSpaces={vi.fn()} onImport={vi.fn()} onCreate={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await user.click(screen.getByRole('menuitem', { name: '路径导航' }));
    expect(screen.queryByRole('menuitem', { name: '当前目录' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: label }));
    expect(label === '笔记库' ? root : parent).toHaveBeenCalledTimes(1);
    expect(toggle).not.toHaveBeenCalled();
  });
});

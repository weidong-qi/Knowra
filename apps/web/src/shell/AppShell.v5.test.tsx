import { useEffect, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppShell } from './AppShell';

function mockViewport(initial = false) {
  let compact = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ get matches() { return compact; }, media: '(max-width: 920px)',
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener) })));
  return (next: boolean) => act(() => { compact = next; listeners.forEach(listener => listener()); });
}
function Shell({ navigationKey = '/materials', focusMode = false }: { navigationKey?: string; focusMode?: boolean }) {
  const [open, setOpen] = useState(true);
  return <AppShell activeDomain="materials" contextSidebar={<label>导航草稿<input aria-label="导航草稿" /></label>}
    contextSidebarOpen={open} navigationKey={navigationKey} focusMode={focusMode}
    onSelectDomain={vi.fn()} onReturnHome={vi.fn()} mobileTabs
    statusbar={{ path: [{ id: 'notes', label: '笔记', current: true }], dataMode: 'cache', saveState: 'error', saveError: '磁盘不可写',
      panels: [{ id: 'sidebar', label: '侧栏', active: open, onToggle: () => setOpen(value => !value) }] }}>
      <button>正文操作</button>
    </AppShell>;
}
afterEach(() => vi.unstubAllGlobals());

describe('V5 分层外壳', () => {
  it('仅跳转链接强调主区焦点，不改变 hash 路由，进入正文后清除提示', () => {
    mockViewport(); const rendered = render(<Shell />);
    const stage = screen.getByRole('main');
    act(() => stage.focus());
    expect(stage).not.toHaveAttribute('data-skip-focused');
    const hash = window.location.hash;
    fireEvent.click(screen.getByRole('link', { name: '跳到主内容' }));
    expect(stage).toHaveFocus();
    expect(stage).toHaveAttribute('data-skip-focused', 'true');
    expect(window.location.hash).toBe(hash);
    act(() => screen.getByRole('button', { name: '正文操作' }).focus());
    expect(stage).not.toHaveAttribute('data-skip-focused');
    fireEvent.click(screen.getByRole('link', { name: '跳到主内容' }));
    rendered.rerender(<Shell navigationKey='/materials/notes/n1' />);
    expect(stage).not.toHaveAttribute('data-skip-focused');
  });
  it('窄屏专注模式隐藏侧栏开关，退出不会重开陈旧导航弹层', () => {
    mockViewport(true); const rendered = render(<Shell />);
    fireEvent.click(screen.getByRole('button', { name: '切换侧栏' }));
    expect(screen.getByRole('dialog', { name: '笔记导航' })).toBeInTheDocument();
    rendered.rerender(<Shell focusMode />);
    expect(screen.queryByRole('button', { name: '切换侧栏' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '笔记导航' })).not.toBeInTheDocument();
    rendered.rerender(<Shell />);
    expect(screen.getByRole('button', { name: '切换侧栏' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('dialog', { name: '笔记导航' })).not.toBeInTheDocument();
  });
  it('同步控制在状态浮层关闭时仍常驻，避免中断监听', async () => {
    mockViewport(); const mounted = vi.fn(); const unmounted = vi.fn();
    function SyncProbe() { useEffect(() => { mounted(); return unmounted; }, []); return <button>本地资料已同步</button>; }
    render(<AppShell activeDomain="materials" onSelectDomain={vi.fn()} onReturnHome={vi.fn()}
      statusbar={{ path: [], dataMode: 'api', persistenceMode: 'desktop-local', dataModeNote: <SyncProbe /> }}>正文</AppShell>);
    expect(mounted).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '工作区状态' }));
    const dialog = await screen.findByRole('dialog', { name: '工作区状态' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '本地资料已同步' })).toBeInTheDocument();
  });
  it('面板开关位于顶部，完整保存状态按需展开', async () => {
    mockViewport(); render(<Shell />);
    const top = screen.getByRole('banner', { name: '全局顶栏' });
    expect(within(top).getByRole('button', { name: '切换侧栏' })).toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
    fireEvent.click(within(top).getByRole('button', { name: '工作区状态' }));
    const detail = await screen.findByRole('dialog', { name: '工作区状态' });
    expect(detail).toHaveTextContent('保存失败');
    expect(detail).toHaveTextContent('缓存只读');
    expect(within(detail).getByTitle('磁盘不可写')).toBeInTheDocument();
    fireEvent.keyDown(detail, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('窄屏侧栏通过统一面板打开并保持跨断点草稿，关闭恢复焦点', async () => {
    const resize = mockViewport(true); render(<Shell />);
    const toggle = screen.getByRole('button', { name: '切换侧栏' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    toggle.focus(); fireEvent.click(toggle);
    const panel = await screen.findByRole('dialog', { name: '笔记导航' });
    fireEvent.change(within(panel).getByRole('textbox', { name: '导航草稿' }), { target: { value: '保留草稿' } });
    resize(false);
    expect(screen.queryByRole('dialog', { name: '笔记导航' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '导航草稿' })).toHaveValue('保留草稿');
    resize(true);
    expect(screen.getByRole('dialog', { name: '笔记导航' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '导航草稿' })).toHaveValue('保留草稿');
    fireEvent.click(screen.getByRole('button', { name: '关闭笔记导航' }));
    await waitFor(() => expect(toggle).toHaveFocus());
    expect(screen.getByRole('button', { name: '正文操作' })).toBeInTheDocument();
  });
  it('路由改变关闭移动导航，桌面折叠不清空导航内容', () => {
    mockViewport(true); const rendered = render(<Shell />);
    fireEvent.click(screen.getByRole('button', { name: '切换侧栏' }));
    expect(screen.getByRole('dialog', { name: '笔记导航' })).toBeInTheDocument();
    rendered.rerender(<Shell navigationKey="/materials/notes/n1" />);
    expect(screen.queryByRole('dialog', { name: '笔记导航' })).not.toBeInTheDocument();
  });
});

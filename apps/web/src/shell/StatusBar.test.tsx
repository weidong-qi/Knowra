import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StatusBar } from './StatusBar';

describe('StatusBar breadcrumb path', () => {
  it('renders a single segment as the current location with no separator', () => {
    render(
      <StatusBar
        path={[{ id: 'home', label: '主页', current: true }]}
        dataMode="api"
        panels={[
          { id: 'sidebar', label: '侧栏', active: true, onToggle: vi.fn() },
          { id: 'inspector', label: '检查器', active: true, onToggle: vi.fn() }
        ]}
      />
    );

    const breadcrumb = screen.getByLabelText('工作区位置');
    // 没有分隔符
    expect(within(breadcrumb).queryByText('/')).not.toBeInTheDocument();
    // 末段用 span 渲染，无视觉强调
    const current = within(breadcrumb).getByText('主页');
    expect(current.tagName).toBe('SPAN');
    expect(current).toHaveAttribute('aria-current', 'location');
  });

  it('renders multi-segment path with separators and clickable non-current segments', async () => {
    const onJump = vi.fn();
    render(
      <StatusBar
        path={[
          { id: 'home', label: '主页', onNavigate: () => onJump('home') },
          { id: 'materials', label: '笔记库', onNavigate: () => onJump('materials') },
          { id: 'note:1', label: 'Q3 产品规划草案', current: true }
        ]}
        dataMode="api"
      />
    );

    const breadcrumb = screen.getByLabelText('工作区位置');
    // 段间分隔符两次
    const separators = within(breadcrumb).getAllByText('/', { exact: true });
    expect(separators.length).toBe(2);
    // 前两段渲染为 button
    const buttons = within(breadcrumb).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['主页', '笔记库']);
    // 末段渲染为 span + aria-current
    const noteLabel = within(breadcrumb).getByText('Q3 产品规划草案');
    expect(noteLabel.tagName).toBe('SPAN');
    expect(noteLabel).toHaveAttribute('aria-current', 'location');
    // 点击前段触发 onNavigate
    await userEvent.click(within(breadcrumb).getByRole('button', { name: '跳转到「主页」' }));
    expect(onJump).toHaveBeenCalledWith('home');
  });

  it('treats the last segment as current when current flag is omitted and no onNavigate', () => {
    render(
      <StatusBar
        path={[
          { id: 'home', label: '主页', onNavigate: () => undefined },
          { id: 'materials', label: '笔记库' }
        ]}
        dataMode="api"
      />
    );

    const breadcrumb = screen.getByLabelText('工作区位置');
    // 末段没传 current，但 StatusBar 推断为 current → span + aria-current
    const current = within(breadcrumb).getByText('笔记库');
    expect(current.tagName).toBe('SPAN');
    expect(current).toHaveAttribute('aria-current', 'location');
    // 前段是 button
    const buttons = within(breadcrumb).getAllByRole('button');
    expect(buttons).toHaveLength(1);
  });

  it('falls back to static text when the last segment has no onNavigate', () => {
    render(
      <StatusBar
        path={[
          { id: 'home', label: '主页' },
          { id: 'domain:knowledge', label: '知识库', current: true }
        ]}
        dataMode="api"
      />
    );

    const breadcrumb = screen.getByLabelText('工作区位置');
    // 当前段不可点
    expect(within(breadcrumb).queryByRole('button', { name: '跳转到「知识库」' })).not.toBeInTheDocument();
  });

  it('returns null content for an empty path', () => {
    render(<StatusBar path={[]} dataMode="api" />);
    expect(screen.queryByLabelText('工作区位置')).not.toBeInTheDocument();
  });

  it('still renders a long current title without dropping content (visual ellipsis is CSS-only)', () => {
    const longTitle = 'M4-02 文档 Tab 长标题回归验证：保留拖拽、右键菜单、关闭、未保存标记与溢出菜单';
    render(
      <StatusBar
        path={[
          { id: 'home', label: '主页', onNavigate: () => undefined },
          { id: 'materials', label: '笔记库', onNavigate: () => undefined },
          { id: 'note:1', label: longTitle, current: true }
        ]}
        dataMode="api"
        panels={[
          { id: 'sidebar', label: '侧栏', active: true, onToggle: vi.fn() },
          { id: 'inspector', label: '检查器', active: true, onToggle: vi.fn() }
        ]}
      />
    );

    const breadcrumb = screen.getByLabelText('工作区位置');
    // 文本完整保留（视觉省略由 CSS text-overflow:ellipsis 兜底，jsdom 不渲染样式）
    expect(within(breadcrumb).getByText(longTitle)).toBeInTheDocument();
    expect(screen.getByLabelText('数据模式：已同步')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '切换侧栏' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '切换检查器' })).toBeInTheDocument();
  });

  it('将桌面同步的三块内容作为同一个操作区，网页版仍使用原数据模式', () => {
    const control = <button type="button"><span>■</span><span>本地资料已同步</span></button>;
    const { rerender } = render(<StatusBar path={[]} dataMode="api" persistenceMode="desktop-local" dataModeNote={control} />);
    const button = screen.getByRole('button', { name: /本地资料已同步/ });
    expect(button).toBeInTheDocument();
    expect(button).not.toHaveTextContent('云端已同步');
    expect(screen.queryByLabelText('数据模式：本地资料')).not.toBeInTheDocument();
    rerender(<StatusBar path={[]} dataMode="api" persistenceMode="remote" />);
    expect(screen.getByLabelText('数据模式：已同步')).toBeInTheDocument();
  });

});

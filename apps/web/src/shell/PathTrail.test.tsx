import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PathTrail, type PathTrailProps } from './PathTrail';

describe('PathTrail 共享按压契约', () => {
  it.each(['{Enter}', ' '])('Tab 到达祖先路径后 %s 只导航一次，当前段仍不可按', async key => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(
      <PathTrail
        path={[
          { id: 'parent', label: '研究', onNavigate: navigate },
          { id: 'current', label: '当前笔记', onNavigate: navigate }
        ]}
      />
    );
    const parent = screen.getByRole('button', { name: '跳转到「研究」' });
    const current = screen.getByText('当前笔记');
    expect(current.tagName).toBe('SPAN');
    expect(current).toHaveAttribute('aria-current', 'location');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await user.tab();
    expect(parent).toHaveFocus();
    expect(parent).toHaveAttribute('type', 'button');
    expect(parent).toHaveAttribute('data-focus-visible', 'true');
    await user.keyboard(key);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(parent).toHaveFocus();
    await user.keyboard(key);
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('显式 currentId、顶部 page 语义和无回调静态段保持', async () => {
    const navigate = vi.fn();
    render(
      <PathTrail
        variant="top"
        currentId="current"
        path={[
          { id: 'static', label: '无回调祖先' },
          { id: 'current', label: '当前文件夹', onNavigate: navigate },
          { id: 'child', label: '子路径', onNavigate: navigate }
        ]}
      />
    );
    expect(screen.getByText('无回调祖先').tagName).toBe('SPAN');
    expect(screen.getByText('当前文件夹')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('子路径')).not.toHaveAttribute('aria-current');
    await userEvent.click(screen.getByRole('button', { name: '跳转到「子路径」' }));
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('currentId=null 仍将全部有回调段视为祖先', () => {
    render(
      <PathTrail
        currentId={null}
        path={[
          { id: 'parent', label: '研究', onNavigate: vi.fn() },
          { id: 'last', label: '末段', onNavigate: vi.fn() }
        ]}
      />
    );
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(document.querySelector('[aria-current]')).toBeNull();
  });

  it('自定义片段渲染保持原样，空路径不生成控件', () => {
    const renderer = vi.fn<NonNullable<PathTrailProps['renderSegment']>>((segment, current) => (
      <em>{`${segment.label}:${current}`}</em>
    ));
    const { rerender, container } = render(
      <PathTrail path={[{ id: 'x', label: '自定义' }]} renderSegment={renderer} />
    );
    expect(screen.getByText('自定义:true').tagName).toBe('EM');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<PathTrail path={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

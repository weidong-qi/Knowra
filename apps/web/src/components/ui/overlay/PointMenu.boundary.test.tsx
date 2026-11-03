import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
const received = vi.hoisted(() => ({ props: {} as Record<string, unknown> }));
vi.mock('./Menu', () => ({ MenuPopover: (props: Record<string, unknown>) => {
  received.props = props;
  return <div>{props.children as ReactNode}</div>;
} }));
import { PointMenu } from './PointMenu';

describe('PointMenu工作区边界透传', () => {
  it('允许表格菜单约束在工作区并限制高度，不改变默认视口菜单', () => {
    const boundary = document.createElement('div');
    const { rerender } = render(<PointMenu point={{ x: 100, y: 200 }} onOpenChange={() => {}}
      boundaryElement={boundary} maxHeight={300} popoverClassName="scrollable">内容</PointMenu>);
    expect(received.props.boundaryElement).toBe(boundary);
    expect(received.props.maxHeight).toBe(300);
    expect(received.props.className).toBe('scrollable');
    rerender(<PointMenu point={{ x: 100, y: 200 }} onOpenChange={() => {}}>内容</PointMenu>);
    expect(received.props.boundaryElement).toBeUndefined();
    expect(received.props.maxHeight).toBeUndefined();
  });
});

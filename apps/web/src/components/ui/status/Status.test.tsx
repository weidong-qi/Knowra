import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Badge, EmptyState, LoadingState, Panel, ToastCard, ToastRegion, ToastViewport, toast } from './index';

afterEach(() => {
  toast.clear();
  cleanup();
});

describe('V4-04 Badge', () => {
  it('renders tone-specific class names', () => {
    render(<Badge tone="success">已保存</Badge>);
    const badge = screen.getByText('已保存');
    expect(badge).toBeInTheDocument();
  });

  it('hides the dot when hideDot is true', () => {
    const { container } = render(<Badge hideDot>纯文字</Badge>);
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });
});

describe('V4-04 EmptyState', () => {
  it('renders title, description, and three action slots', () => {
    render(
      <EmptyState
        title="暂无资料"
        description="可以新建或导入"
        primaryAction={<button type="button">新建</button>}
        secondaryAction={<button type="button">导入</button>}
        escapeAction={<button type="button">重置</button>}
      />
    );
    expect(screen.getByText('暂无资料')).toBeInTheDocument();
    expect(screen.getByText('可以新建或导入')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导入' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重置' })).toBeInTheDocument();
  });
});

describe('V4-04 LoadingState', () => {
  it('exposes aria-busy and the label text', () => {
    render(<LoadingState label="正在加载" />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(region).toHaveTextContent('正在加载');
  });
});

describe('V4-04 Panel', () => {
  it('renders title, body, and footer', () => {
    render(
      <Panel title="最近" footer={<span>3 条</span>}>
        内容
      </Panel>
    );
    expect(screen.getByText('最近')).toBeInTheDocument();
    expect(screen.getByText('内容')).toBeInTheDocument();
    expect(screen.getByText('3 条')).toBeInTheDocument();
  });
});

describe('Toast 统一通知组件', () => {
  it('ToastCard 支持标题、说明、动作按钮与关闭回调', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ToastCard
        id="t1"
        tone="success"
        title="已完成「整理笔记」"
        description="10 秒内可撤销"
        actions={[{ label: '撤销', onPress: onAction }]}
        onDismiss={onDismiss}
      />
    );
    expect(screen.getByText('已完成「整理笔记」')).toBeInTheDocument();
    expect(screen.getByText('10 秒内可撤销')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '关闭通知' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('ToastViewport 与 ToastRegion 自动归并到全站右上角队列，不重复渲染', async () => {
    const { rerender } = render(
      <>
        <ToastViewport />
        <ToastRegion items={[{ id: 'r1', title: '局部待办提示', tone: 'warning', role: 'alert' }]} />
      </>
    );
    expect(await screen.findAllByText('局部待办提示')).toHaveLength(1);

    act(() => {
      toast.success('全局操作成功', { duration: 0 });
    });
    expect(await screen.findByText('全局操作成功')).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: '通知' })).toHaveLength(1);

    rerender(
      <>
        <ToastViewport />
        <ToastRegion items={[]} />
      </>
    );
    expect(screen.queryByText('局部待办提示')).not.toBeInTheDocument();
    expect(screen.getByText('全局操作成功')).toBeInTheDocument();
  });
});

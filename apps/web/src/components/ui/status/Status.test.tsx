import { render, screen } from '@testing-library/react';
import { Badge, EmptyState, LoadingState, Panel } from './index';

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

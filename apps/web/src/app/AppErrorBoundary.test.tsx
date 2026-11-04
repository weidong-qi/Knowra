import { render, screen } from '@testing-library/react';
import { AppErrorBoundary } from './AppErrorBoundary';

describe('AppErrorBoundary', () => {
  it('renders a recoverable fatal error shell', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <AppErrorBoundary>
        <BrokenChild />
      </AppErrorBoundary>
    );

    expect(screen.getByRole('heading', { name: '应用发生意外错误' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('测试故障');
    expect(screen.getByRole('button', { name: '重新加载界面' })).toBeInTheDocument();
  });
});

function BrokenChild(): never {
  throw new Error('测试故障');
}

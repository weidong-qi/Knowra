import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Button, SegmentedButton, SegmentedControl } from './index';

describe('V4-04 Button', () => {
  it('renders a button with accessible name and role', () => {
    render(<Button>保存</Button>);
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
  });

  it('invokes onPress with mouse and Enter / Space keyboard activation', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    render(<Button onPress={onPress}>运行</Button>);

    const button = screen.getByRole('button', { name: '运行' });
    await user.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);

    button.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onPress).toHaveBeenCalledTimes(3);
  });

  it('is disabled when isDisabled is true and skips onPress', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    render(<Button isDisabled onPress={onPress}>禁用</Button>);
    const button = screen.getByRole('button', { name: '禁用' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('applies focus-visible data attribute when focused via keyboard', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Button>第一个</Button>
        <Button>第二个</Button>
      </>
    );
    await user.tab();
    await user.tab();
    const target = screen.getByRole('button', { name: '第二个' });
    expect(target).toHaveAttribute('data-focus-visible', 'true');
  });

  it('does not flag focus-visible when focused via mouse click', async () => {
    const user = userEvent.setup();
    render(<Button>点击</Button>);
    const button = screen.getByRole('button', { name: '点击' });
    await user.click(button);
    expect(button).not.toHaveAttribute('data-focus-visible', 'true');
  });

  it('supports isPending without throwing on click', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    render(
      <Button isPending onPress={onPress}>
        提交中
      </Button>
    );
    const button = screen.getByRole('button', { name: '提交中' });
    expect(button).toHaveAttribute('data-pending', 'true');
    await user.click(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('preserves state across remounts to support React Strict Mode', () => {
    function Demo() {
      const [count, setCount] = useState(0);
      return <Button onPress={() => setCount((c) => c + 1)}>已点 {count}</Button>;
    }
    const { rerender } = render(<Demo />);
    rerender(<Demo />);
    expect(screen.getByRole('button', { name: /已点/ })).toBeInTheDocument();
  });

  it('keeps segmented count in the accessible name and switches via keyboard', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    render(<SegmentedControl aria-label="类型筛选"><SegmentedButton count={2} aria-pressed="true">全部</SegmentedButton><SegmentedButton count={1} aria-pressed="false" onPress={onPress}>文稿</SegmentedButton></SegmentedControl>);
    const group = screen.getByRole('group', { name: '类型筛选' });
    expect(group).toBeInTheDocument();
    const button = screen.getByRole('button', { name: '文稿 1' });
    button.focus();
    await user.keyboard('{Enter}');
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

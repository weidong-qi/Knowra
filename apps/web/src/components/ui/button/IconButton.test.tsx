import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { IconButton } from './IconButton';

describe('IconButton (ghost icon 纯图标按钮)', () => {
  it('renders a type=button element with aria-label and forwards click', async () => {
    const onClick = vi.fn();
    render(
      <IconButton aria-label="新建笔记" onClick={onClick}>
        <span data-testid="icon">+</span>
      </IconButton>
    );

    const button = screen.getByRole('button', { name: '新建笔记' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('type', 'button');
    expect(screen.getByTestId('icon')).toBeInTheDocument();

    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies the size class so 24/30/40 container sizes are visually distinct', () => {
    const { rerender } = render(
      <IconButton size={24} aria-label="24">
        ×
      </IconButton>
    );
    let button = screen.getByRole('button', { name: '24' });
    expect(button.className).toMatch(/size24/);

    rerender(
      <IconButton size={30} aria-label="30">
        ×
      </IconButton>
    );
    button = screen.getByRole('button', { name: '30' });
    expect(button.className).toMatch(/size30/);

    rerender(
      <IconButton size={40} aria-label="40">
        ×
      </IconButton>
    );
    button = screen.getByRole('button', { name: '40' });
    expect(button.className).toMatch(/size40/);
  });

  it('defaults to size 30 when size prop is omitted', () => {
    render(
      <IconButton aria-label="默认">
        ×
      </IconButton>
    );
    const button = screen.getByRole('button', { name: '默认' });
    expect(button.className).toMatch(/size30/);
  });

  it.each(['ghost', 'floating', 'primary'] as const)('%s forwards disabled state and does not fire onClick when disabled', (tone) => {
    const onClick = vi.fn();
    render(
      <IconButton tone={tone} aria-label="禁用" disabled onClick={onClick}>
        ×
      </IconButton>
    );
    const button = screen.getByRole('button', { name: '禁用' });
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('accepts data-force-* attributes so showcase can demo hover/focus/active without jsdom', () => {
    render(
      <>
        <IconButton aria-label="force hover" data-force-hover>×</IconButton>
        <IconButton aria-label="force focus" data-force-focus>×</IconButton>
        <IconButton aria-label="force active" data-force-active>×</IconButton>
      </>
    );

    const hover = screen.getByRole('button', { name: 'force hover' });
    const focus = screen.getByRole('button', { name: 'force focus' });
    const active = screen.getByRole('button', { name: 'force active' });
    expect(hover).toHaveAttribute('data-force-hover');
    expect(focus).toHaveAttribute('data-force-focus');
    expect(active).toHaveAttribute('data-force-active');
  });

  it('forwards title and merges className without losing base styles', () => {
    render(
      <IconButton aria-label="组合" title="提示" className="extra-class">
        ×
      </IconButton>
    );
    const button = screen.getByRole('button', { name: '组合' });
    expect(button).toHaveAttribute('title', '提示');
    expect(button.className).toMatch(/base/);
    expect(button.className).toMatch(/size30/);
    expect(button.className).toMatch(/extra-class/);
  });
});

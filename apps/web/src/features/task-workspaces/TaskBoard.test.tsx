import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { TaskBoard } from './TaskBoard';
import { syntheticTask } from './testFixtures';
afterEach(cleanup);
it('shows an expired lease to human viewers without granting claim authority', () => {
  render(<TaskBoard tasks={[syntheticTask({ status: 'running', leaseExpired: true, claimable: false })]} onOpen={vi.fn()} />);
  expect(screen.getByText('执行中 · 租约已到期，可重新领取')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '领取任务' })).toBeNull();
});
it('does not infer expiry from claim authority', () => {
  render(<TaskBoard tasks={[syntheticTask({ status: 'running', leaseExpired: false, claimable: true })]} onOpen={vi.fn()} />);
  expect(screen.queryByText(/租约已到期/)).toBeNull();
});

it('shows trusted executor and latest progress directly on a clickable compact card', () => {
  const onOpen = vi.fn();
  const task = syntheticTask({ status: 'running', currentExecutor: { kind: 'mcp', id: 'pairing-synthetic-12345', label: '合成配对客户端' }, latestProgress: { message: '正在核对第二份成果文档，已完成三项验收检查。', updatedAt: '2026-10-15T18:00:00Z' } });
  render(<TaskBoard tasks={[task]} onOpen={onOpen} />);
  expect(screen.getByRole('article', { name: '合成任务任务卡' })).toBeInTheDocument();
  expect(screen.getByText('执行客户端：合成配对客户端')).toBeInTheDocument();
  expect(screen.getByText(/^最新进度：正在核对第二份成果文档/)).toBeInTheDocument();
  expect(screen.getByText(/进度更新/)).toHaveAttribute('datetime', '2026-10-15T18:00:00Z');
  const card = screen.getByRole('button', { name: '合成任务' });
  expect(card).toHaveAccessibleDescription(expect.stringContaining('最新进度：正在核对第二份成果文档'));
  fireEvent.click(screen.getByText(/^最新进度：正在核对第二份成果文档/));
  expect(onOpen).toHaveBeenCalledWith('task');
  expect(screen.queryByText('pairing-synthetic-12345')).toBeNull();
});
it('uses an identifiable short client ID when no trusted label is supplied', () => {
  render(<TaskBoard tasks={[syntheticTask({ status: 'running', currentExecutor: { kind: 'mcp', id: '12345678-private-remainder', label: '' } })]} onOpen={vi.fn()} />);
  expect(screen.getByText('执行客户端：客户端 12345678')).toBeInTheDocument();
  expect(screen.queryByText(/private-remainder/)).toBeNull();
});

it('has one whole-card keyboard action with no nested controls', async () => {
  const onOpen = vi.fn();
  const user = userEvent.setup();
  render(<TaskBoard tasks={[syntheticTask()]} onOpen={onOpen} />);
  const card = screen.getByRole('article');
  expect(card.querySelectorAll('button')).toHaveLength(1);
  await user.tab();
  expect(screen.getByRole('button', { name: '合成任务' })).toHaveFocus();
  await user.keyboard('{Enter}');
  await user.keyboard(' ');
  expect(onOpen).toHaveBeenCalledTimes(2);
});

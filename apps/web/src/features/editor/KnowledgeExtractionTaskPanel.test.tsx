import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { ExtractionJobDetail } from '@study-accelerator/web-core';
import { KnowledgeExtractionTaskPanel } from './KnowledgeExtractionTaskPanel';
import type { useKnowledgeExtractionTasks } from './useKnowledgeExtractionTasks';

type Task = ReturnType<typeof useKnowledgeExtractionTasks>;
const running: ExtractionJobDetail = { contractVersion: 1, kind: 'knowledgeExtraction', jobId: 'job', scopeId: 'scope', spaceId: 'space', executionMode: 'mock', status: 'running', phase: 'generating', createdAt: '2026-10-02T01:00:00Z', updatedAt: '2026-10-02T01:00:00Z', candidateIds: [], error: null, actions: { canCancel: true, canRetry: false, retryUnavailableReason: null } };
function taskFor(job: ExtractionJobDetail): Task {
  return { open: true, setOpen: vi.fn(), items: [], nextCursor: null, historyLoaded: true, job, intent: null, pending: false, error: '', notice: '', recoveryWarning: '', refresh: vi.fn(), select: vi.fn(), start: vi.fn(), prepare: vi.fn(), action: vi.fn(), capability: { available: true, executionMode: 'mock', executionLocation: 'server', canStart: true, canReadJobs: true, reasonCode: null, message: '模拟' }, canWrite: true };
}
it.each(['cancel', 'retry'] as const)('提炼 %s 动作消失后把本面板焦点交给状态标题，Esc 仍走现有 Dialog 关闭', async kind => {
  const user = userEvent.setup();
  const before = kind === 'cancel' ? running : { ...running, status: 'failed' as const, actions: { canCancel: false, canRetry: true, retryUnavailableReason: null } };
  const task = taskFor(before), { rerender } = render(<KnowledgeExtractionTaskPanel task={task} />);
  const action = screen.getByRole('button', { name: kind === 'cancel' ? '停止任务' : '重试任务' });
  await user.click(action); expect(action).toHaveFocus();
  rerender(<KnowledgeExtractionTaskPanel task={{ ...task, pending: true }} />);
  const after = kind === 'cancel' ? { ...running, status: 'cancelled' as const, actions: { canCancel: false, canRetry: false, retryUnavailableReason: null } } : running;
  rerender(<KnowledgeExtractionTaskPanel task={{ ...task, job: after }} />);
  expect(screen.getByRole('heading', { name: kind === 'cancel' ? '已停止' : '正在提炼' })).toHaveFocus();
  await user.keyboard('{Escape}'); expect(task.setOpen).toHaveBeenCalledWith(false);
});
it('自然完成移除当前聚焦的停止按钮时恢复到成功状态；不需要动作事件', async () => {
  const user = userEvent.setup(), task = taskFor(running), { rerender } = render(<KnowledgeExtractionTaskPanel task={task} />);
  act(() => screen.getByRole('button', { name: '停止任务' }).focus());
  rerender(<KnowledgeExtractionTaskPanel task={{ ...task, job: { ...running, status: 'succeeded', candidateIds: ['candidate'], actions: { canCancel: false, canRetry: false, retryUnavailableReason: null } } }} />);
  expect(screen.getByRole('heading', { name: '候选已保存' })).toHaveFocus();
  expect(task.action).not.toHaveBeenCalled(); await user.keyboard('{Escape}'); expect(task.setOpen).toHaveBeenCalledWith(false);
});
it('轮询以及其他动作消失不会抢走仍在稳定控件上的焦点', () => {
  const task = taskFor(running), { rerender } = render(<KnowledgeExtractionTaskPanel task={task} />);
  const close = screen.getByRole('button', { name: '关闭' }); act(() => close.focus());
  rerender(<KnowledgeExtractionTaskPanel task={{ ...task, job: { ...running, updatedAt: '2026-10-02T01:00:01Z' } }} />);
  expect(close).toHaveFocus();
  rerender(<KnowledgeExtractionTaskPanel task={{ ...task, job: { ...running, status: 'succeeded', actions: { canCancel: false, canRetry: false, retryUnavailableReason: null } } }} />);
  expect(close).toHaveFocus();
});
it('面板关闭后的终态回执不会把焦点从外部控件抢回', async () => {
  const task = taskFor(running);
  const view = (open: boolean, status: 'running' | 'succeeded') => <><button>笔记编辑入口</button><KnowledgeExtractionTaskPanel task={{ ...task, open, job: { ...running, status, actions: { canCancel: status === 'running', canRetry: false, retryUnavailableReason: null } } }} /></>;
  const { rerender } = render(view(false, 'running')); const outside = screen.getByRole('button', { name: '笔记编辑入口' }); act(() => outside.focus());
  rerender(view(true, 'running')); act(() => screen.getByRole('button', { name: '停止任务' }).focus());
  rerender(view(false, 'running')); await waitFor(() => expect(outside).toHaveFocus());
  rerender(view(false, 'succeeded')); expect(outside).toHaveFocus(); expect(screen.queryByRole('dialog')).toBeNull();
});
it.each(['刷新任务', '查看任务 history-job', '加载更多任务'])('等待 %s 保留同一控件焦点并阻止重复请求，授权过期回执后仍可 Esc 关闭', async label => {
  const user = userEvent.setup();
  const failed: ExtractionJobDetail = { ...running, status: 'failed', phase: 'finished', actions: { canCancel: false, canRetry: true, retryUnavailableReason: null } };
  const task = { ...taskFor(failed), items: [{ ...failed, jobId: 'history-job' }], nextCursor: 'page-2' };
  const { rerender } = render(<KnowledgeExtractionTaskPanel task={task} />);
  const button = screen.getByRole('button', { name: label });
  const request = label === '查看任务 history-job' ? task.select : task.refresh;
  await user.click(button); expect(button).toHaveFocus(); expect(request).toHaveBeenCalledTimes(1);
  rerender(<KnowledgeExtractionTaskPanel task={{ ...task, pending: true }} />);
  // Native disabled makes Chromium drop focus to BODY even though the button remains connected.
  // The existing Button pending contract suppresses activation without making the focused node inert.
  expect(button).not.toBeDisabled(); expect(button).toHaveAttribute('aria-disabled', 'true'); expect(button).toHaveFocus();
  await user.click(button); await user.keyboard('{Enter}'); await user.keyboard(' ');
  expect(request).toHaveBeenCalledTimes(1);
  const expired = { ...failed, actions: { canCancel: false, canRetry: false, retryUnavailableReason: { code: 'KNOWLEDGE_EXTRACTION_GRANT_EXPIRED', message: '本次授权或来源已失效' } } };
  rerender(<KnowledgeExtractionTaskPanel task={{ ...task, job: expired }} />);
  expect(screen.getByRole('button', { name: label })).toBe(button); expect(button).toHaveFocus();
  expect(screen.queryByRole('button', { name: '重试任务' })).toBeNull();
  await user.keyboard('{Escape}'); expect(task.setOpen).toHaveBeenCalledWith(false);
});
it('轮询等待不抢稳定关闭按钮的焦点，权限禁用仍然有效', async () => {
  const user = userEvent.setup(), task = taskFor(running), { rerender } = render(<KnowledgeExtractionTaskPanel task={task} />);
  const close = screen.getByRole('button', { name: '关闭' }); act(() => close.focus());
  rerender(<KnowledgeExtractionTaskPanel task={{ ...task, pending: true }} />); expect(close).toHaveFocus();
  rerender(<KnowledgeExtractionTaskPanel task={{ ...task, canWrite: false }} />);
  const stop = screen.getByRole('button', { name: '停止任务' }); expect(stop).toBeDisabled();
  await user.click(stop); expect(task.action).not.toHaveBeenCalled();
});

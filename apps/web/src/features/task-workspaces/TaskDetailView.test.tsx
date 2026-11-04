import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TaskDetailView } from './TaskDetailView';
import { syntheticDocument, syntheticTask } from './testFixtures';
afterEach(cleanup);
function props() { return { task: syntheticTask(), documents: [syntheticDocument()], events: [], onPublish: vi.fn().mockResolvedValue(undefined), onReview: vi.fn().mockResolvedValue(undefined), onCancel: vi.fn().mockResolvedValue(undefined), onOpenVersion: vi.fn(), canWrite: true }; }
it('requires explicit confirmation for the current submission and binds its revision', async () => {
  const input = props(); render(<TaskDetailView {...input} />);
  fireEvent.click(screen.getByRole('button', { name: '接受成果' }));
  expect(input.onReview).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认接受当前成果' }));
  await waitFor(() => expect(input.onReview).toHaveBeenCalledWith({ expectedRevision: 4, submissionId: 'submission', decision: 'accepted', comment: '' }));
});
it('never redirects an open acceptance dialog to a replaced submission', () => {
  const input = props(); const view = render(<TaskDetailView {...input} />);
  fireEvent.click(screen.getByRole('button', { name: '接受成果' }));
  const newer = syntheticTask({ revision: 5, currentAttempt: { ...input.task.currentAttempt!, submission: { ...input.task.currentAttempt!.submission!, id: 'new-submission' } } });
  view.rerender(<TaskDetailView {...input} task={newer} />);
  expect(screen.getByRole('button', { name: '确认接受当前成果' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('任务已变化');
  expect(input.onReview).not.toHaveBeenCalled();
});
it('warns that republishing invalidates execution, and shows immutable artifact versions', () => {
  const input = props(); render(<TaskDetailView {...input} />);
  fireEvent.click(screen.getByRole('button', { name: '查看成果 1 的冻结版本' }));
  expect(input.onOpenVersion).toHaveBeenCalledWith('doc', 'version');
  fireEvent.click(screen.getByRole('button', { name: '修改并重新发布需求' }));
  expect(screen.getByRole('alert')).toHaveTextContent('当前执行和提交成果失效');
  expect(screen.getByRole('button', { name: '确认使旧执行失效并发布' })).toBeEnabled();
});
it('does not offer human acceptance for a stale requirement or an archived workspace', () => {
  const input = props(); const view = render(<TaskDetailView {...input} task={syntheticTask({ currentRequirementId: 'new-requirement' })} />);
  expect(screen.queryByRole('button', { name: '接受成果' })).toBeNull();
  view.rerender(<TaskDetailView {...input} canWrite={false} />);
  expect(screen.queryByRole('button', { name: '接受成果' })).toBeNull();
  expect(screen.queryByRole('button', { name: '修改并重新发布需求' })).toBeNull();
});
it('shows server-observed lease expiry to a human even when claimable is false', () => {
  const input = props();
  const task = syntheticTask({ status: 'running', leaseExpired: true, claimable: false, currentAttempt: { ...input.task.currentAttempt!, status: 'running', submission: null, leaseExpiresAt: '2026-10-15T11:00:00Z' } });
  render(<TaskDetailView {...input} task={task} />);
  expect(screen.getByRole('status')).toHaveTextContent('租约已到期，可由获授权的 Agent 重新领取');
  expect(screen.queryByRole('button', { name: '领取任务' })).toBeNull();
});
it('retains publication inputs across conflict and reopen, and requires explicit revision adoption', async () => {
  const input = props();
  input.onPublish.mockRejectedValueOnce({ status: 409 });
  const latest = syntheticTask({ revision: 5, status: 'running' });
  const onReload = vi.fn().mockResolvedValue(latest);
  const view = render(<TaskDetailView {...input} onReload={onReload} />);
  fireEvent.click(screen.getByRole('button', { name: '修改并重新发布需求' }));
  fireEvent.change(screen.getByRole('textbox', { name: '验收标准（每行一条）' }), { target: { value: '手写标准' } });
  fireEvent.change(screen.getByRole('textbox', { name: '包含范围' }), { target: { value: '手写包含' } });
  fireEvent.change(screen.getByRole('textbox', { name: '不包含范围' }), { target: { value: '手写排除' } });
  fireEvent.click(screen.getByRole('button', { name: '确认使旧执行失效并发布' }));
  await waitFor(() => expect(screen.getByText(/内容或任务状态已变化/)).toBeInTheDocument());
  view.rerender(<TaskDetailView {...input} task={latest} onReload={onReload} />);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  fireEvent.click(screen.getByRole('button', { name: '修改并重新发布需求' }));
  expect(screen.getByRole('textbox', { name: '验收标准（每行一条）' })).toHaveValue('手写标准');
  expect(screen.getByText(/当前发布基线：任务修订 4/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '核对最新任务' }));
  await screen.findByRole('region', { name: '最新任务修订核对' });
  expect(screen.getByText(/当前发布基线：任务修订 4/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '保留输入并使用此任务修订' }));
  expect(screen.getByText(/当前发布基线：任务修订 5/)).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: '包含范围' })).toHaveValue('手写包含');
  expect(screen.getByRole('textbox', { name: '不包含范围' })).toHaveValue('手写排除');
  fireEvent.click(screen.getByRole('button', { name: '确认使旧执行失效并发布' }));
  await waitFor(() => expect(input.onPublish).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 5, acceptanceCriteria: ['手写标准'], inScope: '手写包含', outOfScope: '手写排除' })));
});
it('preserves publication inputs but prevents publishing after adopting a terminal task revision', async () => {
  const input = props();
  render(<TaskDetailView {...input} onReload={vi.fn().mockResolvedValue(syntheticTask({ status: 'accepted', revision: 6 }))} />);
  fireEvent.click(screen.getByRole('button', { name: '修改并重新发布需求' }));
  fireEvent.change(screen.getByRole('textbox', { name: '包含范围' }), { target: { value: '仍需保留' } });
  fireEvent.click(screen.getByRole('button', { name: '核对最新任务' }));
  await screen.findByRole('region', { name: '最新任务修订核对' });
  fireEvent.click(screen.getByRole('button', { name: '保留输入并使用此任务修订' }));
  expect(screen.getByRole('button', { name: '确认发布冻结版本' })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: '包含范围' })).toHaveValue('仍需保留');
  expect(input.onPublish).not.toHaveBeenCalled();
});

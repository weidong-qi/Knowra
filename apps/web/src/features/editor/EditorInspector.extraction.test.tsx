import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ExtractionJobDetail } from '@study-accelerator/web-core';
import { EditorInspector } from './EditorInspector';
import { extractionIntentKey, saveExtractionIntent } from './extractionIntentRecovery';
const env = vi.hoisted(() => ({ value: {} as any }));
vi.mock('./ExtractionEnvironment', () => ({ useExtractionEnvironment: () => env.value, ExtractionDemoNotice: () => null }));
const job: ExtractionJobDetail = { contractVersion: 1, kind: 'knowledgeExtraction', jobId: 'job', scopeId: 'scope', spaceId: 'space', executionMode: 'mock', status: 'running', phase: 'generating', createdAt: '2026-10-02T01:00:00Z', updatedAt: '2026-10-02T01:00:00Z', candidateIds: [], error: null, actions: { canCancel: true, canRetry: false, retryUnavailableReason: null } };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function setup() {
  const note = { id: 'note', spaceId: 'space', title: '合成笔记', rawMarkdown: '合成正文', folderId: null, tagIds: [], internalLinks: [], contentLoaded: true, favorite: false, deleted: false };
  const saveScope = vi.fn().mockResolvedValue({ id: 'scope' });
  const preview = vi.fn().mockResolvedValue({ spaceId: 'space', mode: 'all', previewHash: 'hash', summary: { noteCount: 1, segmentCount: 1, annotationCount: 0 }, segments: [{ noteId: 'note', noteVersionId: 'v1', start: 0, end: 4, markdown: '合成正文', annotationIds: [] }], omittedItems: [], ai: { available: false, message: '未开放' } });
  render(<EditorInspector {...({ note, notes: [note], folder: null, foldersById: {}, tags: [], markdown: note.rawMarkdown, open: true, canWrite: true, canInsertAttachment: true, attachments: [], attachmentsLoading: false, linkedNotes: [], linkedNotesLoading: false, annotations: [], annotationsLoading: false, focusedAnnotationId: null, onClose: vi.fn(), onListVersions: vi.fn().mockResolvedValue([]), onPreviewAnalysisScope: preview, onCreateAnalysisScope: saveScope, onListAnalysisScopes: vi.fn().mockResolvedValue([]) } as any)} />);
  return { user: userEvent.setup(), saveScope };
}
beforeEach(() => {
  env.value = { scopeKey: {}, capability: { available: true, executionMode: 'mock', executionLocation: 'server', canStart: true, canReadJobs: true, reasonCode: null, message: '模拟' }, api: {
    listJobs: vi.fn().mockResolvedValue({ items: [], nextCursor: null }), getJob: vi.fn().mockResolvedValue(job), startJob: vi.fn().mockResolvedValue(job), cancelJob: vi.fn(), retryJob: vi.fn()
  } };
  saveExtractionIntent(extractionIntentKey('space', 'note'), null);
});
it('关闭旧列表请求后，新范围确认仍明确提交；旧空页迟到不覆盖新任务', async () => {
  const old = deferred<{ items: never[]; nextCursor: null }>(); env.value.api.listJobs.mockReturnValueOnce(old.promise);
  const { user, saveScope } = setup();
  await user.click(screen.getByRole('tab', { name: 'AI' })); await user.click(screen.getByRole('button', { name: '查看提炼任务' }));
  await screen.findByText('正在读取或提交任务…'); await user.click(screen.getByRole('button', { name: '关闭' }));
  await user.click(screen.getByRole('button', { name: '分析整篇' })); await user.click(await screen.findByRole('button', { name: '开始提炼' }));
  await waitFor(() => expect(env.value.api.startJob).toHaveBeenCalledTimes(1));
  expect(saveScope).toHaveBeenCalledTimes(1); expect(await screen.findByRole('dialog', { name: '知识提炼任务' })).toHaveTextContent('正在提炼');
  await act(async () => { old.resolve({ items: [], nextCursor: null }); await old.promise; });
  expect(screen.getByRole('dialog', { name: '知识提炼任务' })).toHaveTextContent('正在提炼'); expect(env.value.api.cancelJob).not.toHaveBeenCalled();
});
it.each(['start', 'cancel', 'retry'] as const)('关闭的 %s 写请求保留防重，新的预览明确禁用开始且不保存后静默丢失', async kind => {
  const pending = deferred<ExtractionJobDetail>();
  if (kind === 'start') env.value.api.startJob.mockReturnValue(pending.promise);
  else {
    const selected = kind === 'retry' ? { ...job, status: 'failed', actions: { canCancel: false, canRetry: true, retryUnavailableReason: null } } : job;
    env.value.api.listJobs.mockResolvedValue({ items: [selected], nextCursor: null }); env.value.api.getJob.mockResolvedValue(selected);
    env.value.api[kind === 'cancel' ? 'cancelJob' : 'retryJob'].mockReturnValue(pending.promise);
  }
  const { user, saveScope } = setup(); await user.click(screen.getByRole('tab', { name: 'AI' }));
  if (kind === 'start') {
    await user.click(screen.getByRole('button', { name: '分析整篇' })); await user.click(await screen.findByRole('button', { name: '开始提炼' }));
  } else {
    await user.click(screen.getByRole('button', { name: '查看提炼任务' })); await user.click(await screen.findByRole('button', { name: kind === 'cancel' ? '停止任务' : '重试任务' }));
  }
  await screen.findByText('正在读取或提交任务…'); await user.click(screen.getByRole('button', { name: '关闭' }));
  await user.click(screen.getByRole('button', { name: '分析整篇' }));
  const dialog = await screen.findByRole('dialog', { name: '确认分析范围' });
  expect(dialog).toHaveTextContent('已有任务请求尚未完成');
  expect(within(dialog).getByRole('button', { name: '开始提炼' })).toBeDisabled();
  await user.click(within(dialog).getByRole('button', { name: '开始提炼' }));
  expect(saveScope).toHaveBeenCalledTimes(kind === 'start' ? 1 : 0);
  await act(async () => { pending.resolve(job); await pending.promise; });
  await waitFor(() => expect(within(dialog).getByRole('button', { name: '开始提炼' })).toBeEnabled());
  expect(dialog).toBeVisible(); expect(saveScope).toHaveBeenCalledTimes(kind === 'start' ? 1 : 0);
});
it('提交结果未知时不把空间空页说成暂无任务，保留原 key 查询入口', async () => {
  saveExtractionIntent(extractionIntentKey('space', 'note'), { scopeId: 'scope', taskKey: 'unknown-key', submitted: true });
  env.value.api.listJobs.mockImplementation(async (input: { idempotencyKey?: string }) => {
    if (input.idempotencyKey) throw new Error('lost recovery');
    return { items: [], nextCursor: null };
  });
  const { user } = setup(); await user.click(screen.getByRole('tab', { name: 'AI' })); await user.click(screen.getByRole('button', { name: '查看提炼任务' }));
  expect(await screen.findByText('连接中断，任务状态未知。请查询提交结果。')).toBeVisible();
  await waitFor(() => expect(screen.getByRole('button', { name: '查询提交结果' })).toBeEnabled());
  expect(screen.queryByText('暂无提炼任务。')).toBeNull(); expect(env.value.api.startJob).not.toHaveBeenCalled();
});

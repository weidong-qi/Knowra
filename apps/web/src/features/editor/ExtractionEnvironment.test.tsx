import { StrictMode, type ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { UNAVAILABLE_EXTRACTION, type AnalysisScopePreview } from '@study-accelerator/web-core';
import { ExtractionEnvironmentProvider, useExtractionEnvironment, ExtractionDemoNotice } from './ExtractionEnvironment';
import { AnalysisScopeDialog, type AnalysisIntent } from './AnalysisScopeDialog';
const store = vi.hoisted(() => ({ state: {} as any }));
vi.mock('../../store/AppStoreProvider', () => ({ useAppStore: (selector: (state: any) => unknown) => selector(store.state) }));
const mockCapability = { ...UNAVAILABLE_EXTRACTION, available: true, executionMode: 'mock', canStart: true, canReadJobs: true, reasonCode: null };
const preview: AnalysisScopePreview = { spaceId: 'space', mode: 'all', previewHash: 'fixed-preview', summary: { noteCount: 1, segmentCount: 1, annotationCount: 0 }, segments: [{ noteId: 'note', noteVersionId: 'v1', start: 0, end: 4, markdown: '合成正文', annotationIds: [] }], omittedItems: [], ai: { available: false, message: '历史不可用字段' } };
const analysis: AnalysisIntent = { input: { spaceId: 'space', mode: 'all', noteIds: ['note'] }, preview, scopeKey: 'scope-intent', taskKey: 'task-intent' };
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => { store.state = { knowledgeExtraction: { getCapabilities: vi.fn().mockResolvedValue({ contractVersion: 1, knowledgeExtraction: mockCapability }) }, serverData: { spaces: [], currentSpaceId: 'space' }, dataMode: 'api', persistenceMode: 'remote', knowledgeGeneration: 0 }; });
function Harness() { const env = useExtractionEnvironment(); return <><span>{env.capability.canStart ? '可明确开始' : '不可开始'}</span><button disabled={env.checking} onClick={env.recheck}>重新检查</button><ExtractionDemoNotice /></>; }
function wrap(children: ReactNode) { return <StrictMode><ExtractionEnvironmentProvider>{children}</ExtractionEnvironmentProvider></StrictMode>; }
it('初次能力查询失败后，可显式只 GET 重查恢复 Mock，不使用 preview.ai', async () => {
  const user = userEvent.setup(); store.state.knowledgeExtraction.getCapabilities.mockRejectedValue(new Error('offline'));
  render(wrap(<Harness />)); await waitFor(() => expect(screen.getByRole('button', { name: '重新检查' })).toBeEnabled());
  expect(screen.getByText('不可开始')).toBeVisible();
  store.state.knowledgeExtraction.getCapabilities.mockResolvedValue({ contractVersion: 1, knowledgeExtraction: mockCapability });
  await user.click(screen.getByRole('button', { name: '重新检查' }));
  expect(await screen.findByText('可明确开始')).toBeVisible(); expect(screen.getByText('模拟演示，结果仅用于流程验收')).toBeVisible();
});
it('桌面真实宿主保持关闭，不查询或装配任务能力', () => {
  store.state.persistenceMode = 'desktop-local'; render(wrap(<Harness />));
  expect(screen.getByText('不可开始')).toBeVisible(); expect(store.state.knowledgeExtraction.getCapabilities).not.toHaveBeenCalled();
});
it('能力查询晚响应不能开启新空间；普通正文更新不会重查', async () => {
  const pending = deferred<any>(); store.state.knowledgeExtraction.getCapabilities.mockReturnValue(pending.promise);
  const { rerender } = render(wrap(<Harness />));
  store.state = { ...store.state, serverData: { spaces: [], currentSpaceId: 'next' } };
  store.state.knowledgeExtraction.getCapabilities.mockResolvedValue({ contractVersion: 1, knowledgeExtraction: UNAVAILABLE_EXTRACTION });
  rerender(wrap(<Harness />));
  await act(async () => { pending.resolve({ contractVersion: 1, knowledgeExtraction: mockCapability }); await pending.promise; });
  expect(screen.getByText('不可开始')).toBeVisible();
  const count = store.state.knowledgeExtraction.getCapabilities.mock.calls.length;
  store.state = { ...store.state, serverData: { ...store.state.serverData, notes: [{ rawMarkdown: 'changed' }] } };
  rerender(wrap(<Harness />)); expect(store.state.knowledgeExtraction.getCapabilities).toHaveBeenCalledTimes(count);
});
it('范围保存失败保留固定 preview 与 scope key，显式再开始才用不同 task key', async () => {
  const user = userEvent.setup(), onSave = vi.fn().mockRejectedValueOnce(new Error('lost')).mockResolvedValue({ id: 'saved-scope' }), onStart = vi.fn();
  render(wrap(<AnalysisScopeDialog analysis={analysis} onSave={onSave} onSaved={vi.fn()} onStart={onStart} onClose={vi.fn()} />));
  await user.click(await screen.findByRole('button', { name: '开始提炼' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('范围保存未完成'); expect(onStart).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '开始提炼' }));
  await waitFor(() => expect(onStart).toHaveBeenCalledWith({ scopeId: 'saved-scope', taskKey: 'task-intent' }));
  expect(onSave.mock.calls).toEqual(Array(2).fill([{ ...analysis.input, previewHash: 'fixed-preview', idempotencyKey: 'scope-intent' }]));
  expect(analysis.preview.ai).toEqual({ available: false, message: '历史不可用字段' });
});
it('手动保存成功关范围预览；关闭中的保存晚响应不会开始任务', async () => {
  const user = userEvent.setup(), pending = deferred<{ id: string }>(), onStart = vi.fn(), onClose = vi.fn(), onSave = vi.fn().mockReturnValue(pending.promise);
  const first = render(wrap(<AnalysisScopeDialog analysis={analysis} onSave={onSave} onSaved={vi.fn()} onStart={onStart} onClose={onClose} />));
  await user.click(await screen.findByRole('button', { name: '开始提炼' }));
  await user.click(screen.getByRole('button', { name: '关闭' }));
  await act(async () => { pending.resolve({ id: 'saved' }); await pending.promise; });
  expect(onClose).toHaveBeenCalledTimes(1); expect(onStart).not.toHaveBeenCalled(); first.unmount();
  const close = vi.fn(); render(wrap(<AnalysisScopeDialog analysis={analysis} onSave={vi.fn().mockResolvedValue({ id: 'manual' })} onSaved={vi.fn()} onStart={onStart} onClose={close} />));
  await user.click(screen.getByRole('button', { name: '保存范围快照' })); await waitFor(() => expect(close).toHaveBeenCalledTimes(1)); expect(onStart).not.toHaveBeenCalled();
});
it('开始前如实显示排除与遗漏，使用友好原因而不展示内部 ID', async () => {
  const previewWithOmissions = { ...preview, exclusions: [{ noteId: 'private-note-id', start: 1, end: 5, exclusionId: 'private-exclusion' }], omittedItems: [{ reason: 'imageUnreadable', noteId: 'private-note-id' }, { reason: 'unknownMachineCode', annotationId: 'private-annotation' }] };
  render(wrap(<AnalysisScopeDialog analysis={{ ...analysis, preview: previewWithOmissions }} onSave={vi.fn()} onSaved={vi.fn()} onStart={vi.fn()} onClose={vi.fn()} />));
  expect(screen.getByLabelText('分析排除范围')).toHaveTextContent('已排除 1 个局部范围');
  expect(screen.getByLabelText('分析遗漏提示')).toHaveTextContent('图片内容未读取');
  expect(screen.getByLabelText('分析遗漏提示')).toHaveTextContent('需重新核对');
  expect(screen.getByRole('dialog').textContent).not.toMatch(/private-|unknownMachineCode|imageUnreadable/);
  await screen.findByRole('button', { name: '开始提炼' });
});

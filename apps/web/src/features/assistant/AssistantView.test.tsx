import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LegacyAssistantView as AssistantView } from './LegacyAssistantView';
import { assistantApi, type AssistantJob } from './assistantApi';

const fixture = vi.hoisted(() => ({
  state: {
    serverData: { currentSpaceId: 'space-1', notes: [{ id: 'note-1', title: '笔记 A', spaceId: 'space-1', deleted: false }], folderTree: [] },
    getNoteVersion: vi.fn(async () => ({ content: '前文 alpha 后文' }))
  }
}));

vi.mock('../../store/AppStoreProvider', () => ({ useAppStore: (selector: (value: typeof fixture.state) => unknown) => selector(fixture.state) }));
vi.mock('./assistantApi', () => ({ assistantApi: {
  status: vi.fn(), list: vi.fn(), get: vi.fn(), preview: vi.fn(), start: vi.fn(), cancel: vi.fn()
} }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(assistantApi.status).mockResolvedValue({ provider: 'deepseek', modelId: 'deepseek-flash',
    configured: true, executionLocation: 'server', generationAvailable: false,
    unavailableReason: '云端预算服务不可用，已阻止模型调用。', budget: null,
    capabilities: { readScopes: ['note', 'folder'], actions: ['answer', 'cancel'], responseMode: 'polling',
      writeTools: false, providerAdvertised: null, providerVerified: false } });
  vi.mocked(assistantApi.list).mockResolvedValue([]);
});

it('云端显示真实门禁，可预览明确选中的正文但不能误触发生成', async () => {
  vi.mocked(assistantApi.preview).mockResolvedValue({ previewId: 'preview-1', expiresAt: '2030-01-01T00:00:00.000Z',
    scopeHash: 'scope-hash', payloadHash: 'payload-hash', recipient: 'deepseek', spaceId: 'space-1',
    estimatedInputTokens: 120, omissions: [], sources: [{ sourceId: 'source-1', noteId: 'note-1',
      noteVersionId: 'version-1', start: 0, end: 8, text: 'alpha 正文' }] });
  render(<AssistantView pathname="/assistant?noteId=note-1" onOpenNote={vi.fn()} />);
  expect(await screen.findByText('服务器执行')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: '问题' }), { target: { value: 'alpha 是什么？' } });
  fireEvent.click(screen.getByRole('button', { name: '预览发送范围' }));
  await waitFor(() => expect(assistantApi.preview).toHaveBeenCalledWith({ spaceId: 'space-1',
    scope: { kind: 'note', noteId: 'note-1' }, question: 'alpha 是什么？' }));
  expect(await screen.findByText('alpha 正文')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '确认范围并提问' })).toBeDisabled();
  expect(assistantApi.start).not.toHaveBeenCalled();
});

it('刷新后读取已完成任务，并把引用定位到不可变笔记版本', async () => {
  const job = { jobId: 'job-1', spaceId: 'space-1', question: '问题', status: 'succeeded' as const,
    phase: 'finished', modelId: 'deepseek-flash', createdAt: '2026-09-26T00:00:00.000Z',
    updatedAt: '2026-09-26T00:00:01.000Z', result: { answer: '有依据的回答', citations: [{
      sourceId: 'source-1', noteId: 'note-1', noteVersionId: 'version-1', start: 3, end: 8
    }] }, sources: [], omissions: [] };
  vi.mocked(assistantApi.list).mockResolvedValue([job]);
  vi.mocked(assistantApi.get).mockResolvedValue(job);
  const onOpenNote = vi.fn();
  render(<AssistantView pathname="/assistant" onOpenNote={onOpenNote} />);
  expect(await screen.findByText('有依据的回答')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /引用 1 · 笔记 A/ }));
  expect(await screen.findByLabelText('引用原文定位')).toBeInTheDocument();
  expect(screen.getByText('alpha', { selector: 'mark' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '打开笔记' }));
  expect(onOpenNote).toHaveBeenCalledWith('note-1');
});

it('失败任务展示安全错误码、阶段、HTTP 状态与预算占额', async () => {
  vi.mocked(assistantApi.status).mockResolvedValue({ provider: 'deepseek', modelId: 'deepseek-flash',
    configured: true, executionLocation: 'local', generationAvailable: true, unavailableReason: null,
    budget: { day: '2026-09-27', limitMicrounits: 20_000_000, availableMicrounits: 19_800_000,
      heldMicrounits: 200_000, spentMicrounits: 0 },
    capabilities: { readScopes: ['note', 'folder'], actions: ['answer', 'cancel'], responseMode: 'polling',
      writeTools: false, providerAdvertised: null, providerVerified: false } });
  const job: AssistantJob = { jobId: 'failed-job', spaceId: 'space-1', question: '合成问题', status: 'failed',
    phase: 'finished', modelId: 'deepseek-flash', createdAt: '2026-09-27T00:00:00.000Z',
    updatedAt: '2026-09-27T00:00:01.000Z', result: null, sources: [], omissions: [],
    diagnostics: [{ sequence: 1, eventKind: 'providerRequestStarted', createdAt: '2026-09-27T00:00:00.000Z',
      safePayload: { attemptId: 'attempt-1', deliveryUncertain: true } },
    { sequence: 2, eventKind: 'attemptFailed', createdAt: '2026-09-27T00:00:01.000Z',
      safePayload: { stage: 'providerResponse', code: 'AI_RATE_LIMITED', httpStatus: 429,
        budgetDisposition: 'unknown', deliveryUncertain: true } }] };
  vi.mocked(assistantApi.list).mockResolvedValue([job]);
  vi.mocked(assistantApi.get).mockResolvedValue(job);
  render(<AssistantView pathname="/assistant" onOpenNote={vi.fn()} />);
  expect(await screen.findByText('任务未完成：模型服务请求过于频繁（AI_RATE_LIMITED）。')).toBeInTheDocument();
  expect(screen.getByText(/待核对预留 0.20 元/)).toBeInTheDocument();
  fireEvent.click(screen.getByText('调用详情 · 2 条记录'));
  expect(screen.getByText(/模型请求或响应 · 错误码：AI_RATE_LIMITED · HTTP 429/)).toBeInTheDocument();
  expect(screen.getByText(/不记录 API Key、笔记正文或模型原始回答/)).toBeInTheDocument();
});

it('输出被截断时展示明确原因与已结算费用', async () => {
  const job: AssistantJob = { jobId: 'truncated-job', spaceId: 'space-1', question: '请总结笔记', status: 'failed',
    phase: 'finished', modelId: 'deepseek-flash', createdAt: '2026-09-27T00:00:00.000Z',
    updatedAt: '2026-09-27T00:00:01.000Z', result: null, sources: [], omissions: [],
    diagnostics: [{ sequence: 1, eventKind: 'providerResponseReceived', createdAt: '2026-09-27T00:00:00.000Z',
      safePayload: { finishReason: 'length', inputTokens: 3446, outputTokens: 512 } },
    { sequence: 2, eventKind: 'budgetSettled', createdAt: '2026-09-27T00:00:01.000Z',
      safePayload: { budgetDisposition: 'settled', actualMicrounits: 10988 } },
    { sequence: 3, eventKind: 'attemptFailed', createdAt: '2026-09-27T00:00:01.000Z',
      safePayload: { stage: 'resultValidation', code: 'AI_OUTPUT_TRUNCATED', budgetDisposition: 'settled' } }] };
  vi.mocked(assistantApi.list).mockResolvedValue([job]);
  vi.mocked(assistantApi.get).mockResolvedValue(job);
  render(<AssistantView pathname="/assistant" onOpenNote={vi.fn()} />);
  expect(await screen.findByText('任务未完成：模型回答达到输出上限（AI_OUTPUT_TRUNCATED）。')).toBeInTheDocument();
  fireEvent.click(screen.getByText('调用详情 · 3 条记录'));
  expect(screen.getByText(/结束原因：length · 输入 3446 token · 输出 512 token/)).toBeInTheDocument();
  expect(screen.getByText(/结算 0.01 元 · 已按模型用量结算/)).toBeInTheDocument();
});

it('旧任务误报格式错误时根据 length 诊断说明真实原因', async () => {
  const job: AssistantJob = { jobId: 'old-truncated-job', spaceId: 'space-1', question: '请总结笔记', status: 'failed',
    phase: 'finished', modelId: 'deepseek-flash', createdAt: '2026-09-27T00:00:00.000Z',
    updatedAt: '2026-09-27T00:00:01.000Z', result: null, sources: [], omissions: [],
    diagnostics: [{ sequence: 1, eventKind: 'providerResponseReceived', createdAt: '2026-09-27T00:00:00.000Z',
      safePayload: { finishReason: 'length', outputTokens: 512 } },
    { sequence: 2, eventKind: 'taskFailed', createdAt: '2026-09-27T00:00:01.000Z',
      safePayload: { code: 'AI_ANSWER_INVALID' } }] };
  vi.mocked(assistantApi.list).mockResolvedValue([job]);
  vi.mocked(assistantApi.get).mockResolvedValue(job);
  render(<AssistantView pathname="/assistant" onOpenNote={vi.fn()} />);
  expect(await screen.findByText('任务未完成：模型回答达到输出上限（AI_ANSWER_INVALID）。')).toBeInTheDocument();
});

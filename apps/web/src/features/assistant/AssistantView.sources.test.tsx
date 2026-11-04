import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssistantView } from './AssistantView';
import { conversationApi, type Conversation, type SourceRef } from './conversationApi';

const fixture = vi.hoisted(() => ({
  state: {
    serverData: { currentSpaceId: 'space-1', notes: [{ id: 'note-1', title: '笔记 A', deleted: false }], folderTree: [] },
    getNoteVersion: vi.fn()
  }
}));
vi.mock('../../app/router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../store/AppStoreProvider', () => ({ useAppStore: (selector: (state: typeof fixture.state) => unknown) => selector(fixture.state) }));
vi.mock('./AIInbox', () => ({ AIInbox: () => null }));
vi.mock('./NoteActions', () => ({ NoteActions: () => null }));
vi.mock('./ConversationAttachmentPicker', () => ({ ConversationAttachmentPicker: () => null }));
vi.mock('./assistantApi', () => ({ assistantApi: { status: vi.fn(async () => ({ generationAvailable: true })) } }));
vi.mock('./conversationApi', () => ({ conversationApi: {
  list: vi.fn(), messages: vi.fn(), turn: vi.fn(), policies: vi.fn(async () => [])
} }));

const version = { content: '前文 alpha 后文', contentHash: 'e1ad18f75b0295b8a3845a76fc8e148b8eef2107f58336fe9bca6a23ebb608d6' };
const first: SourceRef = { noteId: 'note-1', noteVersionId: 'version-1', contentHash: version.contentHash,
  start: 3, end: 8, quoteHash: '8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8' };
const second: SourceRef = { ...first, start: 9, end: 11, quoteHash: '30bc60d288a5cf9c0e04bfd90351fa771abf3520b8f812a8123da21e19f39a0d' };
const conversation: Conversation = { conversationId: 'conversation-1', spaceId: 'space-1',
  createdAt: '2026-09-27T00:00:00Z', updatedAt: '2026-09-27T00:00:00Z', historicalDataset: false, readOnly: false };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const view = (id = 'conversation-1') => <AssistantView pathname={`/assistant?conversationId=${id}`} onOpenNote={vi.fn()} />;
const open = (index: number) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`来源 ${index} · 笔记 A`) }));
async function settle(pending: ReturnType<typeof deferred<typeof version>>, error?: Error) {
  await act(async () => { if (error) pending.reject(error); else pending.resolve(version); });
}

beforeEach(() => {
  vi.clearAllMocks();
  // 此组只验证真实页面的请求归属；哈希路径另由 hook 回归覆盖。
  vi.stubGlobal('crypto', { ...globalThis.crypto, subtle: undefined });
  fixture.state.serverData.currentSpaceId = 'space-1';
  fixture.state.getNoteVersion.mockReset().mockResolvedValue(version);
  vi.mocked(conversationApi.list).mockResolvedValue([conversation, { ...conversation, conversationId: 'conversation-2' }]);
  vi.mocked(conversationApi.messages).mockResolvedValue([{ messageId: 'answer', turnId: 'turn', sequence: 1,
    role: 'assistant', content: '合成回答', citations: [first, second], sourceRefs: [], sourceFree: false, createdAt: conversation.createdAt }]);
  vi.mocked(conversationApi.turn).mockResolvedValue({ turnId: 'turn', conversationId: 'conversation-1', requestedPolicyId: null,
    status: 'succeeded', phase: 'finished', errorCode: null });
});
afterEach(() => vi.unstubAllGlobals());

it('同一会话连续点击引用，先发请求迟到不覆盖后选来源', async () => {
  const older = deferred<typeof version>();
  fixture.state.getNoteVersion.mockImplementationOnce(() => older.promise);
  render(view()); await screen.findByText('合成回答');
  open(1); open(2);
  await screen.findByText('后文', { selector: 'mark' });
  await settle(older);
  expect(screen.getByText('后文', { selector: 'mark' })).toBeInTheDocument();
});

it.each(['success', 'error'])('关闭原文让未完成读取的 %s 失效', async outcome => {
  render(view()); await screen.findByText('合成回答');
  open(1); await screen.findByLabelText('引用原文定位');
  const pending = deferred<typeof version>();
  fixture.state.getNoteVersion.mockImplementationOnce(() => pending.promise);
  open(2); fireEvent.click(screen.getByRole('button', { name: '关闭原文' }));
  await settle(pending, outcome === 'error' ? new Error('旧原文读取失败') : undefined);
  expect(screen.queryByLabelText('引用原文定位')).not.toBeInTheDocument();
  expect(screen.queryByText('旧原文读取失败')).not.toBeInTheDocument();
});

it.each(['success', 'error'])('会话 A→B→A 后不采用旧 A 的 %s', async outcome => {
  const pending = deferred<typeof version>();
  fixture.state.getNoteVersion.mockImplementationOnce(() => pending.promise);
  const page = render(view()); await screen.findByText('合成回答'); open(1);
  page.rerender(view('conversation-2')); await screen.findByText('合成回答');
  page.rerender(view()); await screen.findByText('合成回答');
  await settle(pending, outcome === 'error' ? new Error('旧 A 原文读取失败') : undefined);
  expect(screen.queryByLabelText('引用原文定位')).not.toBeInTheDocument();
  expect(screen.queryByText('旧 A 原文读取失败')).not.toBeInTheDocument();
});

it('旧空间读取失败不污染新空间的助手状态', async () => {
  const pending = deferred<typeof version>();
  fixture.state.getNoteVersion.mockImplementationOnce(() => pending.promise);
  const page = render(view()); await screen.findByText('合成回答'); open(1);
  fixture.state.serverData.currentSpaceId = 'space-2';
  page.rerender(view()); await screen.findByText('合成回答');
  await settle(pending, new Error('旧空间原文读取失败'));
  expect(screen.queryByText('旧空间原文读取失败')).not.toBeInTheDocument();
});

it('当前读取失败仍展示原错误，并可重新点击引用恢复', async () => {
  fixture.state.getNoteVersion.mockRejectedValueOnce(new Error('读取当前原文失败'));
  render(view()); await screen.findByText('合成回答'); open(1);
  await screen.findByText('读取当前原文失败');
  open(2); await screen.findByText('后文', { selector: 'mark' });
  await waitFor(() => expect(screen.queryByText('读取当前原文失败')).not.toBeInTheDocument());
});

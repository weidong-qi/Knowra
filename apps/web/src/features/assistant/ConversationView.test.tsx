vi.mock('./noteActionApi', () => ({ noteActionApi: { list: vi.fn(async () => []), inbox: vi.fn(async () => []) } }));
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssistantView } from './AssistantView';
import { assistantApi } from './assistantApi';
import { notifyAssistantStatusChanged } from './assistantEvents';
import { conversationAttachmentApi } from './conversationAttachmentApi';
import type { ConversationAttachment } from './ConversationAttachmentPicker';
import { conversationApi, type Conversation, type ConversationTurn, type ConversationMessage } from './conversationApi';
import { noteActionApi, type NoteAction } from './noteActionApi';
import { aiFeatures } from '../settings/aiFeatures';

const fixture = vi.hoisted(() => ({
  navigate: vi.fn(),
  state: {
    serverData: { currentSpaceId: 'space-1' as string | null, notes: [{ id: 'note-1', title: '笔记 A', spaceId: 'space-1', deleted: false }], folderTree: [] },
    getNoteVersion: vi.fn(async () => ({ content: '前文 alpha 后文', contentHash: 'e1ad18f75b0295b8a3845a76fc8e148b8eef2107f58336fe9bca6a23ebb608d6' }))
  }
}));

vi.mock('../../app/router', async importOriginal => ({
  ...await importOriginal<typeof import('../../app/router')>(), useNavigate: () => fixture.navigate
}));

vi.mock('../../store/AppStoreProvider', () => ({ useAppStoreApi: () => ({ getState: () => fixture.state }), useAppStore: (selector: (value: typeof fixture.state) => unknown) => selector(fixture.state) }));
vi.mock('../settings/aiFeatures', () => ({ aiFeatures: { get: vi.fn(), set: vi.fn() } }));
vi.mock('./assistantApi', () => ({ assistantApi: { status: vi.fn(), listLegacy: vi.fn(), getLegacy: vi.fn(), allowRule: vi.fn() } }));
vi.mock('./conversationAttachmentApi', () => ({ conversationAttachmentApi: {
  list: vi.fn(), upload: vi.fn(), preview: vi.fn(), content: vi.fn(), remove: vi.fn()
} }));
vi.mock('./conversationApi', () => ({ conversationApi: {
  list: vi.fn(), create: vi.fn(), messages: vi.fn(), send: vi.fn(), turn: vi.fn(), cancel: vi.fn(), retry: vi.fn(), resume: vi.fn(),
  policies: vi.fn(), createPolicy: vi.fn(), revokePolicy: vi.fn()
} }));

const conversation: Conversation = { conversationId: 'conversation-1', spaceId: 'space-1',
  createdAt: '2026-09-27T00:00:00.000Z', updatedAt: '2026-09-27T00:00:00.000Z',
  historicalDataset: false, readOnly: false };
const succeeded: ConversationTurn = { turnId: 'turn-1', conversationId: 'conversation-1',
  requestedPolicyId: null, status: 'succeeded', phase: 'finished', errorCode: null,
  toolCalls: [], modelAttempts: [] };

beforeEach(() => {
  vi.resetAllMocks();
  fixture.state.serverData.currentSpaceId = 'space-1';
  vi.mocked(aiFeatures.get).mockResolvedValue({ knowledgeProposals: true });
  vi.mocked(conversationApi.list).mockResolvedValue([]);
  vi.mocked(noteActionApi.inbox).mockResolvedValue([]);
  vi.mocked(conversationAttachmentApi.list).mockResolvedValue([]);
  vi.mocked(conversationApi.policies).mockResolvedValue([]);
  vi.mocked(conversationApi.messages).mockResolvedValue([]);
  vi.mocked(conversationApi.turn).mockResolvedValue(succeeded);
  vi.mocked(assistantApi.listLegacy).mockResolvedValue([]);
  vi.mocked(assistantApi.status).mockResolvedValue({ provider: 'deepseek', modelId: 'deepseek-flash',
    configured: true, executionLocation: 'server', generationAvailable: true, unavailableReason: null, budget: null,
    capabilities: { readScopes: ['note', 'folder'], actions: ['answer', 'cancel'], responseMode: 'polling',
      writeTools: false, providerAdvertised: null, providerVerified: false } });
});

async function pickScope(index: number) {
  fireEvent.click(screen.getByRole('button', { name: /资料范围/ }));
  fireEvent.click((await screen.findAllByRole('menuitem'))[index]);
}
async function clickScopeAction(name: string) {
  fireEvent.click(screen.getByRole('button', { name: /资料范围/ }));
  fireEvent.click(await screen.findByText(name));
}

it('审阅旧轮成果时不把聊天修改误指向右侧选稿，关闭后恢复发送', async () => {
  const oldAction = { actionId: 'older-action', requestId: 'older-turn', status: 'awaitingApproval',
    plan: { planHash: 'older-hash', toolName: 'notes_create', items: [{ before: null,
      after: { id: 'older-note', title: '旧稿', rawMarkdown: '原内容', folderId: null, tagIds: [] } }] } } as unknown as NoteAction;
  vi.mocked(noteActionApi.inbox).mockResolvedValue([oldAction]);
  vi.mocked(conversationApi.list).mockResolvedValue([conversation]);
  vi.mocked(conversationApi.messages).mockResolvedValue([
    { messageId: 'last-user', turnId: 'turn-1', sequence: 1, role: 'user', content: '新的问题', sourceRefs: [], sourceFree: true, createdAt: conversation.createdAt },
    { messageId: 'last-answer', turnId: 'turn-1', sequence: 2, role: 'assistant', content: '当前回答', sourceRefs: [], sourceFree: true, createdAt: conversation.createdAt }
  ]);
  render(<AssistantView pathname="/assistant?conversationId=conversation-1" onOpenNote={vi.fn()} />);
  await screen.findByText('当前回答');
  fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '把这份改一下' } });
  fireEvent.click(screen.getByRole('button', { name: 'AI 成果收件箱' }));
  fireEvent.click(await screen.findByRole('button', { name: '审阅成果' }));
  expect(screen.getAllByText(/右侧选稿不会改变实际目标/)).toHaveLength(2);
  expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled();
  expect(conversationApi.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '关闭成果' }));
  expect(screen.getByRole('button', { name: '发送消息' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'AI 成果收件箱' }));
  expect(screen.queryByRole('heading', { name: '旧稿' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '发送消息' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '审阅成果' }));
  expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '对话' }));
  fireEvent.click(screen.getByRole('button', { name: 'AI 成果收件箱' }));
  expect(screen.queryByRole('heading', { name: '旧稿' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '发送消息' })).toBeEnabled();
});

it('同一成果 A 建稿到 B 续改后刷新右侧正文与 plan，并允许继续发送 C', async () => {
  const first = { actionId: 'draft-a', requestId: 'turn-a', status: 'awaitingApproval',
    grant: { originTurnId: 'turn-a', revoked: false }, inboxEvents: [],
    plan: { planHash: 'hash-a', toolName: 'notes_create', items: [{ before: null,
      after: { id: 'draft-note', title: '合成新稿', rawMarkdown: '第一版', folderId: null, tagIds: [] } }] } } as unknown as NoteAction;
  const revised: NoteAction = { ...first, inboxEvents: [{ kind: 'revise', requestId: 'turn-b', originTurnId: 'turn-b', resultPlanHash: 'hash-b' }],
    plan: { ...first.plan, planHash: 'hash-b', items: [{ ...first.plan.items[0], after: { ...first.plan.items[0].after, rawMarkdown: '第二版' } }] } };
  const message = (turnId: string, role: ConversationMessage['role'], sequence: number): ConversationMessage => ({
    messageId: `${turnId}-${role}`, turnId, sequence, role, content: role === 'assistant' ? `${turnId} 完成` : `${turnId} 请求`,
    sourceRefs: [], sourceFree: true, createdAt: conversation.createdAt
  });
  let rows: ConversationMessage[] = [message('turn-a', 'user', 1), message('turn-a', 'assistant', 2)];
  let currentAction = first;
  const actionCall = { callId: 'call', ordinal: 1, toolName: 'notes_create' as const, argumentsJson: {},
    resultJson: { actionId: 'draft-a' }, status: 'succeeded' as const, sourceRefs: [], errorCode: null };
  const turnA = { ...succeeded, turnId: 'turn-a', toolCalls: [actionCall] };
  const turnB = { ...succeeded, turnId: 'turn-b', toolCalls: [actionCall] };
  vi.mocked(conversationApi.list).mockResolvedValue([conversation]);
  vi.mocked(conversationApi.messages).mockImplementation(async () => rows);
  vi.mocked(conversationApi.turn).mockImplementation(async (_id, id) => id === 'turn-a' ? turnA : turnB);
  vi.mocked(noteActionApi.inbox).mockImplementation(async () => [currentAction]);
  vi.mocked(conversationApi.send).mockImplementation(async () => {
    currentAction = revised; rows = [...rows, message('turn-b', 'user', 3), message('turn-b', 'assistant', 4)];
    return turnB;
  });
  render(<AssistantView pathname="/assistant?conversationId=conversation-1" onOpenNote={vi.fn()} />);
  await screen.findByText('turn-a 完成');
  fireEvent.click(screen.getByRole('button', { name: 'AI 成果收件箱' }));
  fireEvent.click(await screen.findByRole('button', { name: '审阅成果' }));
  expect(screen.getByText('第一版')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '短一点' } });
  expect(screen.getByRole('button', { name: '发送消息' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  await screen.findByText('第二版');
  expect(screen.queryByText('第一版')).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: '成果预览' })).toHaveTextContent('第二版');
  fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '再改得完整些' } });
  expect(screen.getByRole('button', { name: '发送消息' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  await waitFor(() => expect(conversationApi.send).toHaveBeenCalledTimes(2));
});

it.each(['create', 'upload'] as const)('空白会话切换空间后清除旧附件状态（%s响应迟到）', async phase => {
  let releaseCreate!: (value: Conversation) => void;
  let releaseUpload!: (value: ConversationAttachment) => void;
  const delayedCreate = new Promise<Conversation>(resolve => { releaseCreate = resolve; });
  const delayedUpload = new Promise<ConversationAttachment>(resolve => { releaseUpload = resolve; });
  const created = { ...conversation, conversationId: 'created-a' };
  vi.mocked(conversationApi.create).mockReturnValue(phase === 'create' ? delayedCreate : Promise.resolve(created));
  vi.mocked(conversationAttachmentApi.upload).mockReturnValue(delayedUpload);
  const view = render(<AssistantView pathname="/assistant?new=1" onOpenNote={vi.fn()} />);
  await screen.findByText('服务器执行');
  fireEvent.click(screen.getByText('附件（0）'));
  fireEvent.change(screen.getByLabelText('添加对话附件'), {
    target: { files: [new File(['空间A提供的附件'], 'space-a.txt', { type: 'text/plain' })] }
  });
  await waitFor(() => expect(phase === 'create' ? conversationApi.create : conversationAttachmentApi.upload).toHaveBeenCalledOnce());
  fixture.state.serverData.currentSpaceId = 'space-b';
  view.rerender(<AssistantView pathname="/assistant?new=1" onOpenNote={vi.fn()} />);
  await act(async () => {
    if (phase === 'create') { releaseCreate(created); await delayedCreate; }
    else {
      releaseUpload({ attachmentId: 'old-attachment', conversationId: created.conversationId, revision: 3,
        fileName: 'space-a.txt', mimeType: 'text/plain', size: 10, sha256: 'a'.repeat(64), storageStatus: 'ready',
        parseStatus: 'not_parsed', errorCode: 'AI_ATTACHMENT_NOT_PARSED', parserVersion: null, parsedTextHash: null, imageMetadata: null,
        removedAt: null, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt });
      await delayedUpload;
    }
  });
  expect(screen.queryByText(/space-a.txt/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '重试上传' })).not.toBeInTheDocument();
  if (phase === 'create') expect(conversationAttachmentApi.upload).not.toHaveBeenCalled();
});

it('附件创建会话期间暂停消息发送，迟到创建不会覆盖用户切换的会话', async () => {
  let release!: (value: Conversation) => void;
  const delayed = new Promise<Conversation>(resolve => { release = resolve; });
  vi.mocked(conversationApi.list).mockResolvedValue([conversation]);
  vi.mocked(conversationApi.create).mockReturnValue(delayed);
  const view = render(<AssistantView pathname="/assistant?new=1" onOpenNote={vi.fn()} />);
  await screen.findByText('服务器执行');
  fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '独立问题' } });
  fireEvent.click(screen.getByRole('button', { name: '附件（0）' }));
  const fileInput = await screen.findByLabelText('添加对话附件');
  fireEvent.change(fileInput, { target: { files: [new File(['资料'], '资料.txt', { type: 'text/plain' })] } });
  await waitFor(() => expect(conversationApi.create).toHaveBeenCalledOnce());
  expect(screen.getByRole('button', { name: '处理中…', hidden: true })).toBeDisabled();
  view.rerender(<AssistantView pathname="/assistant?conversationId=conversation-1" onOpenNote={vi.fn()} />);
  await act(async () => { release({ ...conversation, conversationId: 'late-conversation' }); await delayed; });
  expect(conversationAttachmentApi.upload).not.toHaveBeenCalled();
  expect(conversationApi.send).not.toHaveBeenCalled();
  expect(fixture.navigate).not.toHaveBeenCalled();
});

it('迟到的联网恢复快照不覆盖用户关闭的资料读取范围', async () => {
  const policy = { policyId: 'policy-1', revision: 1, spaceId: 'space-1', scope: { kind: 'library' as const },
    egress: true, recipients: ['deepseek'], expiresAt: '2030-01-01T00:00:00Z', revokedAt: null };
  const messages: ConversationMessage[] = [
    { messageId: 'old-user', turnId: 'turn-1', sequence: 1, role: 'user', content: '旧提问', sourceRefs: [], sourceFree: true, createdAt: conversation.createdAt },
    { messageId: 'old-answer', turnId: 'turn-1', sequence: 2, role: 'assistant', content: '旧回答', sourceRefs: [], sourceFree: true, createdAt: conversation.createdAt }
  ];
  let release!: (rows: ConversationMessage[]) => void;
  const delayed = new Promise<ConversationMessage[]>(resolve => { release = resolve; });
  vi.mocked(conversationApi.list).mockResolvedValue([conversation]);
  vi.mocked(conversationApi.policies).mockResolvedValue([policy]);
  vi.mocked(conversationApi.messages).mockResolvedValueOnce(messages).mockReturnValueOnce(delayed).mockResolvedValue(messages);
  vi.mocked(conversationApi.turn).mockResolvedValue({ ...succeeded, requestedPolicyId: 'policy-1', assistantMessageId: 'old-answer' });
  vi.mocked(conversationApi.send).mockResolvedValue({ ...succeeded, turnId: 'turn-2', status: 'running' });
  render(<AssistantView pathname="/assistant?conversationId=conversation-1" onOpenNote={vi.fn()} />);
  await screen.findByText('旧回答');
  expect(screen.getByRole('button', { name: /资料范围：当前知识空间/ })).toBeInTheDocument();
  fireEvent(window, new Event('online'));
  await waitFor(() => expect(conversationApi.messages).toHaveBeenCalledTimes(2));
  await pickScope(0);
  await act(async () => { release(messages); await delayed; });
  expect(screen.getByRole('button', { name: /资料范围：普通聊天/ })).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '新的私事' } });
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  await waitFor(() => expect(conversationApi.send).toHaveBeenCalledWith('conversation-1', expect.objectContaining({ requestedPolicyId: null })));
});

it('初次会话快照也不能覆盖加载期间用户新选择的授权', async () => {
  const policies = ['policy-1', 'policy-2'].map(policyId => ({ policyId, revision: 1, spaceId: 'space-1',
    scope: { kind: 'library' as const }, egress: true, recipients: ['deepseek'], expiresAt: '2030-01-01T00:00:00Z', revokedAt: null }));
  const messages: ConversationMessage[] = [
    { messageId: 'old-user', turnId: 'turn-1', sequence: 1, role: 'user', content: '旧问题', sourceRefs: [], sourceFree: true, createdAt: conversation.createdAt },
    { messageId: 'old-answer', turnId: 'turn-1', sequence: 2, role: 'assistant', content: '旧答复', sourceRefs: [], sourceFree: true, createdAt: conversation.createdAt }
  ];
  let release!: (rows: ConversationMessage[]) => void;
  const delayed = new Promise<ConversationMessage[]>(resolve => { release = resolve; });
  vi.mocked(conversationApi.list).mockResolvedValue([conversation]);
  vi.mocked(conversationApi.policies).mockResolvedValue(policies);
  vi.mocked(conversationApi.messages).mockReturnValueOnce(delayed).mockResolvedValue(messages);
  vi.mocked(conversationApi.turn).mockResolvedValue({ ...succeeded, requestedPolicyId: 'policy-1', assistantMessageId: 'old-answer' });
  vi.mocked(conversationApi.send).mockResolvedValue({ ...succeeded, turnId: 'turn-2', status: 'running' });
  render(<AssistantView pathname="/assistant?conversationId=conversation-1" onOpenNote={vi.fn()} />);
  await waitFor(() => expect(conversationApi.messages).toHaveBeenCalledOnce());
  await screen.findByRole('button', { name: /资料范围/ });
  await pickScope(2);
  await act(async () => { release(messages); await delayed; });
  await screen.findByText('旧答复'); expect(screen.getByRole('button', { name: /资料范围：当前知识空间/ })).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '沿用新选择' } });
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  await waitFor(() => expect(conversationApi.send).toHaveBeenCalledWith('conversation-1', expect.objectContaining({ requestedPolicyId: 'policy-2' })));
});

it('价格档案超过复核日期时，状态面板在预算金额旁提示费用为估算，生成仍可用', async () => {
  vi.mocked(assistantApi.status).mockResolvedValue({ provider: 'deepseek', modelId: 'deepseek-flash',
    configured: true, executionLocation: 'server', generationAvailable: true, unavailableReason: null,
    priceNotice: '价格档案已超过复核日期，显示的费用为估算，可能与实际账单有差异。',
    budget: { day: '2026-10-10', limitMicrounits: 20_000_000, availableMicrounits: 19_000_000, heldMicrounits: 0, spentMicrounits: 1_000_000 },
    capabilities: { readScopes: ['note', 'folder'], actions: ['answer', 'cancel'], responseMode: 'polling',
      writeTools: false, providerAdvertised: null, providerVerified: false } });
  render(<AssistantView pathname="/assistant?new=1" onOpenNote={vi.fn()} />);
  const statusButton = await screen.findByRole('button', { name: /服务器执行/ });
  expect(screen.getByRole('textbox', { name: '消息' })).toBeEnabled();
  fireEvent.click(statusButton);
  expect(await screen.findByText('今日可用 19.00 元')).toBeInTheDocument();
  expect(screen.getByText('价格档案已超过复核日期，显示的费用为估算，可能与实际账单有差异。')).toBeInTheDocument();
});

it('没有笔记选择时可直接创建普通聊天，发送请求不带读取授权', async () => {
  vi.mocked(conversationApi.create).mockImplementation(async (_space, id) => ({ ...conversation, conversationId: id }));
  vi.mocked(conversationApi.send).mockResolvedValue({ ...succeeded, status: 'running', phase: 'generating' });
  render(<AssistantView pathname="/assistant?new=1" onOpenNote={vi.fn()} />);
  expect(await screen.findByText('服务器执行')).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: '本轮用途' })).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: '本轮固定写入目标' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '解释梯度下降' } });
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  await waitFor(() => expect(conversationApi.send).toHaveBeenCalledOnce());
  expect(conversationApi.create).toHaveBeenCalledWith('space-1', expect.any(String));
  expect(conversationApi.send).toHaveBeenCalledWith(expect.any(String), {
    content: '解释梯度下降', idempotencyKey: expect.any(String), requestedPolicyId: null
  });
});

it('已有会话沿用原会话 ID 追问，不创建第二个会话', async () => {
  vi.mocked(conversationApi.list).mockResolvedValue([conversation]);
  vi.mocked(conversationApi.messages).mockResolvedValue([{ messageId: 'message-1', turnId: 'turn-1', sequence: 1,
    role: 'user', content: '第一问', sourceRefs: [], sourceFree: true, createdAt: conversation.createdAt },
  { messageId: 'message-2', turnId: 'turn-1', sequence: 2, role: 'assistant', content: '第一答',
    sourceRefs: [], citations: [], sourceFree: true, createdAt: conversation.createdAt }]);
  vi.mocked(conversationApi.send).mockResolvedValue({ ...succeeded, turnId: 'turn-2', status: 'running', phase: 'generating' });
  render(<AssistantView pathname="/assistant?conversationId=conversation-1" onOpenNote={vi.fn()} />);
  expect(await screen.findByText('第一答')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '为什么？' } });
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  await waitFor(() => expect(conversationApi.send).toHaveBeenCalledWith('conversation-1',
    expect.objectContaining({ content: '为什么？', requestedPolicyId: null })));
  expect(conversationApi.create).not.toHaveBeenCalled();
});

it('响应中断后重试同一发送意图，复用幂等键', async () => {
  vi.mocked(conversationApi.create).mockImplementation(async (_space, id) => ({ ...conversation, conversationId: id }));
  vi.mocked(conversationApi.send).mockRejectedValueOnce(new Error('连接中断'))
    .mockResolvedValue({ ...succeeded, status: 'running', phase: 'generating' });
  render(<AssistantView pathname="/assistant?new=1" onOpenNote={vi.fn()} />);
  await screen.findByText('服务器执行');
  fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '问题' } });
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  expect(await screen.findByText(/连接中断/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重试发送' }));
  await waitFor(() => expect(conversationApi.send).toHaveBeenCalledTimes(2));
  expect(vi.mocked(conversationApi.send).mock.calls[1]).toEqual(vi.mocked(conversationApi.send).mock.calls[0]);
  expect(vi.mocked(conversationApi.create).mock.calls[1]).toEqual(vi.mocked(conversationApi.create).mock.calls[0]);
});

it('恢复历史消息与引用，来源打开历史版本，检索记录按需加载', async () => {
  vi.mocked(conversationApi.list).mockResolvedValue([conversation]);
  vi.mocked(conversationApi.messages).mockResolvedValue([{ messageId: 'message-1', turnId: 'turn-1', sequence: 1,
    role: 'user', content: '问题', sourceRefs: [], sourceFree: true, createdAt: conversation.createdAt },
  { messageId: 'message-2', turnId: 'turn-1', sequence: 2, role: 'assistant', content: '回答',
    sourceRefs: [], citations: [{ noteId: 'note-1', noteVersionId: 'version-1',
      contentHash: 'e1ad18f75b0295b8a3845a76fc8e148b8eef2107f58336fe9bca6a23ebb608d6',
      start: 3, end: 8, quoteHash: '8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8' }],
    sourceFree: false, createdAt: conversation.createdAt }]);
  vi.mocked(conversationApi.turn).mockResolvedValue({ ...succeeded, toolCalls: [{ callId: 'call-1', ordinal: 1,
    toolName: 'notes_search', argumentsJson: { query: 'alpha' }, resultJson: { hits: [], mode: 'keyword_fallback' },
    status: 'succeeded', sourceRefs: [], errorCode: null }] });
  const openNote = vi.fn();
  render(<AssistantView pathname="/assistant?conversationId=conversation-1" onOpenNote={openNote} />);
  expect(await screen.findByText('回答')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /来源 1 · 笔记 A/ }));
  expect(await screen.findByLabelText('引用原文定位')).toBeInTheDocument();
  expect(screen.getByText('alpha', { selector: 'mark' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '打开当前笔记' }));
  expect(openNote).toHaveBeenCalledWith('note-1');
  fireEvent.click(screen.getByText('检索与调用记录'));
  expect(await screen.findByText(/检索笔记/)).toBeInTheDocument();
  expect(screen.getByText(/索引无可用结果，已改用关键词检索/)).toBeInTheDocument();
});

it('旧轮检索记录只在展开时读取，失败可重开恢复，已载记录不重复请求', async () => {
  vi.mocked(conversationApi.list).mockResolvedValue([conversation]);
  vi.mocked(conversationApi.messages).mockResolvedValue([
    { messageId: 'old-answer', turnId: 'old-turn', sequence: 1, role: 'assistant', content: '旧轮回答', sourceRefs: [], sourceFree: true, createdAt: conversation.createdAt },
    { messageId: 'latest-question', turnId: 'turn-1', sequence: 2, role: 'user', content: '本轮问题', sourceRefs: [], sourceFree: true, createdAt: conversation.createdAt }
  ]);
  let attempts = 0;
  vi.mocked(conversationApi.turn).mockImplementation(async (_id, turnId) => {
    if (turnId !== 'old-turn') return { ...succeeded, status: 'failed', errorCode: 'AI_TEST_STOPPED' };
    if (++attempts === 1) throw new Error('检索记录读取失败');
    return { ...succeeded, turnId: 'old-turn' };
  });
  render(<AssistantView pathname="/assistant?conversationId=conversation-1" onOpenNote={vi.fn()} />);
  await screen.findByText('旧轮回答');
  expect(attempts).toBe(0);
  const summary = screen.getByText('检索与调用记录');
  const details = summary.closest('details')!;
  fireEvent.click(summary);
  expect(await screen.findByRole('alert')).toHaveTextContent('检索记录读取失败');
  fireEvent.click(summary);
  await waitFor(() => expect(details.open).toBe(false));
  fireEvent.click(summary);
  await screen.findByText('本轮没有检索或阅读工具记录。');
  expect(attempts).toBe(2);
  expect(screen.getByText('检索与调用记录').closest('details')).toBe(details);
  expect(details.open).toBe(true);
  fireEvent.click(summary);
  await waitFor(() => expect(details.open).toBe(false));
  fireEvent.click(summary);
  await waitFor(() => expect(details.open).toBe(true));
  expect(attempts).toBe(2);
});

it('中断轮次可重试，模型不可用时仍可回看消息且不能发送', async () => {
  vi.mocked(conversationApi.list).mockResolvedValue([conversation]);
  vi.mocked(conversationApi.messages).mockResolvedValue([{ messageId: 'message-1', turnId: 'turn-1', sequence: 1,
    role: 'user', content: '未完成的问题', sourceRefs: [], sourceFree: true, createdAt: conversation.createdAt }]);
  vi.mocked(conversationApi.turn).mockResolvedValue({ ...succeeded, status: 'interrupted', phase: 'finished', errorCode: 'AI_PROVIDER_UNAVAILABLE' });
  vi.mocked(assistantApi.status).mockResolvedValue({ provider: 'deepseek', modelId: 'deepseek-flash',
    configured: true, executionLocation: 'server', generationAvailable: false,
    unavailableReason: '模型服务暂时不可用。', budget: null,
    capabilities: { readScopes: ['note', 'folder'], actions: ['answer', 'cancel'], responseMode: 'polling',
      writeTools: false, providerAdvertised: null, providerVerified: false } });
  render(<AssistantView pathname="/assistant?conversationId=conversation-1" onOpenNote={vi.fn()} />);
  expect(await screen.findByText('未完成的问题', { selector: 'p' })).toBeInTheDocument();
  expect(screen.getByText('模型服务暂时不可用。')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '重试本轮' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled();
});

it('每日预算拦截本轮时给出“提高上限 / 今日放行”出口，放行后刷新状态', async () => {
  vi.mocked(conversationApi.list).mockResolvedValue([conversation]);
  vi.mocked(conversationApi.messages).mockResolvedValue([{ messageId: 'message-1', turnId: 'turn-1', sequence: 1,
    role: 'user', content: '被拦截的问题', sourceRefs: [], sourceFree: true, createdAt: conversation.createdAt }]);
  vi.mocked(conversationApi.turn).mockResolvedValue({ ...succeeded, status: 'failed', phase: 'finished', errorCode: 'AI_DAILY_BUDGET_EXCEEDED' });
  const status = { provider: 'deepseek' as const, modelId: 'deepseek-flash', configured: true, executionLocation: 'server' as const,
    generationAvailable: true, unavailableReason: null, budget: null,
    capabilities: { readScopes: ['note' as const, 'folder' as const], actions: ['answer' as const, 'cancel' as const], responseMode: 'polling' as const,
      writeTools: false as const, providerAdvertised: null, providerVerified: false } };
  vi.mocked(assistantApi.status).mockResolvedValue(status);
  vi.mocked(assistantApi.allowRule).mockResolvedValue({ day: '2026-10-08', location: 'server', alerts: [], rules: [], overrides: [{ rule: 'daily', period: '2026-10-08' }], pauses: [] });
  render(<AssistantView pathname="/assistant?conversationId=conversation-1" onOpenNote={vi.fn()} />);
  expect(await screen.findByText('费用上限已拦截本轮，可调整后继续：')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '提高上限' }));
  expect(fixture.navigate).toHaveBeenCalledWith('/settings');
  fireEvent.click(screen.getByRole('button', { name: '今日放行' }));
  await waitFor(() => expect(assistantApi.allowRule).toHaveBeenCalledWith('daily'));
  expect(await screen.findByText(/今日已放行/)).toBeInTheDocument();
});

it('费用提醒里解除暂停后，助手状态立即刷新为可发送，不必手动重读', async () => {
  vi.mocked(conversationApi.list).mockResolvedValue([conversation]);
  vi.mocked(conversationApi.messages).mockResolvedValue([]);
  const base = { provider: 'deepseek' as const, modelId: 'deepseek-flash', configured: true, executionLocation: 'server' as const, budget: null,
    capabilities: { readScopes: ['note' as const, 'folder' as const], actions: ['answer' as const, 'cancel' as const], responseMode: 'polling' as const,
      writeTools: false as const, providerAdvertised: null, providerVerified: false } };
  vi.mocked(assistantApi.status).mockResolvedValueOnce({ ...base, generationAvailable: false, unavailableReason: 'AI 已按您的操作暂停至明天，可在费用提醒处恢复。' })
    .mockResolvedValue({ ...base, generationAvailable: true, unavailableReason: null });
  render(<AssistantView pathname="/assistant?conversationId=conversation-1" onOpenNote={vi.fn()} />);
  expect(await screen.findByText(/暂停至明天/)).toBeInTheDocument();
  act(() => notifyAssistantStatusChanged());
  await waitFor(() => expect(screen.queryByText(/暂停至明天/)).not.toBeInTheDocument());
});

it('首次授权明确的知识空间范围后，提问使用该授权并可撤销', async () => {
  const policy = { policyId: 'policy-1', revision: 1, spaceId: 'space-1',
    scope: { kind: 'library' as const }, egress: true, recipients: ['deepseek'],
    expiresAt: '2030-01-01T00:00:00.000Z', revokedAt: null };
  vi.mocked(conversationApi.createPolicy).mockResolvedValue(policy);
  vi.mocked(conversationApi.create).mockImplementation(async (_space, id) => ({ ...conversation, conversationId: id }));
  vi.mocked(conversationApi.send).mockResolvedValue({ ...succeeded, status: 'running', phase: 'generating' });
  vi.mocked(conversationApi.revokePolicy).mockResolvedValue({ ...policy, revision: 2, revokedAt: '2026-09-28T00:00:00.000Z' });
  render(<AssistantView pathname="/assistant?new=1" onOpenNote={vi.fn()} />);
  await screen.findByText('服务器执行');
  await clickScopeAction('设置读取范围');
  expect(await screen.findByRole('dialog', { name: '授权助手读取资料' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '确认授权' }));
  await waitFor(() => expect(conversationApi.createPolicy).toHaveBeenCalledWith(expect.objectContaining({
    spaceId: 'space-1', scope: { kind: 'library' }, expiresAt: expect.any(String)
  })));
  fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '总结资料' } });
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  await waitFor(() => expect(conversationApi.send).toHaveBeenCalledWith(expect.any(String),
    expect.objectContaining({ content: '总结资料', requestedPolicyId: 'policy-1' })));
  await clickScopeAction('撤销此授权');
  await waitFor(() => expect(conversationApi.revokePolicy).toHaveBeenCalledWith(policy));
});

it('运行轮次可停止，中断轮次可显式重试', async () => {
  vi.mocked(conversationApi.list).mockResolvedValue([conversation]);
  vi.mocked(conversationApi.messages).mockResolvedValue([{ messageId: 'message-1', turnId: 'turn-1', sequence: 1,
    role: 'user', content: '待处理的问题', sourceRefs: [], sourceFree: true, createdAt: conversation.createdAt }]);
  vi.mocked(conversationApi.turn).mockResolvedValueOnce({ ...succeeded, status: 'running', phase: 'retrieving' })
    .mockResolvedValue({ ...succeeded, status: 'interrupted', phase: 'finished' });
  vi.mocked(conversationApi.cancel).mockResolvedValue({ ...succeeded, status: 'cancelled' });
  vi.mocked(conversationApi.retry).mockResolvedValue({ ...succeeded, status: 'running', phase: 'waiting' });
  render(<AssistantView pathname="/assistant?conversationId=conversation-1" onOpenNote={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: '停止生成' }));
  await waitFor(() => expect(conversationApi.cancel).toHaveBeenCalledWith('conversation-1', 'turn-1'));
  fireEvent.click(await screen.findByRole('button', { name: '重试本轮' }));
  await waitFor(() => expect(conversationApi.retry).toHaveBeenCalledWith('conversation-1', 'turn-1'));
});

it('安全继续调用resume，不改走显式retry', async () => {
  vi.mocked(conversationApi.list).mockResolvedValue([conversation]);
  vi.mocked(conversationApi.messages).mockResolvedValue([{ messageId: 'message-1', turnId: 'turn-1', sequence: 1,
    role: 'user', content: '中断问题', sourceRefs: [], sourceFree: true, createdAt: conversation.createdAt }]);
  vi.mocked(conversationApi.turn).mockResolvedValue({ ...succeeded, status: 'interrupted' });
  vi.mocked(conversationApi.resume).mockResolvedValue({ ...succeeded, status: 'running' });
  render(<AssistantView pathname="/assistant?conversationId=conversation-1" onOpenNote={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: '从检查点继续' }));
  await waitFor(() => expect(conversationApi.resume).toHaveBeenCalledWith('conversation-1', 'turn-1'));
  expect(conversationApi.retry).not.toHaveBeenCalled();
});

it('未知发送不能安全继续，显式重试前确认可能重复费用', async () => {
  vi.mocked(conversationApi.list).mockResolvedValue([conversation]);
  vi.mocked(conversationApi.messages).mockResolvedValue([{ messageId: 'message-1', turnId: 'turn-1', sequence: 1,
    role: 'user', content: '发送中断问题', sourceRefs: [], sourceFree: true, createdAt: conversation.createdAt }]);
  vi.mocked(conversationApi.turn).mockResolvedValue({ ...succeeded, status: 'interrupted',
    modelAttempts: [{ attemptId: 'unknown', status: 'unknown', actualMicrounits: null, ordinal: 1, modelResult: null }] });
  vi.mocked(conversationApi.retry).mockResolvedValue({ ...succeeded, status: 'running' });
  render(<AssistantView pathname="/assistant?conversationId=conversation-1" onOpenNote={vi.fn()} />);
  expect(await screen.findByRole('button', { name: '从检查点继续' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '重试本轮' }));
  await screen.findByRole('dialog', { name: '确认重新调用模型' }); expect(conversationApi.retry).not.toHaveBeenCalled();
  expect(screen.getByText(/重试会重新调用模型/)).toHaveTextContent('重复费用');
  fireEvent.click(screen.getByRole('button', { name: '确认重试本轮' }));
  await waitFor(() => expect(conversationApi.retry).toHaveBeenCalledWith('conversation-1', 'turn-1'));
  expect(conversationApi.resume).not.toHaveBeenCalled();
});

it('旧版任务走历史只读入口，不显示旧版创建与取消操作', async () => {
  const job = { jobId: 'old-job', spaceId: 'space-1', question: '旧问题',
    status: 'succeeded' as const, phase: 'finished', modelId: 'deepseek-flash',
    createdAt: conversation.createdAt, updatedAt: conversation.updatedAt,
    result: { answer: '旧回答', citations: [] } };
  vi.mocked(assistantApi.listLegacy).mockResolvedValue([job]);
  vi.mocked(assistantApi.getLegacy).mockResolvedValue(job);
  render(<AssistantView pathname="/assistant?view=legacy" onOpenNote={vi.fn()} />);
  expect(await screen.findByText('旧回答')).toBeInTheDocument();
  expect(assistantApi.listLegacy).toHaveBeenCalledWith('space-1');
  expect(screen.queryByRole('button', { name: '预览发送范围' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '取消任务' })).not.toBeInTheDocument();
});

it('消息读取后轮次完成时补读结果，不能因新终态停在旧用户消息', async () => {
  const user = { messageId: 'race-user', turnId: 'turn-1', sequence: 1,
    role: 'user' as const, content: '生成合成笔记', sourceRefs: [], sourceFree: true, createdAt: conversation.createdAt };
  const answer = { ...user, messageId: 'race-answer', sequence: 2, role: 'assistant' as const,
    content: '已生成笔记计划，尚未写入。请在执行记录中查看差异并确认。' };
  vi.mocked(conversationApi.list).mockResolvedValue([conversation]);
  // 两个请求之间服务器已完成；旧消息快照与新终态都是合法响应。
  vi.mocked(conversationApi.messages).mockResolvedValueOnce([user]).mockResolvedValue([user, answer]);
  vi.mocked(conversationApi.turn).mockResolvedValue({ ...succeeded, assistantMessageId: answer.messageId });
  render(<AssistantView pathname="/assistant?conversationId=conversation-1" onOpenNote={vi.fn()} />);
  expect(await screen.findByText(answer.content, { selector: 'p' })).toBeInTheDocument();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const raceUser = { messageId: 'race-user', turnId: 'turn-1', sequence: 1,
  role: 'user' as const, content: '合成问题', sourceRefs: [], sourceFree: true, createdAt: conversation.createdAt };
const raceAnswer = { ...raceUser, messageId: 'race-answer', sequence: 2, role: 'assistant' as const, content: '新的完整合成回答' };

it('晚到的旧消息读取不覆盖已经展示的新快照', async () => {
  const oldRead = deferred<typeof raceUser[]>();
  vi.mocked(conversationApi.list).mockResolvedValue([conversation]);
  vi.mocked(conversationApi.messages).mockReturnValueOnce(oldRead.promise).mockResolvedValue([raceUser, raceAnswer]);
  vi.mocked(conversationApi.turn).mockResolvedValue({ ...succeeded, assistantMessageId: raceAnswer.messageId });
  render(<AssistantView pathname="/assistant?conversationId=conversation-1" onOpenNote={vi.fn()} />);
  await waitFor(() => expect(conversationApi.messages).toHaveBeenCalledOnce());
  fireEvent(window, new Event('online'));
  expect(await screen.findByText(raceAnswer.content, { selector: 'p' })).toBeInTheDocument();
  await act(async () => { oldRead.resolve([raceUser]); await oldRead.promise; });
  expect(screen.getByText(raceAnswer.content, { selector: 'p' })).toBeInTheDocument();
});

it('切换会话再回来后，旧会话同ID的未完成读取仍然失效', async () => {
  const oldRead = deferred<typeof raceUser[]>();
  const second = { ...conversation, conversationId: 'conversation-2' };
  const secondAnswer = { ...raceAnswer, messageId: 'second-answer', turnId: 'turn-2', content: '第二会话合成回答' };
  vi.mocked(conversationApi.list).mockResolvedValue([conversation, second]);
  vi.mocked(conversationApi.messages).mockReturnValueOnce(oldRead.promise)
    .mockResolvedValueOnce([secondAnswer]).mockResolvedValue([raceUser, raceAnswer]);
  vi.mocked(conversationApi.turn).mockImplementation(async (id, turnId) => ({ ...succeeded,
    conversationId: id, turnId, assistantMessageId: id === second.conversationId ? secondAnswer.messageId : raceAnswer.messageId }));
  const view = render(<AssistantView pathname="/assistant?conversationId=conversation-1" onOpenNote={vi.fn()} />);
  await waitFor(() => expect(conversationApi.messages).toHaveBeenCalledOnce());
  view.rerender(<AssistantView pathname="/assistant?conversationId=conversation-2" onOpenNote={vi.fn()} />);
  expect(await screen.findByText(secondAnswer.content, { selector: 'p' })).toBeInTheDocument();
  view.rerender(<AssistantView pathname="/assistant?conversationId=conversation-1" onOpenNote={vi.fn()} />);
  expect(await screen.findByText(raceAnswer.content, { selector: 'p' })).toBeInTheDocument();
  await act(async () => { oldRead.resolve([raceUser]); await oldRead.promise; });
  expect(screen.getByText(raceAnswer.content, { selector: 'p' })).toBeInTheDocument();
});

it('终态缺失的答案补读仍不一致时明确报错并提供重新加载', async () => {
  vi.mocked(conversationApi.list).mockResolvedValue([conversation]);
  vi.mocked(conversationApi.messages).mockResolvedValue([raceUser]);
  vi.mocked(conversationApi.turn).mockResolvedValue({ ...succeeded, assistantMessageId: raceAnswer.messageId });
  render(<AssistantView pathname="/assistant?conversationId=conversation-1" onOpenNote={vi.fn()} />);
  expect(await screen.findByText(/回答已完成，但消息尚未完整读取/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '重新加载助手' })).toBeEnabled();
  expect(conversationApi.messages).toHaveBeenCalledTimes(2);
});

const policyOf = (overrides: Record<string, unknown> = {}) => ({ policyId: 'policy-1', spaceId: 'space-1', scope: { kind: 'library' }, excludedNoteIds: [],
  includeAttachments: false, read: true, egress: true, recipients: ['deepseek'], revision: 1, issuedAt: '2026-09-27T00:00:00.000Z',
  expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: null, ...overrides }) as never;

it('从编辑器进入提炼知识点：预填含笔记标题与 ID 的请求；没有覆盖本篇的授权时打开授权对话框，不自动授权也不自动发送', async () => {
  render(<AssistantView pathname="/assistant?new=1&noteId=note-1&intent=extract" onOpenNote={vi.fn()} />);
  const box = await screen.findByRole('textbox', { name: '消息' });
  await waitFor(() => expect(box).toHaveValue('请根据我在笔记《笔记 A》（noteId: note-1）里标记的重点，提炼知识点。'));
  expect(await screen.findByRole('dialog', { name: '授权助手读取资料' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '确认授权' })).toBeEnabled();
  expect(conversationApi.createPolicy).not.toHaveBeenCalled();
  expect(conversationApi.send).not.toHaveBeenCalled();
});

it.each([
  ['整个知识空间', { scope: { kind: 'library' } }],
  ['仅本篇', { scope: { kind: 'fixed', noteIds: ['note-1'] } }]
])('提炼入口遇到已覆盖本篇的有效授权（%s）直接选用，不再弹出授权对话框', async (_name, overrides) => {
  vi.mocked(conversationApi.policies).mockResolvedValue([policyOf(overrides)]);
  render(<AssistantView pathname="/assistant?new=1&noteId=note-1&intent=extract" onOpenNote={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('textbox', { name: '消息' })).toHaveValue('请根据我在笔记《笔记 A》（noteId: note-1）里标记的重点，提炼知识点。'));
  expect(await screen.findByText(/已选用现有读取授权/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /资料范围：(当前知识空间|笔记：笔记 A)/ })).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: '授权助手读取资料' })).not.toBeInTheDocument();
  expect(conversationApi.send).not.toHaveBeenCalled();
});

it('提炼入口不选用已撤销、已过期、外发关闭、不覆盖本篇、排除了本篇、关闭读取或接收方不含 DeepSeek 的授权', async () => {
  vi.mocked(conversationApi.policies).mockResolvedValue([
    policyOf({ policyId: 'revoked', revokedAt: '2026-09-28T00:00:00.000Z' }), policyOf({ policyId: 'expired', expiresAt: '2020-01-01T00:00:00.000Z' }),
    policyOf({ policyId: 'no-egress', egress: false }), policyOf({ policyId: 'other', scope: { kind: 'fixed', noteIds: ['note-2'] } }),
    policyOf({ policyId: 'excluded-library', excludedNoteIds: ['note-1'] }), policyOf({ policyId: 'excluded-fixed', scope: { kind: 'fixed', noteIds: ['note-1'] }, excludedNoteIds: ['note-1'] }),
    policyOf({ policyId: 'excluded-folder', scope: { kind: 'folder', folderId: 'folder-1' }, excludedNoteIds: ['note-1'] }),
    policyOf({ policyId: 'no-read', read: false }), policyOf({ policyId: 'other-recipient', recipients: ['someone-else'] })]);
  render(<AssistantView pathname="/assistant?new=1&noteId=note-1&intent=extract" onOpenNote={vi.fn()} />);
  expect(await screen.findByRole('dialog', { name: '授权助手读取资料' })).toBeInTheDocument();
  expect(screen.queryByText(/已选用现有读取授权/)).not.toBeInTheDocument();
});

it('提炼入口：笔记不存在、缺少 intent 或不是新对话时不预填也不弹窗', async () => {
  for (const path of ['/assistant?new=1&noteId=missing&intent=extract', '/assistant?new=1&noteId=note-1', '/assistant?noteId=note-1&intent=extract']) {
    const view = render(<AssistantView pathname={path} onOpenNote={vi.fn()} />);
    await screen.findByRole('textbox', { name: '消息' });
    await waitFor(() => expect(conversationApi.policies).toHaveBeenCalled());
    expect(screen.getByRole('textbox', { name: '消息' })).toHaveValue('');
    expect(screen.queryByRole('dialog', { name: '授权助手读取资料' })).not.toBeInTheDocument();
    view.unmount(); vi.mocked(conversationApi.policies).mockClear();
  }
});

it('执行记录：重点读取与知识候选提交有各自的标签和摘要，不再误标成“生成笔记计划”，并可前往知识库审核', async () => {
  vi.mocked(conversationApi.list).mockResolvedValue([conversation]);
  vi.mocked(conversationApi.messages).mockResolvedValue([{ messageId: 'message-1', turnId: 'turn-1', sequence: 1,
    role: 'user', content: '提炼知识点', sourceRefs: [], sourceFree: true, createdAt: conversation.createdAt },
  { messageId: 'message-2', turnId: 'turn-1', sequence: 2, role: 'assistant', content: '已提交', sourceRefs: [], citations: [], sourceFree: true, createdAt: conversation.createdAt }]);
  vi.mocked(conversationApi.turn).mockResolvedValue({ ...succeeded, toolCalls: [
    { callId: 'c1', ordinal: 1, toolName: 'annotations_list', argumentsJson: { noteId: 'note-1' }, resultJson: { total: 13, annotations: new Array(8).fill({}) },
      status: 'succeeded', sourceRefs: new Array(8).fill({ noteId: 'note-1' }) as never, errorCode: null },
    { callId: 'c2', ordinal: 2, toolName: 'knowledge_propose', argumentsJson: {}, resultJson: { saved: true, candidates: [{}, {}] },
      status: 'succeeded', sourceRefs: [], errorCode: null },
    { callId: 'c3', ordinal: 3, toolName: 'knowledge_propose', argumentsJson: {}, resultJson: null,
      status: 'failed', sourceRefs: [], errorCode: 'AI_PROPOSAL_CITATION_INVALID' }] });
  render(<AssistantView pathname="/assistant?conversationId=conversation-1" onOpenNote={vi.fn()} />);
  expect(await screen.findByText('已提交')).toBeInTheDocument();
  fireEvent.click(screen.getByText('检索与调用记录'));
  expect(await screen.findByText('读取重点标记')).toBeInTheDocument();
  expect(screen.getByText(/共 13 处重点，本页 8 处 · 8 个来源片段/)).toBeInTheDocument();
  expect(screen.getAllByText('提交知识候选（待审核）')).toHaveLength(2);
  expect(screen.getByText(/已保存 2 条候选，尚未入库，需在知识库审核/)).toBeInTheDocument();
  expect(screen.getByText(/失败：AI_PROPOSAL_CITATION_INVALID/)).toBeInTheDocument();
  expect(screen.queryByText(/生成笔记计划/)).not.toBeInTheDocument();
  expect(screen.queryByText(/0 个来源片段/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '在知识库审核候选' }));
  expect(fixture.navigate).toHaveBeenCalledWith('/knowledge');
});

it('提炼知识点功能未开启：入口仍可进入，预填请求但不选用也不弹出授权，只说明“该功能未开启，可在设置中开启”并可前往设置', async () => {
  vi.mocked(aiFeatures.get).mockResolvedValue({ knowledgeProposals: false });
  vi.mocked(conversationApi.policies).mockResolvedValue([policyOf()]);
  render(<AssistantView pathname="/assistant?new=1&noteId=note-1&intent=extract" onOpenNote={vi.fn()} />);
  expect(await screen.findByText('该功能未开启，可在设置中开启。')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('textbox', { name: '消息' })).toHaveValue('请根据我在笔记《笔记 A》（noteId: note-1）里标记的重点，提炼知识点。'));
  expect(screen.queryByRole('dialog', { name: '授权助手读取资料' })).not.toBeInTheDocument();
  expect(screen.queryByText(/已选用现有读取授权/)).not.toBeInTheDocument();
  expect(conversationApi.createPolicy).not.toHaveBeenCalled(); expect(conversationApi.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '前往设置' }));
  expect(fixture.navigate).toHaveBeenCalledWith('/settings');
});

it('无法读取功能开关时按未开启处理并提示在设置中查看，不弹出授权', async () => {
  vi.mocked(aiFeatures.get).mockRejectedValue(new Error('offline'));
  render(<AssistantView pathname="/assistant?new=1&noteId=note-1&intent=extract" onOpenNote={vi.fn()} />);
  expect(await screen.findByText(/无法确认“AI 提炼知识点”是否已开启/)).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: '授权助手读取资料' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '前往设置' })).toBeEnabled();
});

it('功能已开启或不是提炼入口时不显示未开启提示，也不读取开关', async () => {
  render(<AssistantView pathname="/assistant?new=1&noteId=note-1&intent=extract" onOpenNote={vi.fn()} />);
  expect(await screen.findByRole('dialog', { name: '授权助手读取资料' })).toBeInTheDocument();
  expect(screen.queryByText('该功能未开启，可在设置中开启。')).not.toBeInTheDocument();
  expect(aiFeatures.get).toHaveBeenCalledTimes(1);
  vi.mocked(aiFeatures.get).mockClear();
  render(<AssistantView pathname="/assistant?new=1" onOpenNote={vi.fn()} />);
  await waitFor(() => expect(conversationApi.policies).toHaveBeenCalled());
  expect(aiFeatures.get).not.toHaveBeenCalled();
});

it('提炼入口：授权只排除了其他笔记时仍然覆盖本篇，直接选用', async () => {
  vi.mocked(conversationApi.policies).mockResolvedValue([policyOf({ excludedNoteIds: ['note-2'] })]);
  render(<AssistantView pathname="/assistant?new=1&noteId=note-1&intent=extract" onOpenNote={vi.fn()} />);
  expect(await screen.findByText(/已选用现有读取授权/)).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: '授权助手读取资料' })).not.toBeInTheDocument();
});

it('提炼入口：目录授权按祖先目录覆盖本篇；同一目录授权若排除了本篇则不选用并打开授权对话框', async () => {
  const state = fixture.state.serverData as { notes: Record<string, unknown>[]; folderTree: Record<string, unknown>[] };
  const previous = { notes: state.notes, folderTree: state.folderTree };
  state.notes = [{ id: 'note-1', title: '笔记 A', spaceId: 'space-1', folderId: 'folder-child', deleted: false }];
  state.folderTree = [{ id: 'folder-root', name: '根', parentId: null, spaceId: 'space-1', children: [] }, { id: 'folder-child', name: '子', parentId: 'folder-root', spaceId: 'space-1', children: [] }];
  try {
    vi.mocked(conversationApi.policies).mockResolvedValue([policyOf({ scope: { kind: 'folder', folderId: 'folder-root' } })]);
    const covered = render(<AssistantView pathname="/assistant?new=1&noteId=note-1&intent=extract" onOpenNote={vi.fn()} />);
    expect(await screen.findByText(/已选用现有读取授权/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '授权助手读取资料' })).not.toBeInTheDocument();
    covered.unmount();
    vi.mocked(conversationApi.policies).mockResolvedValue([policyOf({ scope: { kind: 'folder', folderId: 'folder-root' }, excludedNoteIds: ['note-1'] })]);
    render(<AssistantView pathname="/assistant?new=1&noteId=note-1&intent=extract" onOpenNote={vi.fn()} />);
    expect(await screen.findByRole('dialog', { name: '授权助手读取资料' })).toBeInTheDocument();
    expect(screen.queryByText(/已选用现有读取授权/)).not.toBeInTheDocument();
  } finally { Object.assign(state, previous); }
});


it('知识空间延迟初始化时阻止附件入口和粘贴，加载完成后可正常上传', async () => {
  fixture.state.serverData.currentSpaceId = null;
  vi.mocked(conversationApi.create).mockResolvedValue(conversation);
  vi.mocked(conversationAttachmentApi.upload).mockResolvedValue({
    attachmentId: 'attachment', conversationId: conversation.conversationId, revision: 1,
    fileName: '初始化后.txt', mimeType: 'text/plain', size: 6, sha256: 'a'.repeat(64), storageStatus: 'ready',
    parseStatus: 'not_parsed', errorCode: 'AI_ATTACHMENT_NOT_PARSED', parserVersion: null, parsedTextHash: null,
    imageMetadata: null, removedAt: null, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt
  });
  const view = render(<AssistantView pathname="/assistant?new=1" onOpenNote={vi.fn()} />);
  expect(screen.getByRole('button', { name: '附件（0）' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '附件（0）' }));
  const paste = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(paste, 'clipboardData', { value: { items: [{ kind: 'file', type: 'image/png',
    getAsFile: () => new File(['png'], 'clipboard.png', { type: 'image/png' }) }] } });
  fireEvent(screen.getByRole('textbox', { name: '消息' }), paste);
  expect(paste.defaultPrevented).toBe(false);
  expect(screen.queryByRole('dialog', { name: '对话附件管理' })).not.toBeInTheDocument();
  expect(conversationApi.create).not.toHaveBeenCalled();
  expect(conversationAttachmentApi.upload).not.toHaveBeenCalled();
  fixture.state.serverData.currentSpaceId = 'space-1';
  view.rerender(<AssistantView pathname="/assistant?new=1" onOpenNote={vi.fn()} />);
  expect(screen.getByRole('button', { name: '附件（0）' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '附件（0）' }));
  fireEvent.change(await screen.findByLabelText('添加对话附件'), {
    target: { files: [new File(['合成文本'], '初始化后.txt', { type: 'text/plain' })] }
  });
  await screen.findByRole('button', { name: '预览 初始化后.txt' });
  expect(conversationApi.create).toHaveBeenCalledWith('space-1', expect.any(String));
  expect(conversationAttachmentApi.upload).toHaveBeenCalledOnce();
});

vi.mock('./noteActionApi', () => ({ noteActionApi: { list: vi.fn(async () => []), inbox: vi.fn(async () => []) } }));
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssistantView } from './AssistantView';
import { assistantApi } from './assistantApi';
import { conversationAttachmentApi } from './conversationAttachmentApi';
import { conversationApi, type Conversation, type ConversationTurn } from './conversationApi';
import { noteActionApi } from './noteActionApi';
import { aiFeatures } from '../settings/aiFeatures';

const fixture = vi.hoisted(() => ({
  navigate: vi.fn(),
  state: {
    serverData: {
      currentSpaceId: 'space-1' as string | null,
      notes: [{ id: 'note-1', title: '笔记 A', spaceId: 'space-1', deleted: false }],
      folderTree: []
    },
    getNoteVersion: vi.fn(async () => ({
      content: '前文 alpha 后文',
      contentHash: 'e1ad18f75b0295b8a3845a76fc8e148b8eef2107f58336fe9bca6a23ebb608d6'
    }))
  }
}));

vi.mock('../../app/router', async importOriginal => ({
  ...(await importOriginal<typeof import('../../app/router')>()),
  useNavigate: () => fixture.navigate
}));

vi.mock('../../store/AppStoreProvider', () => ({
  useAppStoreApi: () => ({ getState: () => fixture.state }),
  useAppStore: (selector: (value: typeof fixture.state) => unknown) => selector(fixture.state)
}));
vi.mock('../settings/aiFeatures', () => ({ aiFeatures: { get: vi.fn(), set: vi.fn() } }));
vi.mock('./assistantApi', () => ({
  assistantApi: { status: vi.fn(), listLegacy: vi.fn(), getLegacy: vi.fn(), allowRule: vi.fn() }
}));
vi.mock('./conversationAttachmentApi', () => ({
  conversationAttachmentApi: {
    list: vi.fn(),
    upload: vi.fn(),
    preview: vi.fn(),
    content: vi.fn(),
    remove: vi.fn()
  }
}));
vi.mock('./conversationApi', () => ({
  conversationApi: {
    list: vi.fn(),
    create: vi.fn(),
    messages: vi.fn(),
    send: vi.fn(),
    turn: vi.fn(),
    cancel: vi.fn(),
    retry: vi.fn(),
    resume: vi.fn(),
    policies: vi.fn(),
    createPolicy: vi.fn(),
    revokePolicy: vi.fn()
  }
}));

const conversation: Conversation = {
  conversationId: 'conversation-1',
  spaceId: 'space-1',
  createdAt: '2026-09-27T00:00:00.000Z',
  updatedAt: '2026-09-27T00:00:00.000Z',
  historicalDataset: false,
  readOnly: false
};
const succeeded: ConversationTurn = {
  turnId: 'turn-1',
  conversationId: 'conversation-1',
  requestedPolicyId: null,
  status: 'succeeded',
  phase: 'finished',
  errorCode: null,
  toolCalls: [],
  modelAttempts: []
};

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
  vi.mocked(assistantApi.status).mockResolvedValue({
    provider: 'deepseek',
    modelId: 'deepseek-flash',
    configured: true,
    executionLocation: 'server',
    generationAvailable: true,
    unavailableReason: null,
    budget: null,
    capabilities: {
      readScopes: ['note', 'folder'],
      actions: ['answer', 'cancel'],
      responseMode: 'polling',
      writeTools: false,
      providerAdvertised: null,
      providerVerified: false
    }
  });
});

it('聊天迟到发送回执保留同一编辑器的新草稿，内容改回相同时也不清空', async () => {
  let release!: (value: ConversationTurn) => void;
  vi.mocked(conversationApi.list).mockResolvedValue([conversation]);
  vi.mocked(conversationApi.send).mockImplementation(
    () =>
      new Promise(done => {
        release = done;
      })
  );
  render(<AssistantView pathname="/assistant?conversationId=conversation-1" onOpenNote={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('textbox', { name: '消息' })).toBeEnabled());
  fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '已发送问题' } });
  await waitFor(() => expect(screen.getByRole('button', { name: '发送消息' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  await waitFor(() => expect(conversationApi.send).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '下一条草稿' } });
  fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '已发送问题' } });
  await act(async () => {
    release(succeeded);
  });
  expect(screen.getByRole('textbox', { name: '消息' })).toHaveValue('已发送问题');
  expect(fixture.navigate).not.toHaveBeenCalled();
});

it('切换聊天实例后旧回执不清除新会话草稿，也不导航回旧会话', async () => {
  let release!: (value: ConversationTurn) => void;
  const other = { ...conversation, conversationId: 'conversation-2' };
  vi.mocked(conversationApi.list).mockResolvedValue([conversation, other]);
  vi.mocked(conversationApi.send).mockImplementation(
    () =>
      new Promise(done => {
        release = done;
      })
  );
  const view = render(<AssistantView pathname="/assistant?conversationId=conversation-1" onOpenNote={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '旧会话问题' } });
  await waitFor(() => expect(screen.getByRole('button', { name: '发送消息' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  await waitFor(() => expect(conversationApi.send).toHaveBeenCalledOnce());
  view.rerender(<AssistantView pathname="/assistant?conversationId=conversation-2" onOpenNote={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '新会话草稿' } });
  await act(async () => {
    release(succeeded);
  });
  expect(screen.getByRole('textbox', { name: '消息' })).toHaveValue('新会话草稿');
  expect(fixture.navigate).not.toHaveBeenCalled();
});

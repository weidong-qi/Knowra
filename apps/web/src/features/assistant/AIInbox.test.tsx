import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AIInbox } from './AIInbox';
import { noteActionApi, type NoteAction } from './noteActionApi';
const state = vi.hoisted(() => ({ canWriteWorkspace: () => true, loadWorkspace: vi.fn(async () => {}),
  editorHasLocalChanges: false, saveState: 'idle' }));
vi.mock('../../store/AppStoreProvider', () => ({ useAppStoreApi: () => ({ getState: () => state }) }));
vi.mock('./noteActionApi', () => ({ noteActionApi: { inbox: vi.fn(), get: vi.fn(), approve: vi.fn(),
  apply: vi.fn(), repreview: vi.fn(), revise: vi.fn(), reject: vi.fn() } }));
vi.mock('../editor/aiDraftCoordination', () => ({ registerAiDraft: vi.fn(), flushAiDraftCoordination: vi.fn(async () => {}), hasCoordinatedDraft: vi.fn(() => false) }));
const action = { actionId: 'action', requestId: 'original', status: 'awaitingApproval', reviewRequired: true,
  errorCode: null, expiresAt: '2030-01-01T00:00:00Z', receipt: null, plan: { planHash: 'hash', toolName: 'notes_create',
    items: [{ before: null, after: { id: 'new-note', spaceId: 'space', title: '周总结', rawMarkdown: '原稿', folderId: null, tagIds: [] } }] } } as unknown as NoteAction;
beforeEach(() => {
  vi.resetAllMocks(); globalThis.localStorage?.clear(); state.editorHasLocalChanges = false;
  vi.mocked(noteActionApi.inbox).mockResolvedValue([action]); vi.mocked(noteActionApi.get).mockResolvedValue(action);
  vi.mocked(noteActionApi.approve).mockResolvedValue({ ...action, status: 'authorized' });
  vi.mocked(noteActionApi.apply).mockResolvedValue({ ...action, status: 'applied' });
});
async function open() {
  render(<AIInbox spaceId="space" onOpenNote={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'AI 成果收件箱（1）' }));
  fireEvent.click(await screen.findByRole('button', { name: '审阅成果' }));
}
function showActions() { fireEvent.click(screen.getByText('更多成果操作')); }
it('重启后恢复待审成果，显示差异，只有明确采纳后写入', async () => {
  await open(); expect(screen.getByRole('heading', { name: '周总结' })).toBeInTheDocument();
  expect(screen.queryByText('新稿，尚未创建正式笔记')).not.toBeInTheDocument();
  expect(noteActionApi.approve).not.toHaveBeenCalled(); expect(noteActionApi.apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认采纳到笔记' }));
  await screen.findByRole('button', { name: '打开正式笔记' });
  expect(noteActionApi.approve).toHaveBeenCalledWith(action); expect(noteActionApi.apply).toHaveBeenCalledWith('action');
  expect(state.loadWorkspace).toHaveBeenCalledOnce();
});
it('采纳响应丢失后查询原动作，已采纳不重复提交', async () => {
  vi.mocked(noteActionApi.apply).mockRejectedValueOnce(new Error('响应丢失'));
  await open(); fireEvent.click(screen.getByRole('button', { name: '确认采纳到笔记' })); await screen.findByRole('alert');
  vi.mocked(noteActionApi.get).mockResolvedValue({ ...action, status: 'applied' });
  fireEvent.click(screen.getByRole('button', { name: '确认采纳到笔记' }));
  await screen.findByRole('button', { name: '打开正式笔记' }); expect(noteActionApi.apply).toHaveBeenCalledOnce();
});
it('存在未保存草稿时保留成果并禁止采纳', async () => {
  state.editorHasLocalChanges = true; await open(); fireEvent.click(screen.getByRole('button', { name: '确认采纳到笔记' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('未保存草稿'); expect(noteActionApi.approve).not.toHaveBeenCalled();
  expect(screen.getByText('原稿')).toBeInTheDocument();
});
it('新稿修订响应丢失后复用同一请求，完成前禁止采纳', async () => {
  vi.mocked(noteActionApi.revise).mockRejectedValueOnce(new Error('修订响应丢失')).mockResolvedValue({ ...action, plan: { ...action.plan, planHash: 'new-hash' } });
  await open(); showActions(); fireEvent.click(screen.getByRole('button', { name: '编辑新稿' }));
  fireEvent.change(screen.getByRole('textbox', { name: '成果正文' }), { target: { value: '修订稿' } });
  expect(screen.queryByRole('button', { name: '确认采纳到笔记' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '保存修订预览' })); await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '保存修订预览' })); await screen.findByRole('button', { name: '确认采纳到笔记' });
  expect(vi.mocked(noteActionApi.revise).mock.calls[1]).toEqual(vi.mocked(noteActionApi.revise).mock.calls[0]);
  expect(noteActionApi.approve).not.toHaveBeenCalled();
});
it('长期待审过期后先重新预览，再明确采纳', async () => {
  vi.mocked(noteActionApi.inbox).mockResolvedValue([{ ...action, status: 'expired', reauthorizationRequired: true }]);
  vi.mocked(noteActionApi.repreview).mockResolvedValue(action);
  await open(); showActions(); expect(screen.queryByRole('button', { name: '确认采纳到笔记' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重新预览' })); await screen.findByRole('button', { name: '确认采纳到笔记' });
  expect(noteActionApi.approve).not.toHaveBeenCalled();
});
it('查询采纳期间关闭后不发送迟到批准或提交', async () => {
  let release: (row: NoteAction) => void = () => {};
  vi.mocked(noteActionApi.get).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await open(); fireEvent.click(screen.getByRole('button', { name: '确认采纳到笔记' }));
  await waitFor(() => expect(noteActionApi.get).toHaveBeenCalled()); fireEvent.click(screen.getByRole('button', { name: '关闭成果' }));
  release(action); await new Promise(resolve => setTimeout(resolve, 0)); expect(noteActionApi.approve).not.toHaveBeenCalled();
  expect(noteActionApi.apply).not.toHaveBeenCalled();
});
it('切换空间后旧列表响应不混入新空间', async () => {
  let release: (rows: NoteAction[]) => void = () => {};
  vi.mocked(noteActionApi.inbox).mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValueOnce([]);
  const view = render(<AIInbox spaceId="space" onOpenNote={vi.fn()} />);
  view.rerender(<AIInbox spaceId="next" onOpenNote={vi.fn()} />); release([action]);
  await waitFor(() => expect(screen.getByRole('button', { name: 'AI 成果收件箱（0）' })).toBeInTheDocument());
});
it('同 action 远端修订同步正文和新 plan，旧列表迟到不能回滚', async () => {
  const revised = { ...action, plan: { ...action.plan, planHash: 'new-hash', items: [{ ...action.plan.items[0],
    after: { ...action.plan.items[0].after, rawMarkdown: '第二版' } }] } } as NoteAction;
  let release!: (rows: NoteAction[]) => void;
  const delayed = new Promise<NoteAction[]>(resolve => { release = resolve; });
  const selectedChange = vi.fn();
  vi.mocked(noteActionApi.inbox).mockResolvedValueOnce([action]).mockReturnValueOnce(delayed).mockResolvedValue([revised]);
  const view = render(<AIInbox spaceId="space" isOpen refreshKey="initial" onOpenNote={vi.fn()} onSelectedActionChange={selectedChange} />);
  fireEvent.click(await screen.findByRole('button', { name: '审阅成果' }));
  expect(screen.getByText('原稿')).toBeInTheDocument();
  view.rerender(<AIInbox spaceId="space" isOpen refreshKey="slow" onOpenNote={vi.fn()} onSelectedActionChange={selectedChange} />);
  view.rerender(<AIInbox spaceId="space" isOpen refreshKey="latest" onOpenNote={vi.fn()} onSelectedActionChange={selectedChange} />);
  await screen.findByText('第二版');
  release([action]); await act(async () => { await delayed; });
  expect(screen.getByText('第二版')).toBeInTheDocument();
  expect(selectedChange).toHaveBeenLastCalledWith(revised);
  vi.mocked(noteActionApi.get).mockResolvedValue(revised);
  fireEvent.click(screen.getByRole('button', { name: '确认采纳到笔记' }));
  await waitFor(() => expect(noteActionApi.approve).toHaveBeenCalledWith(revised));
});

it('编辑中远端 plan 变化保留本地输入，明确放弃后才显示最新版', async () => {
  const revised = { ...action, plan: { ...action.plan, planHash: 'new-hash', items: [{ ...action.plan.items[0],
    after: { ...action.plan.items[0].after, rawMarkdown: '远端新版' } }] } } as NoteAction;
  vi.mocked(noteActionApi.inbox).mockResolvedValueOnce([action]).mockResolvedValue([revised]);
  const view = render(<AIInbox spaceId="space" isOpen refreshKey="initial" onOpenNote={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: '审阅成果' }));
  showActions(); fireEvent.click(screen.getByRole('button', { name: '编辑新稿' }));
  fireEvent.change(screen.getByRole('textbox', { name: '成果正文' }), { target: { value: '本地未保存输入' } });
  view.rerender(<AIInbox spaceId="space" isOpen refreshKey="remote" onOpenNote={vi.fn()} />);
  await screen.findByRole('button', { name: '放弃本地编辑并查看最新成果' });
  expect(screen.getByRole('textbox', { name: '成果正文' })).toHaveValue('本地未保存输入');
  expect(screen.getByRole('button', { name: '保存修订预览' })).toBeDisabled();
  expect(screen.queryByText('远端新版')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '放弃本地编辑并查看最新成果' }));
  expect(screen.getByText('远端新版')).toBeInTheDocument();
  expect(noteActionApi.revise).not.toHaveBeenCalled();
});
it('恢复旧资料集草稿只读，查询后仍不开放写入', async () => {
  vi.mocked(noteActionApi.inbox).mockResolvedValue([{ ...action, datasetStale: true }]);
  await open(); showActions(); expect(screen.getByText(/旧草稿仅供查看/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '确认采纳到笔记' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '重新预览' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '编辑新稿' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '查询成果状态' }));
  await waitFor(() => expect(noteActionApi.get).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: '确认采纳到笔记' })).not.toBeInTheDocument();
});

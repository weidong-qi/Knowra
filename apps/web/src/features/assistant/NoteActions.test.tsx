import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NoteActions } from './NoteActions';
import { noteActionApi, type NoteAction } from './noteActionApi';
const state=vi.hoisted(()=>({serverData:{currentSpaceId:'space',notes:[],folderTree:[],tags:[]},canWriteWorkspace:()=>true,loadWorkspace:vi.fn(async()=>{}),editorHasLocalChanges:false,saveState:'idle'}));
vi.mock('../../store/AppStoreProvider',()=>({useAppStore:(select:(s:typeof state)=>unknown)=>select(state),useAppStoreApi:()=>({getState:()=>state})}));
vi.mock('./noteActionApi',()=>({noteActionApi:{list:vi.fn(async()=>[]),plan:vi.fn(),get:vi.fn(),approve:vi.fn(),apply:vi.fn(),cancel:vi.fn(),reject:vi.fn(),undo:vi.fn()}}));
vi.mock('../editor/aiDraftCoordination',()=>({registerAiDraft:vi.fn(),flushAiDraftCoordination:vi.fn(async()=>{}),hasCoordinatedDraft:vi.fn(()=>false)}));
const action={actionId:'action',requestId:'request',status:'awaitingApproval',errorCode:null,expiresAt:'2030-01-01T00:00:00Z',receipt:null,plan:{planHash:'hash',toolName:'notes_create',items:[{before:null,after:{id:'fixed',spaceId:'space',title:'记录',rawMarkdown:'正文',folderId:null,tagIds:[]}}]}} as unknown as NoteAction;
beforeEach(()=>{vi.clearAllMocks();state.editorHasLocalChanges=false;localStorage.clear();});
it('生成预览不调用批准或提交；只有明确确认后才保存',async()=>{
  vi.mocked(noteActionApi.plan).mockResolvedValue(action);vi.mocked(noteActionApi.get).mockResolvedValue(action);vi.mocked(noteActionApi.approve).mockResolvedValue({...action,status:'authorized'});vi.mocked(noteActionApi.apply).mockResolvedValue({...action,status:'applied',receipt:{result:{saveState:'localCommitted',changes:[{noteId:'fixed'}]}}});
  render(<NoteActions spaceId="space" onOpenNote={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'记录或整理笔记'}));fireEvent.change(screen.getByRole('textbox',{name:'标题'}),{target:{value:'记录'}});fireEvent.change(screen.getByRole('textbox',{name:/Markdown 内容/}),{target:{value:'正文'}});fireEvent.click(screen.getByRole('button',{name:'生成预览'}));await screen.findByRole('dialog',{name:'笔记变更预览'});expect(noteActionApi.approve).not.toHaveBeenCalled();expect(noteActionApi.apply).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'确认并保存'}));await screen.findByText('已保存',{selector:'p'});expect(noteActionApi.approve).toHaveBeenCalledWith(action);expect(noteActionApi.apply).toHaveBeenCalledWith('action');
});
it('预览响应丢失后复用原 requestId，冲突后保留建议',async()=>{
  vi.mocked(noteActionApi.plan).mockRejectedValueOnce(new Error('丢失响应')).mockResolvedValue(action);render(<NoteActions spaceId="space" onOpenNote={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'记录或整理笔记'}));fireEvent.change(screen.getByRole('textbox',{name:'标题'}),{target:{value:'记录'}});fireEvent.click(screen.getByRole('button',{name:'生成预览'}));await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'生成预览'}));await screen.findByRole('dialog',{name:'笔记变更预览'});expect(vi.mocked(noteActionApi.plan).mock.calls[1]).toEqual(vi.mocked(noteActionApi.plan).mock.calls[0]);state.editorHasLocalChanges=true;fireEvent.click(screen.getByRole('button',{name:'确认并保存'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('未保存草稿'));expect(noteActionApi.apply).not.toHaveBeenCalled();expect(screen.getByRole('heading',{name:'记录'})).toBeInTheDocument();
});

it('聊天刷新期间保留进行中的预览，完成后解除 busy',async()=>{
  let release:(row:NoteAction)=>void=()=>{};
  vi.mocked(noteActionApi.plan).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  const view=render(<NoteActions spaceId="space" refreshKey="m1" onOpenNote={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'记录或整理笔记'}));fireEvent.click(screen.getByRole('button',{name:'生成预览'}));
  await waitFor(()=>expect(noteActionApi.plan).toHaveBeenCalled());view.rerender(<NoteActions spaceId="space" refreshKey="m2" onOpenNote={vi.fn()}/>);
  release(action);await screen.findByRole('dialog',{name:'笔记变更预览'});expect(screen.getByRole('button',{name:'确认并保存'})).not.toBeDisabled();
});
it('修改表单或关闭后迟到预览不会覆盖新输入或重开弹窗',async()=>{
  let release:(row:NoteAction)=>void=()=>{};
  vi.mocked(noteActionApi.plan).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));render(<NoteActions spaceId="space" onOpenNote={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'记录或整理笔记'}));fireEvent.click(screen.getByRole('button',{name:'生成预览'}));await waitFor(()=>expect(noteActionApi.plan).toHaveBeenCalled());
  fireEvent.change(screen.getByRole('textbox',{name:'标题'}),{target:{value:'更新标题'}});release(action);await waitFor(()=>expect(screen.getByRole('textbox',{name:'标题'})).toHaveValue('更新标题'));
  expect(screen.getByRole('button',{name:'生成预览'})).not.toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'关闭'}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('确认查询期间关闭弹窗后，不发送迟到批准或写入',async()=>{
  let release:(row:NoteAction)=>void=()=>{};
  vi.mocked(noteActionApi.plan).mockResolvedValue(action);vi.mocked(noteActionApi.get).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  render(<NoteActions spaceId="space" onOpenNote={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'记录或整理笔记'}));fireEvent.click(screen.getByRole('button',{name:'生成预览'}));await screen.findByRole('dialog',{name:'笔记变更预览'});
  fireEvent.click(screen.getByRole('button',{name:'确认并保存'}));await waitFor(()=>expect(noteActionApi.get).toHaveBeenCalled());fireEvent.click(screen.getByRole('button',{name:'关闭'}));release(action);
  await new Promise(resolve=>setTimeout(resolve,0));expect(noteActionApi.approve).not.toHaveBeenCalled();expect(noteActionApi.apply).not.toHaveBeenCalled();expect(state.loadWorkspace).not.toHaveBeenCalled();
});

it('切换空间清空旧记录，迟到手动刷新不能显示旧空间计划',async()=>{
  let release:(rows:NoteAction[])=>void=()=>{};
  vi.mocked(noteActionApi.list).mockResolvedValueOnce([action]).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;})).mockResolvedValueOnce([]);
  const view=render(<NoteActions spaceId="space" onOpenNote={vi.fn()}/>);await screen.findByText('执行记录（1）');
  fireEvent.click(screen.getByRole('button',{name:'刷新执行记录'}));view.rerender(<NoteActions spaceId="next-space" onOpenNote={vi.fn()}/>);
  release([action]);await waitFor(()=>expect(screen.getByText('执行记录（0）')).toBeInTheDocument());expect(screen.queryByRole('button',{name:'查看计划与结果'})).not.toBeInTheDocument();
});

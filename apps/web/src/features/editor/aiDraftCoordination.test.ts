import { createAiDraftCoordination } from './aiDraftCoordination';
it('清除草稿锁失败后 flush 重试，重复注册相同状态也不会丢失重试', async () => {
  localStorage.clear();
  const send = vi.fn().mockRejectedValueOnce(new Error('断线')).mockResolvedValue({});
  const coordinator = createAiDraftCoordination({ clientId: 'tab', storage: localStorage, send });
  coordinator.register('space', 'a', false);
  await coordinator.flush();
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1][0]).toEqual({ clientId: expect.any(String), noteId: 'a', dirty: false });
  expect(send.mock.calls[1][0].clientId).toBe(send.mock.calls[0][0].clientId);
});
it('笔记 B 上报成功不能掩盖笔记 A 失败，修复网络后重新确认 A', async () => {
  localStorage.clear(); let failed = true;
  const send = vi.fn(async ({ noteId }: { noteId: string }) => { if (noteId === 'a' && failed) throw new Error('断线'); });
  const coordinator = createAiDraftCoordination({ clientId: 'tab', storage: localStorage, send });
  coordinator.register('space', 'a', false); coordinator.register('space', 'b', false);
  await expect(coordinator.flush()).rejects.toThrow('尚未确认');
  failed = false; await coordinator.flush();
  expect(send.mock.calls.filter(([input]) => input.noteId === 'a')).toHaveLength(3);
});
it('上报中的旧 dirty 状态完成后，仍确认最新清除状态', async () => {
  localStorage.clear(); let release: (() => void) | undefined;
  const send = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; })).mockResolvedValue({});
  const coordinator = createAiDraftCoordination({ clientId: 'tab', storage: localStorage, send });
  coordinator.register('space', 'a', true); await Promise.resolve();
  coordinator.register('space', 'a', false); release?.(); await coordinator.flush();
  expect(send.mock.calls.at(-1)?.[0].dirty).toBe(false);
  expect(coordinator.hasDraft('space', ['a'])).toBe(false);
});

it('浏览器禁止 Storage getter 时注册不抛出，flush 阻止 AI 写入', async () => {
  const original=Object.getOwnPropertyDescriptor(window,'localStorage');
  Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new DOMException('禁止存储','SecurityError');}});
  try { const {registerAiDraft,flushAiDraftCoordination,closeAiDraftCoordination}=await import('./aiDraftCoordination');expect(()=>registerAiDraft('space','locked',true)).not.toThrow();await expect(flushAiDraftCoordination()).rejects.toThrow('协调存储不可用');closeAiDraftCoordination(); }
  finally { if(original)Object.defineProperty(window,'localStorage',original); }
});

it('死亡窗口租约到期释放标记，新窗口保存不清除另一个活跃窗口',async()=>{
  localStorage.clear();let time=1000,beat:()=>void=()=>{};
  const old=createAiDraftCoordination({clientId:'old',storage:localStorage,send:vi.fn(async()=>{}),now:()=>time,schedule:callback=>{beat=callback;return()=>{beat=()=>{};};}});
  const next=createAiDraftCoordination({clientId:'next',storage:localStorage,send:vi.fn(async()=>{}),now:()=>time,schedule:()=>()=>{}});
  old.register('space','note',true);await old.flush();next.register('space','note',false);await next.flush();expect(next.hasDraft('space',['note'])).toBe(true);
  time+=90000;beat();await old.flush();time+=90000;expect(next.hasDraft('space',['note'])).toBe(true);
  old.close();time+=120001;expect(next.hasDraft('space',['note'])).toBe(false);next.close();
});
it('无期限旧标记只迁移一次，不会因重复读取永久延期',()=>{
  localStorage.setItem('knowra:ai-draft-locks:v1',JSON.stringify([{clientId:'old',scope:'space',noteId:'note'}]));let time=1000;
  const coordinator=createAiDraftCoordination({clientId:'new',storage:localStorage,send:vi.fn(async()=>{}),now:()=>time,schedule:()=>()=>{}});
  expect(coordinator.hasDraft('space',['note'])).toBe(true);const migrated=localStorage.getItem('knowra:ai-draft-locks:v1');time+=60000;expect(coordinator.hasDraft('space',['note'])).toBe(true);expect(localStorage.getItem('knowra:ai-draft-locks:v1')).toBe(migrated);
  time+=60001;expect(coordinator.hasDraft('space',['note'])).toBe(false);
});
it('租约过期不删除恢复正文，活跃草稿 flush 重新续租且失败阻止写入',async()=>{
  localStorage.clear();const {createNoteDraftRecovery}=await import('./noteDraftRecovery');let time=1000;
  const send=vi.fn().mockResolvedValue({});const coordinator=createAiDraftCoordination({clientId:'tab',storage:localStorage,send,now:()=>time,schedule:()=>()=>{}});
  const recovery=createNoteDraftRecovery((scope,id,dirty)=>coordinator.register(scope,id,dirty));const draft={markdown:'保留未保存正文',baseMarkdown:'原文'};recovery.write('space','note',draft);await coordinator.flush();coordinator.close();time+=120001;
  expect(coordinator.hasDraft('space',['note'])).toBe(false);expect(recovery.read('space','note')).toEqual(draft);
  send.mockRejectedValue(new Error('离线'));await expect(coordinator.flush()).rejects.toThrow('尚未确认');expect(coordinator.hasDraft('space',['note'])).toBe(true);coordinator.close();
});
it('切换数据集后的旧 scope 清除重试不能清除当前草稿，重载复用当前标记',async()=>{
  localStorage.clear();let failed=true;const active=new Set<string>();
  const send=vi.fn(async(input:{clientId:string;noteId:string;dirty:boolean})=>{
    if(!input.dirty&&failed)throw new Error('旧数据集离线');
    if(input.dirty)active.add(input.clientId);else active.delete(input.clientId);
  });
  const coordinator=createAiDraftCoordination({clientId:'tab',storage:localStorage,send,schedule:()=>()=>{}});
  coordinator.register('old-dataset','note',false);await expect(coordinator.flush()).rejects.toThrow('尚未确认');
  coordinator.register('new-dataset','note',true);failed=false;await coordinator.flush();
  const currentId=send.mock.calls.find(([input])=>input.dirty)?.[0].clientId;
  expect(active).toEqual(new Set([currentId]));expect(send.mock.calls[0][0].clientId).not.toBe(currentId);coordinator.close();
  const reloaded=createAiDraftCoordination({clientId:'tab',storage:localStorage,send,schedule:()=>()=>{}});
  reloaded.register('new-dataset','note',false);await reloaded.flush();expect(send.mock.calls.at(-1)?.[0].clientId).toBe(currentId);expect(active.size).toBe(0);reloaded.close();
});
it('切换资料集后旧 dirty 心跳与失败停止投递，旧共享 clientId 分离',async()=>{
  localStorage.clear();let current='old',beat=()=>{};let time=1000;
  localStorage.setItem('knowra:ai-draft-locks:v1',JSON.stringify(['old','new'].map(scope=>({clientId:'tab',scope,noteId:'note'}))));
  const send=vi.fn(async(_input:{clientId:string;noteId:string;dirty:boolean})=>{if(current==='old')throw new Error('旧数据集离线');});
  const coordinator=createAiDraftCoordination({clientId:'tab',storage:localStorage,send,now:()=>time,isCurrentScope:scope=>scope===current,schedule:callback=>{beat=callback;return()=>{};}});
  coordinator.register('old','note',true);await expect(coordinator.flush()).rejects.toThrow('尚未确认');const oldId=send.mock.calls[0][0].clientId;
  current='new';coordinator.register('new','note',true);await coordinator.flush();const callCount=send.mock.calls.length;time+=30000;beat();await coordinator.flush();
  expect(send.mock.calls.slice(callCount).every(([input])=>input.clientId!==oldId&&input.dirty)).toBe(true);
  expect(send.mock.calls.at(-1)?.[0].clientId).not.toBe(oldId);expect(send.mock.calls.at(-1)?.[0].clientId).not.toBe('tab');
  coordinator.register('old','note',false);await coordinator.flush();expect(send.mock.calls.at(-1)?.[0].dirty).toBe(true);coordinator.close();
});

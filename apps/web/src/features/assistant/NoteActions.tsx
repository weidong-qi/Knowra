import { flushAiDraftCoordination, hasCoordinatedDraft } from '../editor/aiDraftCoordination';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button/Button';
import { Checkbox, Select, TextAreaField, TextField } from '../../components/ui/input';
import { Dialog, DialogBody, DialogFooter } from '../../components/ui/overlay/Dialog';
import { useAppStore, useAppStoreApi } from '../../store/AppStoreProvider';
import { getNoteDraftScope } from '../editor/noteDraftScope';
import { noteDraftRecovery } from '../editor/noteDraftRecovery';
import { noteActionApi, type NoteAction } from './noteActionApi';
import type { ConversationMessage } from './conversationApi';
import styles from './NoteActions.module.css';
const labels: Record<string, string> = { awaitingApproval: '待确认', authorized: '已确认，尚未提交', applying: '提交结果待对账',
  applied: '已保存', cancelled: '已取消', rejected: '已拒绝', conflicted: '存在冲突', failed: '失败', expired: '已过期' };
interface Props { refreshKey?: string; spaceId: string; conversationId?: string; message?: ConversationMessage; onOpenNote(id: string): void; onCloseSource?(): void }
export function NoteActions({ refreshKey, spaceId, conversationId, message, onOpenNote, onCloseSource }: Props) {
  const serverData = useAppStore(state => state.serverData);
  const store = useAppStoreApi();
  const notes = serverData.notes.filter(note => !note.deleted && note.spaceId === spaceId);
  const [history, setHistory] = useState<NoteAction[]>([]);
  const [open, setOpen] = useState(Boolean(message));
  const [mode, setMode] = useState('notes_create');
  const [noteId, setNoteId] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [text, setText] = useState(message?.content ?? '');
  const [quote, setQuote] = useState('');
  const [offset, setOffset] = useState('0');
  const [folderId, setFolderId] = useState('unchanged');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [changeTags, setChangeTags] = useState(false);
  const [action, setAction] = useState<NoteAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingInput = useRef<Record<string, unknown> | null>(null);
  const undoKeys = useRef(new Map<string, string>());
  const generation = useRef(0);
  const mounted = useRef(true);
  const currentSpace = useRef(spaceId);
  currentSpace.current = spaceId;
  useEffect(() => {
    mounted.current = true;
    generation.current++;
    setBusy(false); setAction(null); setHistory([]); pendingInput.current = null;
    return () => { mounted.current = false; generation.current++; };
  }, [spaceId]);
  useEffect(() => {
    let active = true;
    void noteActionApi.list(spaceId).then(rows => { if (active) setHistory(rows); }).catch(() => {});
    return () => { active = false; };
  }, [spaceId, refreshKey]);
  useEffect(() => {
    if (message) { generation.current++; setBusy(false); pendingInput.current = null; setAction(null); setText(message.content); setOpen(true); }
  }, [message?.messageId]);
  const update = (row: NoteAction) => {
    setAction(row); setHistory(rows => [...rows.filter(item => item.actionId !== row.actionId), row]);
  };
  async function perform(work: (current: number) => Promise<NoteAction>) {
    if (busy) return;
    const current = generation.current; setBusy(true); setError(null);
    try { const row = await work(current); if (mounted.current && current === generation.current) update(row); }
    catch (cause) { if (mounted.current && current === generation.current) setError(cause instanceof Error ? cause.message : '操作失败，请查询原动作后重试。'); }
    finally { if (mounted.current && current === generation.current) setBusy(false); }
  }
  function hasDraft(id: string) {
    const draft = noteDraftRecovery.read(getNoteDraftScope(spaceId) ?? spaceId, id);
    return draft && (draft.markdown !== draft.baseMarkdown || Boolean(draft.conflict));
  }
  function ensureWritable(ids: string[]) {
    const state = store.getState();
    if (!state.canWriteWorkspace()) throw new Error('工作区当前只读，请先恢复加载。');
    if (hasCoordinatedDraft(getNoteDraftScope(spaceId) ?? spaceId, ids) || ids.some(hasDraft) || state.editorHasLocalChanges || state.saveState === 'saving') {
      throw new Error('存在未保存草稿，请先在编辑器保存或比较草稿，再重新预览。');
    }
  }
  function changed() { generation.current++; setBusy(false); pendingInput.current = null; setAction(null); setError(null); }
  async function plan() {
    await perform(async current => {
      const targets = mode === 'notes_create' ? [] : mode === 'notes_propose_organize' ? selectedIds : [noteId];
      await flushAiDraftCoordination();
      if (current !== generation.current) throw new Error('表单已变化，请重新生成预览。');
      ensureWritable(targets);
      if (!pendingInput.current) {
        let args: Record<string, unknown>;
        if (mode === 'notes_create') args = { title, rawMarkdown: text, folderId: folderId === 'unchanged' || folderId === 'root' ? null : folderId, tagIds };
        else if (mode === 'notes_append') args = { noteId, rawMarkdown: text };
        else if (mode === 'notes_propose_patch') {
          const note = await noteActionApi.note(noteId), start = Number(offset);
          if (current !== generation.current) throw new Error('表单已变化，请重新生成预览。');
          if (!quote || !Number.isSafeInteger(start) || start < 0 || note.rawMarkdown.slice(start, start + quote.length) !== quote) throw new Error('原文与起始位置不匹配。请核对目标当前正文。');
          args = { noteId, replacements: [{ start, end: start + quote.length, quote, replacement: text }] };
        } else args = { changes: selectedIds.map(id => ({ noteId: id, ...(title ? { title } : {}),
          ...(folderId === 'unchanged' ? {} : { folderId: folderId === 'root' ? null : folderId }), ...(changeTags ? { tagIds } : {}) })) };
        pendingInput.current = { spaceId, requestId: crypto.randomUUID(), toolName: mode, arguments: args,
          ...(message && conversationId ? { sourceMessageId: message.messageId, conversationId } : {}) };
      }
      return noteActionApi.plan(pendingInput.current);
    });
  }
  async function confirm() {
    if (!action) return;
    await perform(async captured => {
      const assertCurrent = () => { if (!mounted.current || generation.current !== captured) throw new Error('页面已变化，请重新查看计划。'); };
      await flushAiDraftCoordination(); assertCurrent(); ensureWritable(action.plan.items.map(item => item.after.id));
      const current = await noteActionApi.get(action.actionId); assertCurrent();
      if (current.status === 'applied') return current;
      if (current.plan.planHash !== action.plan.planHash) throw new Error('计划已变化，请重新预览。');
      if (current.status === 'awaitingApproval') { await noteActionApi.approve(current); assertCurrent(); }
      ensureWritable(action.plan.items.map(item => item.after.id));
      const result = await noteActionApi.apply(current.actionId);
      if (mounted.current && generation.current === captured && result.status === 'applied') await store.getState().loadWorkspace();
      return result;
    });
  }
  function close() { generation.current++; setBusy(false); setOpen(false); onCloseSource?.(); }
  return <section className={styles.panel} aria-label="笔记写入与执行记录">
    <div className={styles.toolbar}><Button variant="default" size="compact" onPress={() => { changed(); setOpen(true); }}>记录或整理笔记</Button>
      <Button variant="ghost" size="compact" onPress={() => { const requestedSpace = spaceId; void noteActionApi.list(requestedSpace).then(rows => { if (mounted.current && currentSpace.current === requestedSpace) setHistory(rows); }).catch(cause => { if (mounted.current && currentSpace.current === requestedSpace) setError(String(cause)); }); }}>刷新执行记录</Button></div>
    <details><summary>执行记录（{history.length}）</summary>{history.map(row => <div key={row.actionId} className={styles.record}>
      <span>{row.plan.items.map(item => item.after.title).join('、')} · {labels[row.status] ?? row.status}</span>
      <Button variant="ghost" size="compact" onPress={() => { generation.current++; setBusy(false); update(row); setOpen(true); }}>查看计划与结果</Button>
    </div>)}</details>
    <Dialog isOpen={open} onOpenChange={next => { if (!next) close(); }} title={action ? '笔记变更预览' : '记录与整理笔记'} size="md">
      <DialogBody><div className={styles.form}>
        {error ? <p role="alert">{error}</p> : null}
        {!action ? <>
          <Select label="操作" selectedKey={mode} onSelectionChange={key => { changed(); setMode(String(key)); }} options={[
            { id: 'notes_create', label: '新建笔记' }, { id: 'notes_append', label: '追加到笔记' }, { id: 'notes_propose_patch', label: '精确局部替换' }, { id: 'notes_propose_organize', label: '改名、移动或标签整理' }]} />
          {mode !== 'notes_create' && mode !== 'notes_propose_organize' ? <Select label="目标笔记" selectedKey={noteId || null} onSelectionChange={key => { changed(); setNoteId(String(key)); }} options={notes.map(note => ({ id: note.id, label: note.title }))} /> : null}
          {mode === 'notes_propose_organize' ? <fieldset><legend>目标笔记（最多 20 篇）</legend>{notes.map(note => <Checkbox key={note.id} isSelected={selectedIds.includes(note.id)} onChange={selected => { changed(); setSelectedIds(ids => selected ? [...ids, note.id] : ids.filter(id => id !== note.id)); }}>{note.title}</Checkbox>)}</fieldset> : null}
          {mode === 'notes_create' || mode === 'notes_propose_organize' ? <TextField label={mode === 'notes_create' ? '标题' : '新标题（留空保持原名）'} value={title} onChange={value => { changed(); setTitle(value); }} /> : null}
          {mode === 'notes_create' || mode === 'notes_propose_organize' ? <>
            <Select label="目录" selectedKey={folderId} onSelectionChange={key => { changed(); setFolderId(String(key)); }} options={[{ id: 'unchanged', label: mode === 'notes_create' ? '空间根目录' : '保持原目录' }, { id: 'root', label: '空间根目录' }, ...serverData.folderTree.filter(folder => !folder.deletedAt && folder.spaceId === spaceId).map(folder => ({ id: folder.id, label: folder.name }))]} />
            {mode === 'notes_propose_organize' ? <Checkbox isSelected={changeTags} onChange={value => { changed(); setChangeTags(value); }}>替换目标标签集合</Checkbox> : null}
            {mode === 'notes_create' || changeTags ? <fieldset><legend>标签</legend>{(serverData.tags ?? []).filter(tag => tag.spaceId === spaceId).map(tag => <Checkbox key={tag.id} isSelected={tagIds.includes(tag.id)} onChange={selected => { changed(); setTagIds(ids => selected ? [...ids, tag.id] : ids.filter(id => id !== tag.id)); }}>{tag.name}</Checkbox>)}</fieldset> : null}
          </> : null}
          {mode === 'notes_propose_patch' ? <><TextAreaField label="确切原文" value={quote} onChange={value => { changed(); setQuote(value); }} /><TextField label="起始位置（从 0 开始，UTF-16）" value={offset} onChange={value => { changed(); setOffset(value); }} /></> : null}
          {mode !== 'notes_propose_organize' ? <TextAreaField label={mode === 'notes_propose_patch' ? '替换内容' : 'Markdown 内容（追加保留所填换行）'} value={text} onChange={value => { changed(); setText(value); }} /> : null}
          <p>此入口明确提出笔记写入指令。生成预览不会修改笔记；确认后才提交。</p>
        </> : <>
          <p role="status">{labels[action.status] ?? action.status}{action.errorCode ? ` · ${action.errorCode}` : ''}</p>
          {action.plan.items.map(item => <section key={item.after.id} className={styles.diff}>
            <h3>{item.after.title}{item.softDelete ? ' · 移入回收站' : ''}</h3>
            <p>{item.before ? `${item.before.title} → ${item.after.title}` : '创建新笔记'} · 目录：{item.before?.folderId ?? '根目录'} → {item.after.folderId ?? '根目录'} · 标签：{item.before?.tagIds.join('、') || '无'} → {item.after.tagIds.join('、') || '无'}</p>
            <div className={styles.columns}><div><strong>变更前</strong><pre>{item.before?.rawMarkdown ?? '不存在'}</pre></div><div><strong>变更后</strong><pre>{item.after.rawMarkdown}</pre></div></div>
            {action.status === 'applied' ? <Button variant="default" size="compact" onPress={() => onOpenNote(item.after.id)}>打开笔记</Button> : null}
          </section>)}
          <p>影响 {action.plan.items.length} 篇笔记；正文变更由现有版本与标注服务维护。草稿或版本变化会阻止提交。</p>
          {action.status === 'applied' ? <p>已在当前执行端保存。云端同步状态请查看同步面板。{action.reconciliationPending ? '执行记录待对账，核心回执已确认。' : ''}</p> : <p>确认有效期至 {new Date(action.expiresAt).toLocaleString('zh-CN')}。</p>}
        </>}
      </div></DialogBody>
      <DialogFooter><Button variant="ghost" onPress={close}>关闭</Button>
        {!action ? <Button variant="primary" isDisabled={busy} onPress={() => void plan()}>生成预览</Button> : <>
          <Button variant="ghost" isDisabled={busy} onPress={() => void perform(() => noteActionApi.get(action.actionId))}>查询执行结果</Button>
          {['awaitingApproval','authorized','applying'].includes(action.status) ? <><Button variant="ghost" isDisabled={busy} onPress={() => void perform(() => noteActionApi.reject(action.actionId))}>拒绝计划</Button><Button variant="default" isDisabled={busy} onPress={() => void perform(() => noteActionApi.cancel(action.actionId))}>取消写入</Button><Button variant="primary" isDisabled={busy} onPress={() => void confirm()}>{action.status === 'applying' ? '对账并重试原动作' : '确认并保存'}</Button></> : null}
          {action.status === 'applied' && action.plan.toolName !== 'notes_undo' ? <Button variant="default" isDisabled={busy} onPress={() => void perform(() => {
            const key = undoKeys.current.get(action.actionId) ?? crypto.randomUUID(); undoKeys.current.set(action.actionId, key); return noteActionApi.undo(action.actionId, key);
          })}>预览撤销</Button> : null}
        </>}
      </DialogFooter>
    </Dialog>
  </section>;
}

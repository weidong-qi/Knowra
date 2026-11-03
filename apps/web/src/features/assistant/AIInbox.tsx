import { useEffect, useRef, useState } from 'react';
import { Badge, Button, TextAreaField, TextField } from '../../components/ui';
import { useAppStoreApi } from '../../store/AppStoreProvider';
import { flushAiDraftCoordination, hasCoordinatedDraft } from '../editor/aiDraftCoordination';
import { getNoteDraftScope } from '../editor/noteDraftScope';
import { noteDraftRecovery } from '../editor/noteDraftRecovery';
import { noteActionApi, type NoteAction } from './noteActionApi';
import { ReadableMarkdown } from './ReadableMarkdown';
import styles from './NoteActions.module.css';
import inboxStyles from './AIInbox.module.css';

const labels: Record<string, string> = { awaitingApproval: '待审阅', authorized: '已确认，尚未采纳', applying: '待对账',
  applied: '已采纳', rejected: '已拒绝', cancelled: '已取消', conflicted: '版本冲突', expired: '需重新预览', failed: '提交失败' };
const statusTone = (status: string) => ['awaitingApproval', 'authorized', 'applying'].includes(status) ? 'warning' as const
  : status === 'applied' ? 'success' as const : ['conflicted', 'failed', 'expired'].includes(status) ? 'danger' as const : 'neutral' as const;
const activeStatuses = ['awaitingApproval', 'authorized', 'applying'];
export function AIInbox({ spaceId, refreshKey, onOpenNote, isOpen, onOpenChange, onRowsChange, focusActionId, selectedMismatch, onSelectedActionChange }: {
  spaceId: string; refreshKey?: string; onOpenNote(id: string): void;
  isOpen?: boolean; onOpenChange?(open: boolean): void; onRowsChange?(rows: NoteAction[]): void; focusActionId?: string | null;
  selectedMismatch?: boolean; onSelectedActionChange?(action: NoteAction | null): void;
}) {
  const store = useAppStoreApi();
  const [localOpen, setLocalOpen] = useState(false);
  const open = isOpen ?? localOpen;
  const setOpen = (next: boolean) => { setLocalOpen(next); onOpenChange?.(next); };
  const [rows, setRows] = useState<NoteAction[]>([]);
  const [selected, setSelected] = useState<NoteAction | null>(null);
  const [queuedRemote, setQueuedRemote] = useState<NoteAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [markdown, setMarkdown] = useState('');
  const generation = useRef(0);
  const listSequence = useRef(0);
  const selectedRef = useRef<NoteAction | null>(null);
  const busyRef = useRef(false);
  const editingRef = useRef(false);
  const refreshAfterBusy = useRef(false);
  const [refreshSerial, setRefreshSerial] = useState(0);
  const requestKey = useRef<string | null>(null);
  const handledFocusAction = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moreActions = useRef<HTMLDetailsElement>(null);
  const mounted = useRef(true);
  useEffect(() => { if (open) heading.current?.focus({ preventScroll: true }); }, [open]);
  useEffect(() => {
    if (open) return;
    generation.current++; listSequence.current++; selectedRef.current = null; busyRef.current = false; editingRef.current = false; refreshAfterBusy.current = false;
    setSelected(null); setQueuedRemote(null); setBusy(false); setEditing(false); onSelectedActionChange?.(null);
  }, [open]);
  useEffect(() => {
    mounted.current = true; generation.current++;
    setOpen(false); setRows([]); selectedRef.current = null; setSelected(null); setQueuedRemote(null);
    onSelectedActionChange?.(null); setBusy(false); setError(null); setEditing(false);
    return () => { mounted.current = false; generation.current++; };
  }, [spaceId]);
  useEffect(() => {
    let current = true; const sequence = ++listSequence.current; setLoading(true);
    void noteActionApi.inbox(spaceId).then(items => { if (current && sequence === listSequence.current) {
      setRows(items); onRowsChange?.(items); setError(null);
      const previous = selectedRef.current;
      if (previous && open) {
        const fresh = items.find(item => item.actionId === previous.actionId);
        if (!fresh) { selectedRef.current = null; setSelected(null); setQueuedRemote(null); onSelectedActionChange?.(null); }
        else if (busyRef.current) refreshAfterBusy.current = true;
        else if (editingRef.current && fresh.plan.planHash !== previous.plan.planHash) setQueuedRemote(fresh);
        else { selectedRef.current = fresh; setSelected(fresh); setQueuedRemote(null); onSelectedActionChange?.(fresh); }
      }
    } })
      .catch(cause => { if (current && sequence === listSequence.current) setError(cause instanceof Error ? cause.message : '成果加载失败。'); })
      .finally(() => { if (current && sequence === listSequence.current) setLoading(false); });
    return () => { current = false; };
  }, [spaceId, refreshKey, refreshSerial, open]);
  useEffect(() => { if (!busy && refreshAfterBusy.current) { refreshAfterBusy.current = false; setRefreshSerial(value => value + 1); } }, [busy]);
  useEffect(() => {
    if (!open || !focusActionId) { handledFocusAction.current = null; return; }
    if (handledFocusAction.current === focusActionId) return;
    const action = rows.find(row => row.actionId === focusActionId);
    if (action) { handledFocusAction.current = focusActionId; choose(action); }
  }, [open, focusActionId, rows]);
  function close() { generation.current++; listSequence.current++; selectedRef.current = null; busyRef.current = false; editingRef.current = false; refreshAfterBusy.current = false;
    setSelected(null); setQueuedRemote(null); setOpen(false); onSelectedActionChange?.(null); setBusy(false); setEditing(false); }
  function choose(action: NoteAction) {
    generation.current++; requestKey.current = null; selectedRef.current = action; busyRef.current = false; editingRef.current = false;
    setBusy(false); setError(null); setEditing(false); setQueuedRemote(null); setSelected(action); onSelectedActionChange?.(action);
  }
  function update(action: NoteAction) {
    selectedRef.current = action;
    setSelected(previous => previous?.actionId === action.actionId ? { ...previous, ...action } : action);
    onSelectedActionChange?.(action);
    setRows(previous => previous.map(row => row.actionId === action.actionId ? { ...row, ...action } : row));
  }
  async function perform(work: (assertCurrent: () => void) => Promise<NoteAction>) {
    if (busy) return;
    const captured = generation.current; listSequence.current++; refreshAfterBusy.current = true;
    busyRef.current = true; setBusy(true); setError(null);
    const assertCurrent = () => { if (!mounted.current || generation.current !== captured) throw new Error('页面已变化，请重新查看成果。'); };
    try { const action = await work(assertCurrent); assertCurrent(); update(action); }
    catch (cause) { if (mounted.current && generation.current === captured) setError(cause instanceof Error ? cause.message : '操作失败，请查询原成果后重试。'); }
    finally { if (mounted.current && generation.current === captured) { busyRef.current = false; setBusy(false); } }
  }
  function ensureWritable(action: NoteAction) {
    if (action.datasetStale) throw new Error('资料集已恢复，旧草稿仅供查看；请在当前资料集重新生成。');
    const state = store.getState();
    if (!state.canWriteWorkspace()) throw new Error('工作区当前只读，请先恢复加载。');
    const ids = action.plan.items.map(item => item.after.id), scope = getNoteDraftScope(spaceId) ?? spaceId;
    const dirty = ids.some(id => { const draft = noteDraftRecovery.read(scope, id); return draft && (draft.markdown !== draft.baseMarkdown || Boolean(draft.conflict)); });
    if (hasCoordinatedDraft(scope, ids) || dirty || state.editorHasLocalChanges || state.saveState === 'saving') {
      throw new Error('存在未保存草稿，请先保存或比较草稿，再重新预览。');
    }
  }
  async function adopt() {
    if (!selected) return;
    await perform(async assertCurrent => {
      await flushAiDraftCoordination(); assertCurrent(); ensureWritable(selected);
      let action = await noteActionApi.get(selected.actionId); assertCurrent();
      if (action.status === 'applied') { await store.getState().loadWorkspace(); return action; }
      if (action.plan.planHash !== selected.plan.planHash) throw new Error('成果已变化，请查询并重新审阅。');
      if (!activeStatuses.includes(action.status)) throw new Error('成果需要重新预览或授权，请审阅最新内容后采纳。');
      if (action.status === 'awaitingApproval') { action = await noteActionApi.approve(action); assertCurrent(); }
      ensureWritable(action);
      const result = await noteActionApi.apply(action.actionId); assertCurrent();
      if (result.status === 'applied') await store.getState().loadWorkspace();
      return result;
    });
  }
  const pendingCount = rows.filter(row => !['applied', 'rejected', 'cancelled'].includes(row.status)).length;
  const canAdopt = selected && !selected.datasetStale && activeStatuses.includes(selected.status);
  return <>
    {isOpen === undefined ? <Button variant="default" size="compact" onPress={() => setOpen(true)}>AI 成果收件箱（{pendingCount}）</Button> : null}
    {open ? <aside className={inboxStyles.panel} aria-label="AI 成果收件箱">
      <div className={inboxStyles.header}><h2 ref={heading} tabIndex={-1}>AI 成果收件箱（{pendingCount}）</h2><Button variant="ghost" size="compact" onPress={close}>关闭成果</Button></div>
      <div className={inboxStyles.body} data-ai-inbox-scroll="true"><div className={styles.form}>
        {!selected ? <p>在这里审阅成果，采纳后才保存到正式笔记。普通聊天不会自动进入收件箱。</p> : null}
        {loading ? <p role="status">正在恢复成果…</p> : rows.length === 0 ? <p>暂无成果。</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {selected ? <Button variant="ghost" size="compact" onPress={() => { selectedRef.current = null; setSelected(null); setQueuedRemote(null); onSelectedActionChange?.(null); }}>返回成果列表</Button> : rows.map(row => <div className={inboxStyles.row} key={row.actionId}>
          <span className={inboxStyles.rowTitle}>{row.plan.items.map(item => item.after.title).join('、')}</span>
          <Badge tone={statusTone(row.status)}>{labels[row.status] ?? row.status}</Badge>
          <Button variant="default" size="compact" onPress={() => choose(row)}>审阅成果</Button>
        </div>)}
        {selected ? <section aria-label="成果预览" className={styles.form}>
          {selectedMismatch ? <p className={inboxStyles.contextNotice} role="status">当前审阅成果不能作为此轮聊天的修改目标；右侧选稿不会改变实际目标。关闭审阅后可继续普通对话。</p> : null}
          {queuedRemote ? <p role="alert">成果已在别处更新。当前编辑内容仍在此处；请放弃本地编辑并查看最新成果，再继续操作。</p> : null}
          <p className={inboxStyles.status} role="status">{labels[selected.status] ?? selected.status}{selected.errorCode ? ` · ${selected.errorCode}` : ''}</p>
          {selected.plan.items.map(item => <article key={item.after.id} className={inboxStyles.document}>
            <h3>{item.after.title}</h3>
            {item.before ? <details className={inboxStyles.changeDetails}><summary>查看变更前内容与目录标签</summary>
              <p>目录：{item.before.folderId ?? '根目录'} → {item.after.folderId ?? '根目录'}；标签：{item.before.tagIds.join('、') || '无'} → {item.after.tagIds.join('、') || '无'}{item.softDelete ? '；移入回收站' : ''}</p>
              <div className={inboxStyles.beforeBody}><ReadableMarkdown text={item.before.rawMarkdown} /></div>
            </details> : null}
            <div className={inboxStyles.documentBody}><ReadableMarkdown text={item.after.rawMarkdown} /></div>
            {selected.status === 'applied' ? <Button variant="default" size="compact" onPress={() => onOpenNote(item.after.id)}>打开正式笔记</Button> : null}
          </article>)}
          {selected.status === 'expired' ? <p>确认有效期已过，请重新预览。若读取授权也已失效，请重新授权并在对话中生成成果。原稿仍可查看。</p> : null}
          {selected.datasetStale ? <p>资料集已恢复，旧草稿仅供查看；请在当前资料集重新生成。</p> : null}
          {selected.status === 'conflicted' ? <p>正式笔记版本已变化，保留此建议；请查看当前笔记，再在对话中重新生成。</p> : null}
          {selected.status === 'applied' ? <p>成果已保存。旧版本可从笔记版本历史恢复。</p> : <p>待审成果当前不参与笔记库检索；正式采纳后可按笔记隐私设置读取。</p>}
          {editing ? <><TextField label="成果标题" value={title} onChange={value => { requestKey.current = null; setTitle(value); }} isDisabled={busy} />
            <TextAreaField label="成果正文" value={markdown} onChange={value => { requestKey.current = null; setMarkdown(value); }} isDisabled={busy} />
            <Button variant="default" isDisabled={busy || !title.trim() || Boolean(queuedRemote)} onPress={() => void perform(async assertCurrent => {
              requestKey.current ??= crypto.randomUUID(); const item = selected.plan.items[0];
              const action = await noteActionApi.revise(selected, requestKey.current, { title, rawMarkdown: markdown, folderId: item.after.folderId, tagIds: item.after.tagIds });
              assertCurrent(); editingRef.current = false; setEditing(false); requestKey.current = null; return action;
            })}>保存修订预览</Button>
            <Button variant="ghost" isDisabled={busy} onPress={() => {
              editingRef.current = false; setEditing(false); requestKey.current = null;
              if (queuedRemote) { selectedRef.current = queuedRemote; setSelected(queuedRemote); onSelectedActionChange?.(queuedRemote); setQueuedRemote(null); }
            }}>{queuedRemote ? '放弃本地编辑并查看最新成果' : '取消编辑'}</Button></> : null}
        </section> : null}
      </div></div>
      <div className={inboxStyles.footer}>
        {selected ? <>
          <details ref={moreActions} className={inboxStyles.moreActions}><summary>更多成果操作</summary><div>
          <Button variant="ghost" isDisabled={busy} onPress={() => void perform(async assertCurrent => {
            const action = await noteActionApi.get(selected.actionId); assertCurrent();
            if (action.status === 'applied') await store.getState().loadWorkspace();
            return action;
          })}>查询成果状态</Button>
          {!editing && !selected.datasetStale && !['applied', 'cancelled', 'rejected'].includes(selected.status) ? <>
            {selected.plan.toolName === 'notes_create' && selected.plan.items.length === 1 ? <Button variant="default" isDisabled={busy} onPress={() => {
              moreActions.current?.removeAttribute('open'); requestKey.current = null; setTitle(selected.plan.items[0].after.title); setMarkdown(selected.plan.items[0].after.rawMarkdown); editingRef.current = true; setEditing(true);
            }}>编辑新稿</Button> : null}
            {selected.status !== 'applying' ? <Button variant="default" isDisabled={busy} onPress={() => void perform(async assertCurrent => {
              requestKey.current ??= crypto.randomUUID(); const action = await noteActionApi.repreview(selected, requestKey.current);
              assertCurrent(); requestKey.current = null; return action;
            })}>重新预览</Button> : null}
            <Button variant="ghost" isDisabled={busy} onPress={() => void perform(() => noteActionApi.reject(selected.actionId))}>拒绝成果</Button>
          </> : null}
          </div></details>
          {canAdopt && !editing ? <Button variant="primary" className={inboxStyles.adoptButton} isDisabled={busy} onPress={() => void adopt()}>{selected.status === 'applying' ? '对账并重试原成果' : '确认采纳到笔记'}</Button> : null}
        </> : null}
      </div>
    </aside> : null}
  </>;
}

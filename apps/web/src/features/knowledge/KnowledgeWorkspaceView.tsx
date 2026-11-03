import { MathText } from '../../components/math/MathText';
import { ExtractionDemoNotice } from '../editor/ExtractionEnvironment';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { AuthoritativePurgeResult, AuthoritativePurgeStatus, PurgeConfirmationInput, Annotation, CreateKnowledgeCandidateInput, CreateKnowledgeEvidenceInput, KnowledgeEvidence, KnowledgeEvidenceMutationResult, KnowledgeItem, KnowledgePurgePreview, KnowledgePurgeResult, KnowledgeReviewStatus, Note, UpdateKnowledgeItemInput } from '@study-accelerator/web-core';
import { isPurgeResultPending, PURGE_PENDING_MESSAGE, purgeConfirmation, purgeResultMessage } from '../../store/assetPurge';
import { LOCAL_ASSET_PURGE_REASON } from '../../store/workspaceCapabilities';
import { Button, Dialog, DialogBody, DialogFooter, EmptyArt, IconButton, Menu, MenuItem, PointMenu } from '../../components/ui';
import { ScopedAppearanceProvider } from '../../components/ui/overlay';
import { CreateKnowledgeCandidateDialog } from './CreateKnowledgeCandidateDialog';
import { KnowledgeDetail } from './KnowledgeDetail';
import { KnowledgeSourceDialog } from './KnowledgeSourceDialog';
import { KnowledgeItemDialog } from './KnowledgeItemDialog';
import { knowledgeFormValue } from './KnowledgeItemForm';
import { getKnowledgeDraftScope, knowledgeDraftRecovery, type KnowledgeDraft } from './knowledgeDraftRecovery';
import { filterKnowledgeItems, knowledgeError } from './knowledgeViewModel';
import { groupKnowledge, sortKnowledge, useKnowledgeDisplay } from './knowledgeIndexModel';
import { KnowledgeIndexSections, handleKnowledgeListKeys } from './KnowledgeIndexItems';
import { KnowledgeIndexTools } from './KnowledgeIndexTools';
import { notesIndexAppearanceProps } from '../notes/NotesIndexAppearance';
import { useNotesIndexAppearance } from '../notes/notesIndexAppearanceModel';
import { useCompactLayout } from '../../shell/useCompactLayout';
import { useNavigate } from '../../app/router';
import { PathTrail } from '../../shell/PathTrail';
import { CloseIcon, KnowledgeIcon, PlusIcon } from '../../components/icons/knowra';
import { WorkspacePanel, WorkspacePanelBody, WorkspacePanelFooter, WorkspacePanelHeader } from '../../components/workspace/WorkspacePanel';
import styles from './KnowledgeWorkspaceView.module.css';
import indexStyles from './KnowledgeIndex.module.css';

type VersionInput = { expectedUpdatedAt?: string };
export interface KnowledgeWorkspaceViewProps {
  selectedItemId?: string | null;
  refreshKey?: number;
  canWrite: boolean;
  readOnlyReason?: string;
  onSelectItem(id: string): void;
  /** 关闭右侧检查器（回到未选中状态）。 */
  onCloseItem?(): void;
  onOpenNote(noteId: string): void;
  onList(query?: { reviewStatus?: KnowledgeReviewStatus; query?: string; noteId?: string; includeArchived?: boolean; includeDeleted?: boolean }): Promise<KnowledgeItem[]>;
  onGet(id: string): Promise<KnowledgeItem>;
  onListEvidence(id: string): Promise<KnowledgeEvidence[]>;
  notes: Note[];
  onListAnnotations(noteId: string): Promise<Annotation[]>;
  onCreateEvidence(id: string, input: CreateKnowledgeEvidenceInput): Promise<KnowledgeEvidence>;
  onRetireEvidence(id: string, evidenceId: string, input?: { expectedUpdatedAt?: string }): Promise<KnowledgeEvidenceMutationResult>;
  onReadoptEvidence?(id: string, evidenceId: string, input?: { expectedUpdatedAt?: string }): Promise<KnowledgeEvidenceMutationResult>;
  onCreate(input: CreateKnowledgeCandidateInput): Promise<{ item: KnowledgeItem; evidence: KnowledgeEvidence[] }>;
  onUpdate(id: string, input: UpdateKnowledgeItemInput): Promise<KnowledgeItem>;
  onConfirm(id: string, input: VersionInput): Promise<KnowledgeItem>;
  onArchive(id: string, input: VersionInput): Promise<KnowledgeItem>;
  onRestore(id: string, input: VersionInput): Promise<KnowledgeItem>;
  onTrash?(id: string, input: VersionInput): Promise<KnowledgeItem>;
  onRestoreDeleted?(id: string, input: VersionInput): Promise<KnowledgeItem>;
  onInspectPurge?(id: string): Promise<KnowledgePurgePreview>;
  onPermanentDelete?(id: string, input: PurgeConfirmationInput): Promise<KnowledgePurgeResult>;
  authoritativePurge?: boolean;
  onPurgeStatus?(): Promise<AuthoritativePurgeStatus>;
}

export function KnowledgeWorkspaceView(props: KnowledgeWorkspaceViewProps) {
  const navigate = useNavigate();
  const { selectedItemId, refreshKey, canWrite, readOnlyReason, onList, onGet, onListEvidence } = props;
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [detail, setDetail] = useState<{ item: KnowledgeItem; evidence: KnowledgeEvidence[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [mutationFeedback, setMutationFeedback] = useState<{ error: boolean; title: string; text: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editDraft, setEditDraft] = useState<KnowledgeDraft | null>(null);
  const [recoveryDraft, setRecoveryDraft] = useState<KnowledgeDraft | undefined>();
  const [drafts, setDrafts] = useState<KnowledgeDraft[]>([]);
  const [draftError, setDraftError] = useState('');
  const scope = getKnowledgeDraftScope();
  const [archiveItem, setArchiveItem] = useState<KnowledgeItem | null>(null);
  const [trashItem, setTrashItem] = useState<KnowledgeItem | null>(null);
  const [purgePreview, setPurgePreview] = useState<KnowledgePurgePreview | null>(null);
  const [purgeAwaitingId, setPurgeAwaitingId] = useState<string | null>(null);
  const [purgedItemId, setPurgedItemId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; item: KnowledgeItem } | null>(null);
  const compact = useCompactLayout();
  const display = useKnowledgeDisplay();
  const theme = notesIndexAppearanceProps(useNotesIndexAppearance());
  const [sourceDialog, setSourceDialog] = useState<{ replacing?: KnowledgeEvidence } | null>(null);
  const [retireEvidence, setRetireEvidence] = useState<KnowledgeEvidence | null>(null);
  const selectedRef = useRef(selectedItemId);
  selectedRef.current = selectedItemId;
  const selectedTrashed = items.find(item => item.id === selectedItemId && item.deletedAt);

  useEffect(() => {
    if (!props.authoritativePurge || !props.onPurgeStatus) return;
    let active = true;
    void props.onPurgeStatus().then(status => {
      if (active && status.pending?.type === 'knowledgeItem' && status.pending.id === selectedItemId) {
        setPurgeAwaitingId(status.pending.id); setNotice(PURGE_PENDING_MESSAGE);
      }
    }).catch(() => { /* 尚未执行清理时，预检入口负责说明连接或兼容问题。 */ });
    return () => { active = false; };
  }, [props.authoritativePurge, props.onPurgeStatus, selectedItemId]);

  useEffect(() => {
    let active = true;
    setListLoading(true); setListError('');
    void onList({ includeArchived: true, includeDeleted: true }).then(result => { if (active) setItems(result); })
      .catch(error => { if (active) setListError(knowledgeError(error, '知识列表加载失败。')); })
      .finally(() => { if (active) setListLoading(false); });
    return () => { active = false; };
  }, [onList, refresh, refreshKey]);

  useEffect(() => {
    let active = true;
    setDetail(null); setDetailError('');
    if (!selectedItemId) { setDetailLoading(false); return; }
    if (selectedItemId === purgedItemId) { setDetailLoading(false); return; }
    if (selectedTrashed) {
      setDetailLoading(true);
      void onListEvidence(selectedItemId)
        .then(evidence => { if (active) setDetail({ item: selectedTrashed, evidence }); })
        .catch(error => { if (active) setDetailError(knowledgeError(error, '知识历史来源加载失败。')); })
        .finally(() => { if (active) setDetailLoading(false); });
      return () => { active = false; };
    }
    setDetailLoading(true);
    void Promise.all([onGet(selectedItemId), onListEvidence(selectedItemId)])
      .then(([item, evidence]) => { if (active) setDetail({ item, evidence }); })
      .catch(error => { if (active) setDetailError(knowledgeError(error, '知识详情加载失败。')); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selectedItemId, onGet, onListEvidence, refresh, refreshKey, selectedTrashed?.id, purgedItemId]);

  useEffect(() => { setNotice(''); }, [selectedItemId]);

  useEffect(() => {
    try { setDrafts(knowledgeDraftRecovery.list(scope)); setDraftError(''); }
    catch (cause) { setDraftError(knowledgeError(cause, '知识恢复草稿读取失败，请保留恢复文件。')); }
  }, [scope, createOpen, editDraft, refresh]);

  function openEdit(item: KnowledgeItem) {
    const previous = drafts.find(draft => draft.kind === 'edit' && draft.candidateId === item.id);
    const initialValue = knowledgeFormValue(item);
    setRecoveryDraft(previous);
    setEditDraft(previous ?? { version: 1, kind: 'edit', candidateId: item.id, expectedUpdatedAt: item.updatedAt, initialValue, value: initialValue });
  }

  const activeItems = useMemo(() => items.filter(item => !item.deletedAt), [items]);
  const visible = useMemo(() => sortKnowledge(status === 'trash'
    ? items.filter(item => item.deletedAt && (!query || [item.title, item.canonicalStatement].some(value => value.toLocaleLowerCase().includes(query.toLocaleLowerCase()))))
    : filterKnowledgeItems(activeItems, status, query), display.sort), [activeItems, items, status, query, display.sort]);
  const sections = useMemo(() => groupKnowledge(visible, display.group), [visible, display.group]);
  const counts = useMemo(() => activeItems.reduce((result, item) => {
    const key = item.reviewStatus ?? 'candidate'; result[key] = (result[key] ?? 0) + 1; return result;
  }, {} as Record<string, number>), [activeItems]);
  const filterCounts = useMemo(() => ({ ...counts, all: activeItems.length - (counts.archived ?? 0), trash: items.length - activeItems.length }), [counts, activeItems, items]);

  function acceptItem(item: KnowledgeItem) {
    setItems(current => current.some(row => row.id === item.id) ? current.map(row => row.id === item.id ? item : row) : [item, ...current]);
    if (selectedRef.current === item.id) setDetail(current => current ? { ...current, item } : null);
  }

  async function mutate(item: KnowledgeItem, action: KnowledgeWorkspaceViewProps['onConfirm'], message: string) {
    if (!canWrite || pending) return;
    setPending(true); setMutationFeedback(null);
    if (selectedRef.current === item.id) { setDetailError(''); setNotice(''); }
    try {
      const result = await action(item.id, { expectedUpdatedAt: item.updatedAt });
      acceptItem(result); setArchiveItem(null); setTrashItem(null);
      setMutationFeedback({ error: false, title: item.title || '未命名知识', text: message });
    } catch (cause) {
      setMutationFeedback({ error: true, title: item.title || '未命名知识', text: knowledgeError(cause) });
    }
    finally { setPending(false); }
  }

  async function saveSource(annotation: Annotation, replacing?: KnowledgeEvidence | null) {
    if (!detail || !canWrite || pending) return;
    setPending(true); setDetailError(''); setNotice('');
    let created = false;
    try {
      await props.onCreateEvidence(detail.item.id, {
        sourceType: 'annotation',
        annotationId: annotation.id,
        ...(annotation.noteVersionId ? { noteVersionId: annotation.noteVersionId } : {}),
        ...(annotation.revision !== undefined ? { expectedAnnotationRevision: annotation.revision } : {})
      });
      created = true;
      if (replacing) {
        const result = await props.onRetireEvidence(detail.item.id, replacing.id, { expectedUpdatedAt: replacing.updatedAt });
        acceptItem(result.item);
      }
      setSourceDialog(null);
      setNotice(replacing ? '来源已更换；旧来源已保留为历史记录。' : '来源已添加。');
      setRefresh(value => value + 1);
    } catch (cause) {
      if (created && replacing) {
        setSourceDialog(null);
        setNotice('新来源已添加，但旧来源未能自动移除；请核对后手动移除旧来源。');
        setRefresh(value => value + 1);
        return;
      }
      setDetailError(knowledgeError(cause, '知识来源保存失败。'));
      throw cause;
    } finally { setPending(false); }
  }

  async function confirmRetire() {
    if (!detail || !retireEvidence || !canWrite || pending) return;
    setPending(true); setDetailError(''); setNotice('');
    try {
      const result = await props.onRetireEvidence(detail.item.id, retireEvidence.id, { expectedUpdatedAt: retireEvidence.updatedAt });
      acceptItem(result.item);
      setRetireEvidence(null);
      setNotice('来源已移除，原摘录仍保留在来源历史中。');
      setRefresh(value => value + 1);
    } catch (cause) { setDetailError(knowledgeError(cause, '移除来源失败。')); }
    finally { setPending(false); }
  }

  async function readopt(record: KnowledgeEvidence) {
    if (!detail || !props.onReadoptEvidence || !canWrite || pending) return;
    setPending(true); setDetailError('');
    try {
      const result = await props.onReadoptEvidence(detail.item.id, record.id, { expectedUpdatedAt: record.updatedAt });
      acceptItem(result.item); setNotice('来源已重新采用；请核对知识审核状态。'); setRefresh(value => value + 1);
    } catch (cause) { setDetailError(knowledgeError(cause, '重新采用来源失败。')); }
    finally { setPending(false); }
  }

  async function openPurgePreview(item: KnowledgeItem) {
    if (!props.onInspectPurge || pending) return;
    setPending(true); setDetailError('');
    try { setPurgePreview(await props.onInspectPurge(item.id)); setPurgeAwaitingId(null); setNotice(''); }
    catch (cause) { setDetailError(knowledgeError(cause, '永久删除预检失败。')); }
    finally { setPending(false); }
  }

  function acceptPurgeResult(result: AuthoritativePurgeResult) {
    setPurgeAwaitingId(null); setPurgePreview(null); setDetailError('');
    if (props.authoritativePurge) setNotice(purgeResultMessage(result));
    else setNotice('知识点主体及专属来源已清理；离线设备待同步，备份按保留策略处理。');
    if (result.localState === 'recovery-required') { setRefresh(value => value + 1); return; }
    setItems(current => current.filter(item => item.id !== result.asset.id));
    setPurgedItemId(result.asset.id); setDetail(null);
    if (!props.authoritativePurge) navigate('/knowledge');
  }
  async function checkPurgeResult() {
    if (!purgeAwaitingId || !props.onPurgeStatus || pending) return;
    setPending(true); setDetailError('');
    try {
      const status = await props.onPurgeStatus();
      if (status.result?.asset.type === 'knowledgeItem' && status.result.asset.id === purgeAwaitingId && !status.pending) acceptPurgeResult(status.result);
      else setNotice(PURGE_PENDING_MESSAGE);
    } catch (cause) { setDetailError(knowledgeError(cause, '暂时无法核对清理结果，请保留原件并重试。')); }
    finally { setPending(false); }
  }

  async function confirmPurge() {
    if (!purgePreview || !props.onPermanentDelete || pending || purgeAwaitingId || !canWrite) return;
    setPending(true); setDetailError('');
    try {
      const result = await props.onPermanentDelete(purgePreview.asset.id, purgeConfirmation(purgePreview));
      acceptPurgeResult(result);
    } catch (cause) {
      if (props.authoritativePurge && isPurgeResultPending(cause)) {
        setPurgeAwaitingId(purgePreview.asset.id); setNotice(PURGE_PENDING_MESSAGE); return;
      }
      setDetailError(knowledgeError(cause, '永久删除失败，请重新预检。'));
      setPurgePreview(null);
    } finally { setPending(false); }
  }

  useEffect(() => {
    if (purgeAwaitingId && props.onPurgeStatus) void checkPurgeResult();
    // 云端同步已落库后才重新读取核对结果，不重新执行清理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  function runMenu(key: string, item: KnowledgeItem) {
    setMenu(null);
    if (key === 'view') props.onSelectItem(item.id);
    else if (key === 'edit') openEdit(item);
    else if (key === 'archive') { setMutationFeedback(null); setArchiveItem(item); }
    else if (key === 'restore') void mutate(item, props.onRestore, '已恢复为候选，请重新核对后确认。');
    else if (key === 'trash') { setMutationFeedback(null); setTrashItem(item); }
    else if (key === 'untrash' && props.onRestoreDeleted) void mutate(item, props.onRestoreDeleted, '知识已从回收站恢复；审核与来源已重新校验。');
  }
  function focusSearchKey(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    if ((event.target as Element).closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"]')) return;
    event.preventDefault(); searchRef.current?.focus();
  }
  // 退出动画期间保留条目快照，避免菜单集合在关闭时切换身份。
  const menuItemRef = useRef<KnowledgeItem | undefined>(undefined);
  if (menu) menuItemRef.current = menu.item;
  const menuItem = menuItemRef.current;
  const menuDisabled = !canWrite || pending;
  const detailContent = detailLoading ? <p className={styles.empty} role="status">正在加载详情与来源…</p> : detail ? <KnowledgeDetail {...detail} canWrite={canWrite} pending={pending}
    onEdit={() => openEdit(detail.item)} onConfirm={() => void mutate(detail.item, props.onConfirm, '已确认这条知识。')}
    onArchive={() => { setMutationFeedback(null); setArchiveItem(detail.item); }} onRestore={() => void mutate(detail.item, props.onRestore, '已恢复为候选，请重新核对后确认。')} onOpenNote={props.onOpenNote}
    onTrash={() => { setMutationFeedback(null); setTrashItem(detail.item); }} onRestoreDeleted={() => props.onRestoreDeleted && void mutate(detail.item, props.onRestoreDeleted, '知识已从回收站恢复；审核与来源已重新校验。')}
    onPurgePreview={props.onPermanentDelete ? () => void openPurgePreview(detail.item) : undefined}
    onAddSource={() => setSourceDialog({})} onReplaceSource={record => setSourceDialog({ replacing: record })} onRetireSource={setRetireEvidence} onReadoptSource={record => void readopt(record)} />
    : !detailError ? <div className={`${styles.empty} ${styles.emptyDetail}`}><span className={styles.emptyIcon} aria-hidden="true"><KnowledgeIcon size={22} /></span><h2>没有可显示的知识</h2><p>该知识可能已被清理或暂不可用。</p></div> : null;

  return <ScopedAppearanceProvider value={theme}><WorkspacePanel as="main" aria-labelledby="knowledge-title" {...theme} className={`${theme.className} ${indexStyles.panel}`} onKeyDown={focusSearchKey}>
    <WorkspacePanelHeader title="知识库" code="KNOW" titleId="knowledge-title" icon={<KnowledgeIcon size={13} />} className={compact ? indexStyles.compactHeader : undefined}
      breadcrumb={<PathTrail path={[{ id: 'home', label: '主页', onNavigate: () => navigate('/') }, { id: 'knowledge', label: '知识库', current: true }]} variant="top" />}
      breadcrumbTitle="主页 / 知识库" actionsLabel="知识操作"
      actions={<KnowledgeIndexTools compact={compact} query={query} onQueryChange={setQuery} searchRef={searchRef} status={status} onStatusChange={setStatus} counts={filterCounts}
        display={display} canWrite={canWrite} busy={listLoading || pending} onRefresh={() => setRefresh(value => value + 1)}
        onCreate={() => { setRecoveryDraft(undefined); setCreateOpen(true); }} />} />
    <WorkspacePanelBody grid className={indexStyles.content}>
      <ExtractionDemoNotice />
      {!canWrite || draftError || drafts.length || mutationFeedback ? <div className={indexStyles.messages}>
        {!canWrite ? <p className={styles.readOnly} role="status">{readOnlyReason ?? '当前为只读模式，暂不能修改知识。'}</p> : null}
        {mutationFeedback && !(mutationFeedback.error && (archiveItem || trashItem)) ? <p role={mutationFeedback.error ? 'alert' : 'status'} className={mutationFeedback.error ? styles.error : styles.notice}>“{mutationFeedback.title}”：<span>{mutationFeedback.text}</span></p> : null}
        {draftError ? <p role="alert" className={styles.error}>{draftError}</p> : null}
        {drafts.length ? <section className={styles.notice} aria-label="未保存的知识草稿"><strong>有 {drafts.length} 条知识草稿尚未保存</strong>
          {drafts.map(draft => <Button key={draft.candidateId} variant="ghost" onPress={() => {
            setRecoveryDraft(draft); if (draft.kind === 'create') setCreateOpen(true); else setEditDraft(draft);
          }}>恢复草稿：{draft.value.title || '未命名知识'}</Button>)}
        </section> : null}
      </div> : null}
      <div className={indexStyles.indexWrap}>
        <section className={indexStyles.indexMain} aria-label="知识列表">
          {listError ? <p role="alert" className={indexStyles.loadError}><span>{listError}</span> <Button variant="ghost" size="compact" onPress={() => setRefresh(value => value + 1)}>重试加载列表</Button></p> : null}
          <div className={indexStyles.listScroll} role="region" aria-label="知识列表内容" tabIndex={0} aria-busy={listLoading}
            onKeyDown={event => { handleKnowledgeListKeys(event); if (event.key === 'Escape' && selectedItemId && props.onCloseItem && !(event.target as Element).closest('[role="menu"], [role="dialog"]')) props.onCloseItem(); }}>
            {listLoading && items.length === 0 ? <p className={indexStyles.empty} role="status">正在加载知识…</p> : null}
            {!listLoading && !listError && visible.length === 0 ? <div className={indexStyles.empty}>
              <EmptyArt variant={items.length === 0 ? 'knowledge' : 'search'} />
              <strong>{items.length === 0 ? '还没有知识' : '没有符合条件的知识。'}</strong>
              <p>{items.length === 0 ? '可从笔记标注创建候选，或手动新建。' : '试试换个关键词，或者清除筛选条件。'}</p>
              {items.length === 0 ? (canWrite ? <Button variant="primary" isDisabled={pending} onPress={() => { setRecoveryDraft(undefined); setCreateOpen(true); }}><PlusIcon size={16} />新建知识候选</Button> : null)
                : <Button variant="ghost" onPress={() => { setQuery(''); setStatus('all'); }}>清除搜索与筛选</Button>}</div> : null}
            <KnowledgeIndexSections sections={sections} view={display.view} showHeadings={display.group !== 'none'} collapsed={collapsed}
              onToggle={id => setCollapsed(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
              selectedItemId={selectedItemId} disabled={pending} properties={display.properties} onSelect={props.onSelectItem}
              onOpenMenu={(item, point) => setMenu({ ...point, item })} />
          </div>
        </section>
        {selectedItemId ? <aside className={indexStyles.inspector} aria-label="知识检查器">
          <header className={indexStyles.inspectorHeader}><h2>详情</h2>
            {props.onCloseItem ? <IconButton aria-label="关闭详情" onPress={props.onCloseItem}><CloseIcon size={18} /></IconButton> : null}</header>
          <section className={`${indexStyles.inspectorBody} ${styles.detailPanel}`} tabIndex={0} aria-label="知识详情面板" aria-busy={detailLoading || pending}>
            {notice ? <p role="status" className={styles.notice}>{notice}</p> : null}
            {purgeAwaitingId && !purgePreview ? <Button isDisabled={pending} onPress={() => void checkPurgeResult()}>核对清理结果</Button> : null}
            {detailError ? <p role="alert" className={styles.error}>{detailError} {!archiveItem ? <Button variant="ghost" onPress={() => setRefresh(value => value + 1)}>重新加载知识</Button> : null}</p> : null}
            {detailContent}
          </section>
        </aside> : null}
      </div>
    </WorkspacePanelBody>
    <WorkspacePanelFooter className={indexStyles.footer}><span>显示 {visible.length} / {items.length} 条知识</span><span>{status === 'trash' ? '保留至手动清理；不会自动到期删除' : <>候选 {counts.candidate ?? 0} · 已确认 {counts.confirmed ?? 0} · 待修订 {counts.needsRevision ?? 0} · 已归档 {counts.archived ?? 0}</>}</span></WorkspacePanelFooter>
    <PointMenu point={menu ? { x: menu.x, y: menu.y } : null} onOpenChange={open => { if (!open) setMenu(null); }}>
      <Menu ariaLabel="知识操作" onClose={() => setMenu(null)} onAction={key => menuItem && runMenu(String(key), menuItem)}>
        <MenuItem key="view" id="view">查看详情</MenuItem>
        {menuItem?.deletedAt ? <MenuItem key="untrash" id="untrash" isDisabled={menuDisabled || !props.onRestoreDeleted}>从回收站恢复</MenuItem> : <>
          <MenuItem key="edit" id="edit" isDisabled={menuDisabled || menuItem?.reviewStatus === 'archived'}>编辑</MenuItem>
          {menuItem?.reviewStatus === 'archived' ? <MenuItem key="restore" id="restore" isDisabled={menuDisabled}>恢复为候选</MenuItem> : <MenuItem key="archive" id="archive" isDisabled={menuDisabled}>归档</MenuItem>}
          <MenuItem key="trash" id="trash" isDanger isDisabled={menuDisabled || !props.onTrash}>移入回收站</MenuItem>
        </>}
      </Menu>
    </PointMenu>
    {createOpen ? <CreateKnowledgeCandidateDialog recoveryDraft={recoveryDraft} canWrite={canWrite} readOnlyReason={readOnlyReason} onClose={() => setCreateOpen(false)} onCreate={props.onCreate}
      onCreated={item => { acceptItem(item); setStatus('candidate'); setQuery(''); props.onSelectItem(item.id); }} /> : null}
    {editDraft ? <KnowledgeItemDialog key={editDraft.candidateId} title="编辑知识" draft={editDraft} recovered={Boolean(recoveryDraft)} canWrite={canWrite} readOnlyReason={readOnlyReason}
      onClose={() => setEditDraft(null)} onSubmit={async (value, baseline) => props.onUpdate(baseline.candidateId, { ...value, expectedUpdatedAt: baseline.expectedUpdatedAt })}
      onSaved={item => { if (item) { acceptItem(item); setNotice('知识已保存。'); } }} /> : null}
    {archiveItem ? <Dialog title="归档这条知识？" description={`“${archiveItem.title || '未命名知识'}”将移入已归档，来源仍保留。恢复后会成为待核对的候选。`} isOpen isPending={pending} onOpenChange={open => { if (!open && !pending) { setArchiveItem(null); setMutationFeedback(null); } }}>
      {mutationFeedback?.error ? <DialogBody><p role="alert" className={styles.error}>“{mutationFeedback.title}”：<span>{mutationFeedback.text}</span></p></DialogBody> : null}
      <DialogFooter><Button variant="ghost" isDisabled={pending} onPress={() => { setArchiveItem(null); setMutationFeedback(null); }}>取消</Button><Button variant="danger" isPending={pending} isDisabled={!canWrite} onPress={() => void mutate(archiveItem, props.onArchive, '知识已归档。')}>确认归档</Button></DialogFooter>
    </Dialog> : null}
    {trashItem ? <Dialog title="移入知识回收站？" description={`“${trashItem.title || '未命名知识'}”将退出日常使用；关联的学习目标、题目和来源历史不会一起删除。恢复后会重新检查来源与审核状态。`} isOpen isPending={pending} onOpenChange={open => { if (!open && !pending) { setTrashItem(null); setMutationFeedback(null); } }}>
      <DialogBody>{mutationFeedback?.error ? <p role="alert" className={styles.error}>“{mutationFeedback.title}”：<span>{mutationFeedback.text}</span></p> : null}</DialogBody>
      <DialogFooter><Button variant="ghost" isDisabled={pending} onPress={() => { setTrashItem(null); setMutationFeedback(null); }}>取消</Button><Button variant="danger" isPending={pending} isDisabled={!canWrite || !props.onTrash} onPress={() => props.onTrash && void mutate(trashItem, props.onTrash, '知识已移入回收站。')}>确认移入回收站</Button></DialogFooter>
    </Dialog> : null}
    {purgePreview ? <Dialog title="永久删除知识点？" description="删除后无法普通恢复。来源笔记和标注不会删除；离线设备待同步，备份按保留策略处理。" isOpen isPending={pending} onOpenChange={open => { if (!open && !pending) setPurgePreview(null); }}>
      <DialogBody>
        {props.authoritativePurge ? <p>{LOCAL_ASSET_PURGE_REASON}</p> : null}
        <p>将清理 {purgePreview.exclusiveRecords.knowledgeEvidenceIds.length} 条专属来源记录和 {purgePreview.exclusiveRecords.knowledgeArtifactProvenanceIds?.length ?? 0} 条生成来源摘要。</p>
        {purgePreview.references.length ? <><p>当前有 {purgePreview.references.length} 个关联对象，处理前不能永久删除：</p><ul>{purgePreview.references.map(reference => <li key={`${reference.collection}:${reference.id}`}>{reference.collection} · {reference.id}（{reference.reasonCode}）</li>)}</ul><p>请先核对并处理所列关联对象，然后重新预检。</p></> : null}
        {detailError ? <p role="alert" className={styles.error}>{detailError}</p> : null}
      </DialogBody>
      <DialogFooter><Button variant="ghost" isDisabled={pending} onPress={() => setPurgePreview(null)}>返回回收站</Button>{purgeAwaitingId ? <Button isDisabled={pending} onPress={() => void checkPurgeResult()}>核对清理结果</Button> : <Button isDisabled={pending} onPress={() => detail && void openPurgePreview(detail.item)}>重新预检</Button>}<Button variant="danger" isPending={pending} isDisabled={!canWrite || Boolean(purgeAwaitingId) || purgePreview.decision !== 'can-purge-no-history'} onPress={() => void confirmPurge()}>确认永久删除</Button></DialogFooter>
    </Dialog> : null}
    {sourceDialog && detail ? <KnowledgeSourceDialog notes={props.notes} evidence={detail.evidence} replacing={sourceDialog.replacing} onClose={() => setSourceDialog(null)} onListAnnotations={props.onListAnnotations} onSave={saveSource} /> : null}
    {retireEvidence ? <Dialog title="撤回这条来源的适用性？" description="来源的技术健康状态与历史摘录会保留；若这是已确认知识的最后一个适用来源，知识会转为待修订。" isOpen isPending={pending} onOpenChange={open => { if (!open && !pending) setRetireEvidence(null); }}>
      <DialogBody><blockquote className={styles.prose}>{retireEvidence.quoteText ? <MathText text={retireEvidence.quoteText} /> : '该来源没有文字摘录'}</blockquote>{detailError ? <p role="alert" className={styles.error}>{detailError}</p> : null}</DialogBody>
      <DialogFooter><Button variant="ghost" isDisabled={pending} onPress={() => setRetireEvidence(null)}>取消</Button><Button variant="danger" isPending={pending} onPress={() => void confirmRetire()}>确认移除</Button></DialogFooter>
    </Dialog> : null}
  </WorkspacePanel></ScopedAppearanceProvider>;
}

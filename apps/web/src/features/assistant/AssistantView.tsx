import { NoteActions } from './NoteActions';
import { ConversationTrace } from './ConversationTrace';
import { PressableButton } from '../../components/ui/button/PressableButton';
import { ConversationAttachmentPicker } from './ConversationAttachmentPicker';
import { AIInbox } from './AIInbox';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/button/Button';
import { IconButton } from '../../components/ui/button/IconButton';
import { SegmentedButton, SegmentedControl } from '../../components/ui/button/SegmentedControl';
import { Badge } from '../../components/ui/status/Badge';
import { Menu, MenuItem, MenuPopover, MenuSeparator, MenuTrigger } from '../../components/ui/overlay/Menu';
import { ArrowRightIcon, BookIcon, CheckIcon, ChevronDownIcon, CopyIcon, EditIcon, MoreHorizontalIcon, NoteIcon, PlusIcon, SearchIcon, SparkIcon } from '../../components/icons/knowra';
import { Select, TextAreaField } from '../../components/ui/input';
import { Dialog, DialogBody, DialogFooter } from '../../components/ui/overlay/Dialog';
import { Popover, PopoverDialog, PopoverTrigger } from '../../components/ui/overlay/Popover';
import { WorkspacePanel, WorkspacePanelBody, WorkspacePanelHeader } from '../../components/workspace/WorkspacePanel';
import { useNavigate } from '../../app/router';
import { useAppStore } from '../../store/AppStoreProvider';
import { PathTrail } from '../../shell/PathTrail';
import { assistantApi, type AssistantStatus } from './assistantApi';
import { ASSISTANT_STATUS_CHANGED_EVENT } from './assistantEvents';
import { conversationApi, type AccessPolicy, type Conversation, type ConversationMessage,
  type ConversationTurn } from './conversationApi';
import type { NoteAction } from './noteActionApi';
import { isCurrentReviewTarget } from './reviewTarget';
import { LegacyAssistantView } from './LegacyAssistantView';
import { readConversationSnapshot } from './conversationSnapshot';
import { useConversationSourcePreview } from './useConversationSourcePreview';
import { aiFeatures } from '../settings/aiFeatures';
import { ReadableMarkdown } from './ReadableMarkdown';
import styles from './ConversationView.module.css';

const phaseName: Record<ConversationTurn['phase'], string> = {
  waiting: '等待执行', retrieving: '正在检索', generating: '正在生成',
  validating: '正在核对来源', finished: '已结束'
};
const statusName: Record<ConversationTurn['status'], string> = {
  staged: '等待执行', running: '处理中', interrupted: '已中断',
  succeeded: '已完成', failed: '失败', cancelled: '已停止'
};
const isActive = (turn: ConversationTurn | null) => turn?.status === 'staged' || turn?.status === 'running';
const blocked = (turn: ConversationTurn | null) => isActive(turn) || turn?.status === 'interrupted';
const errorText = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback;
const formatTime = (value: string) => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const formatClock = (value: string) => new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
const formatDay = (value: string) => new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
function dayGroup(value: string) {
  const day = new Date(value); day.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86400_000);
  return diff <= 0 ? '今天' : diff === 1 ? '昨天' : '更早';
}
const scopeMark = (selected: boolean) => selected ? <CheckIcon size={14} /> : <span style={{ display: 'inline-block', width: 14 }} />;
const activeActionStatuses = ['awaitingApproval', 'authorized', 'applying'];

interface PendingSend { conversationId: string; idempotencyKey: string; content: string; requestedPolicyId: string | null }

interface AssistantViewProps { pathname: string; onOpenNote(noteId: string): void }

export function AssistantView(props: AssistantViewProps) {
  return new URLSearchParams(props.pathname.split('?')[1] ?? '').get('view') === 'legacy'
    ? <LegacyAssistantView {...props} readOnly /> : <ConversationAssistantView {...props} />;
}

function ConversationAssistantView({ pathname, onOpenNote }: AssistantViewProps) {
  const navigate = useNavigate();
  const serverData = useAppStore(state => state.serverData);
  const selectKnowledgeSpace = useAppStore(state => state.selectKnowledgeSpace);
  const getNoteVersion = useAppStore(state => state.getNoteVersion);
  const spaceId = serverData.currentSpaceId;
  const params = useMemo(() => new URLSearchParams(pathname.split('?')[1] ?? ''), [pathname]);
  const initialNoteId = params.get('noteId');
  const requestedId = params.get('conversationId');
  const newConversation = params.get('new') === '1';
  const notes = useMemo(() => serverData.notes.filter(note => !note.deleted && (!note.spaceId || note.spaceId === spaceId)), [serverData.notes, spaceId]);
  const folders = useMemo(() => serverData.folderTree.filter(folder => !folder.deletedAt && (!folder.spaceId || folder.spaceId === spaceId)), [serverData.folderTree, spaceId]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [policies, setPolicies] = useState<AccessPolicy[]>([]);
  const [policiesReady, setPoliciesReady] = useState(false);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [turns, setTurns] = useState<Record<string, ConversationTurn>>({});
  const [scopeChoice, setScopeChoice] = useState('plain');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantKind, setGrantKind] = useState<'library' | 'folder' | 'fixed'>('library');
  const [grantNoteId, setGrantNoteId] = useState(initialNoteId ?? '');
  const [grantFolderId, setGrantFolderId] = useState('');
  const [grantDays, setGrantDays] = useState('7');
  const [recordMessage, setRecordMessage] = useState<ConversationMessage | null>(null);
  const [managementOpen, setManagementOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [artifacts, setArtifacts] = useState<NoteAction[]>([]);
  const [focusedActionId, setFocusedActionId] = useState<string | null>(null);
  const [reviewedAction, setReviewedAction] = useState<NoteAction | null>(null);
  const [retryConfirmOpen, setRetryConfirmOpen] = useState(false);
  const inboxTrigger = useRef<HTMLButtonElement>(null);
  const inboxOpener = useRef<HTMLElement | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const pendingSend = useRef<PendingSend | null>(null);
  const selection = useRef<string | null>(null);
  const refreshSequence = useRef(0);
  const scopeRevision = useRef(0);
  const space = useRef(spaceId);
  space.current = spaceId;

  const selected = newConversation ? null : conversations.find(item => item.conversationId === requestedId)
    ?? conversations[0] ?? null;
  const selectedId = selected?.conversationId ?? null;
  selection.current = selectedId;
  const { sourceView, openSource, closeSource } = useConversationSourcePreview({
    spaceId, conversationId: selectedId, getNoteVersion, onError: setError
  });
  const latestTurn = messages.length ? turns[messages[messages.length - 1].turnId] ?? null : null;
  const reviewingOtherDraft = Boolean(inboxOpen && reviewedAction
    && !isCurrentReviewTarget(reviewedAction, selectedId, messages, latestTurn));
  const deliveryUncertain = latestTurn?.modelAttempts?.some(attempt =>
    (attempt.ordinal ?? Infinity) > (latestTurn.checkpoint?.handledAttemptOrdinal ?? 0)
    && (attempt.status === 'sent' || ['settled', 'unknown'].includes(attempt.status) && !attempt.modelResult)) ?? false;
  const activePolicies = policies.filter(item => !item.revokedAt && Date.parse(item.expiresAt) > Date.now() && item.egress);
  const chosenPolicy = activePolicies.find(item => item.policyId === scopeChoice);
  const pendingArtifacts = artifacts.filter(action => activeActionStatuses.includes(action.status)).length;
  const conversationTitle = selected ? (titles[selected.conversationId] ?? `会话 · ${formatTime(selected.createdAt)}`) : '新对话';
  const historyGroups = ['今天', '昨天', '更早'].map(label => ({ label, items: conversations.filter(item => dayGroup(item.createdAt) === label) })).filter(group => group.items.length);
  const noteName = (id: string) => notes.find(note => note.id === id)?.title || '已移除的笔记';
  const scopeName = (policy: AccessPolicy) => {
    const scope = policy.scope;
    return scope.kind === 'library' ? '当前知识空间'
      : scope.kind === 'folder' ? `目录：${folders.find(folder => folder.id === scope.folderId)?.name ?? '已移除目录'}`
        : `笔记：${scope.noteIds.map(noteName).join('、')}`;
  };

  useEffect(() => {
    if (!spaceId) return;
    let cancelled = false;
    setConversations([]); setPolicies([]); setPoliciesReady(false); setMessages([]); setTurns({}); setTitles({}); setArtifacts([]); setReviewedAction(null);
    setStatus(null); scopeRevision.current++; setScopeChoice('plain'); setError(null); setNotice(null);
    pendingSend.current = null; setRecordMessage(null); setManagementOpen(false);
    void conversationApi.list(spaceId).then(rows => { if (!cancelled) setConversations(rows); })
      .catch(cause => { if (!cancelled) setError(errorText(cause, '无法加载会话历史。')); });
    void conversationApi.policies(spaceId).then(rows => { if (!cancelled) { setPolicies(rows); setPoliciesReady(true); } })
      .catch(cause => { if (!cancelled) setError(errorText(cause, '无法加载读取授权。')); });
    void assistantApi.status().then(next => { if (!cancelled) setStatus(next); })
      .catch(cause => { if (!cancelled) setError(errorText(cause, '无法读取模型状态。')); });
    return () => { cancelled = true; };
  }, [spaceId]);

  // 从编辑器进入“提炼知识点”：预填明确的请求（含笔记标题与 ID，助手据此定位本篇）；已有覆盖本篇的有效授权就直接选用，
  // 否则打开授权对话框（预设为仅本篇）——读取与外发必须由用户明确授权，这里不自动授权、不自动发送。
  const extractNote = newConversation && params.get('intent') === 'extract' && initialNoteId ? notes.find(note => note.id === initialNoteId) ?? null : null;
  const extractApplied = useRef<string | null>(null);
  // “AI 提炼知识点”功能开关：关闭时入口仍然可用，但进入助手后只说明未开启，不再引导授权（授权对读取与外发是另一道门）。
  const [proposalsFlag, setProposalsFlag] = useState<'loading' | 'on' | 'off' | 'unknown'>('loading');
  useEffect(() => {
    if (!extractNote) return;
    let cancelled = false;
    setProposalsFlag('loading');
    aiFeatures.get().then(value => { if (!cancelled) setProposalsFlag(value.knowledgeProposals ? 'on' : 'off'); })
      .catch(() => { if (!cancelled) setProposalsFlag('unknown'); });
    return () => { cancelled = true; };
  }, [extractNote?.id, spaceId]);
  useEffect(() => {
    if (!extractNote || !policiesReady || !spaceId || proposalsFlag === 'loading') return;
    const key = `${spaceId}:${extractNote.id}`;
    if (extractApplied.current === key) return;
    extractApplied.current = key;
    const title = (extractNote.title || '未命名笔记').replace(/\s+/g, ' ').slice(0, 60);
    setDraft(current => current.trim() ? current : `请根据我在笔记《${title}》（noteId: ${extractNote.id}）里标记的重点，提炼知识点。`);
    pendingSend.current = null;
    if (proposalsFlag !== 'on') return;
    const covers = (policy: AccessPolicy) => {
      // 先排除“不允许读取本篇”的策略（排除项优先于任何范围，服务端读取时同样拒绝），再判断范围。
      if (policy.excludedNoteIds?.includes(extractNote.id) || policy.read === false || !policy.recipients.includes('deepseek')) return false;
      if (policy.scope.kind === 'library') return true;
      if (policy.scope.kind === 'fixed') return policy.scope.noteIds.includes(extractNote.id);
      const seen = new Set<string>();
      for (let id = extractNote.folderId; id && !seen.has(id); id = folders.find(folder => folder.id === id)?.parentId ?? null) {
        if (id === policy.scope.folderId) return true;
        seen.add(id);
      }
      return false;
    };
    const covering = activePolicies.find(covers);
    if (covering) { scopeRevision.current++; setScopeChoice(covering.policyId); setNotice(`已选用现有读取授权：${scopeName(covering)}。确认请求后发送。`); }
    else { setGrantKind('fixed'); setGrantNoteId(extractNote.id); setGrantFolderId(folders[0]?.id ?? ''); setGrantOpen(true); }
  }, [extractNote?.id, policiesReady, spaceId, proposalsFlag]);

  async function refreshConversation(id: string, initializeScope = false) {
    if (selection.current !== id) return;
    const sequence = ++refreshSequence.current;
    const capturedSpace = space.current;
    const capturedScopeRevision = scopeRevision.current;
    const isCurrent = () => refreshSequence.current === sequence && selection.current === id && space.current === capturedSpace;
    try {
      const snapshot = await readConversationSnapshot(id, isCurrent);
      if (!snapshot || !isCurrent()) return;
      setMessages(snapshot.messages);
      const first = snapshot.messages.find(message => message.role === 'user');
      if (first) setTitles(previous => ({ ...previous, [id]: first.content }));
      if (snapshot.turn) {
        const turn = snapshot.turn;
        setTurns(previous => ({ ...previous, [turn.turnId]: turn }));
      }
      if (initializeScope && scopeRevision.current === capturedScopeRevision) {
        setScopeChoice(snapshot.turn?.requestedPolicyId ?? 'plain');
      }
    } catch (cause) { if (isCurrent()) throw cause; }
  }

  useEffect(() => {
    refreshSequence.current++;
    scopeRevision.current++; setScopeChoice('plain');
    setMessages([]); setTurns({}); setError(null); setRetryConfirmOpen(false);
    if (!selectedId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    void refreshConversation(selectedId, true).catch(cause => {
      if (!cancelled) setError(errorText(cause, '无法恢复会话。'));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; refreshSequence.current++; };
  }, [selectedId, spaceId]);

  useEffect(() => {
    if (!selectedId || !isActive(latestTurn)) return;
    let polling = false;
    const timer = window.setInterval(() => {
      if (polling) return;
      polling = true;
      void refreshConversation(selectedId).catch(cause => setError(errorText(cause, '会话状态暂时无法更新，请稍后重试。')))
        .finally(() => { polling = false; });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [selectedId, latestTurn?.turnId, latestTurn?.status]);

  useEffect(() => {
    if (!selectedId) return;
    const reconnect = () => { void refreshConversation(selectedId)
      .then(() => setError(null)).catch(cause => setError(errorText(cause, '无法恢复会话。'))); };
    window.addEventListener('online', reconnect);
    return () => window.removeEventListener('online', reconnect);
  }, [selectedId]);

  async function reloadPage() {
    if (!spaceId) return;
    setError(null);
    const [history, access, model] = await Promise.allSettled([
      conversationApi.list(spaceId), conversationApi.policies(spaceId), assistantApi.status()
    ]);
    if (space.current !== spaceId) return;
    if (history.status === 'fulfilled') setConversations(history.value);
    if (access.status === 'fulfilled') setPolicies(access.value);
    if (model.status === 'fulfilled') setStatus(model.value);
    if (selectedId) await refreshConversation(selectedId).catch(cause => setError(errorText(cause, '无法恢复会话。')));
    if (history.status === 'rejected' || access.status === 'rejected' || model.status === 'rejected') {
      setError('部分助手状态仍不可用，请稍后重试。');
    }
  }

  function chooseConversation(id: string) {
    pendingSend.current = null; setDraft(''); setError(null); setNotice(null);
    setMobileMenuOpen(false);
    navigate(`/assistant?conversationId=${encodeURIComponent(id)}`);
  }

  function switchSpace(id: string) {
    if (!id || id === spaceId) return;
    pendingSend.current = null;
    setInboxOpen(false); setFocusedActionId(null); setMobileMenuOpen(false);
    void selectKnowledgeSpace(id).then(() => navigate('/assistant?new=1'))
      .catch(cause => setError(errorText(cause, '无法切换知识空间。')));
  }

  function openInbox(actionId: string | null = null) {
    inboxOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setFocusedActionId(actionId);
    setInboxOpen(true);
  }

  async function ensureAttachmentConversation() {
    if (selectedId) return selectedId;
    if (!spaceId) throw new Error('请先选择知识空间。');
    if (pending) throw new Error('正在处理消息，请稍后添加附件。');
    const capturedSpace = spaceId;
    const capturedSelection = selection.current;
    setPending(true);
    try {
      const created = await conversationApi.create(spaceId, crypto.randomUUID());
      if (space.current !== capturedSpace || selection.current !== capturedSelection) throw new Error('对话已变化，请重新添加附件。');
      setConversations(previous => [created, ...previous.filter(item => item.conversationId !== created.conversationId)]);
      navigate(`/assistant?conversationId=${encodeURIComponent(created.conversationId)}`);
      return created.conversationId;
    } finally { setPending(false); }
  }

  async function send() {
    if (!spaceId || !draft.trim() || pending || blocked(latestTurn) || reviewingOtherDraft || selected?.readOnly || !status?.generationAvailable) return;
    const content = draft.trim();
    const requestedPolicyId = chosenPolicy?.policyId ?? null;
    if (scopeChoice !== 'plain' && !chosenPolicy) { setError('读取授权已过期或撤销，请重新选择范围。'); return; }
    const intent = pendingSend.current?.content === content && pendingSend.current.requestedPolicyId === requestedPolicyId
      && pendingSend.current.conversationId === (selectedId ?? pendingSend.current.conversationId)
      ? pendingSend.current : { conversationId: selectedId ?? crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(), content, requestedPolicyId };
    pendingSend.current = intent;
    refreshSequence.current++;
    setPending(true); setError(null); setNotice(null);
    try {
      if (!selectedId) {
        const created = await conversationApi.create(spaceId, intent.conversationId);
        if (space.current !== spaceId) return;
        setConversations(previous => [created, ...previous.filter(item => item.conversationId !== created.conversationId)]);
      }
      const turn = await conversationApi.send(intent.conversationId, {
        content: intent.content, idempotencyKey: intent.idempotencyKey, requestedPolicyId: intent.requestedPolicyId
      });
      if (space.current !== spaceId) return;
      pendingSend.current = null; setDraft('');
      setTurns(previous => ({ ...previous, [turn.turnId]: turn }));
      if (selection.current === intent.conversationId) await refreshConversation(intent.conversationId);
      else navigate(`/assistant?conversationId=${encodeURIComponent(intent.conversationId)}`);
    } catch (cause) { if (space.current === spaceId) setError(`${errorText(cause, '发送失败。')} 可使用同一请求重试。`); }
    finally { setPending(false); }
  }

  // 费用提醒横幅里暂停/恢复/放行后，助手状态要立刻刷新，不能停在“暂停”的旧状态。
  useEffect(() => {
    let active = true;
    const refreshStatus = () => { void assistantApi.status().then(next => { if (active) setStatus(next); }).catch(() => undefined); };
    window.addEventListener(ASSISTANT_STATUS_CHANGED_EVENT, refreshStatus);
    return () => { active = false; window.removeEventListener(ASSISTANT_STATUS_CHANGED_EVENT, refreshStatus); };
  }, []);

  async function allowBudget(rule: 'daily' | 'monthly') {
    try { await assistantApi.allowRule(rule); setNotice(`${rule === 'daily' ? '今日' : '本月'}已放行，可重试本轮；周期结束后自动恢复拦截。`); setStatus(await assistantApi.status()); }
    catch (cause) { setError(errorText(cause, '放行失败。')); }
  }

  async function actOnTurn(action: 'cancel' | 'retry' | 'resume', confirmed = false) {
    if (!selectedId || !latestTurn || pending) return;
    if (action === 'retry' && deliveryUncertain && !confirmed) { setRetryConfirmOpen(true); return; }
    setRetryConfirmOpen(false);
    refreshSequence.current++;
    setPending(true); setError(null);
    try {
      const result = action === 'cancel' ? await conversationApi.cancel(selectedId, latestTurn.turnId)
        : action === 'resume' ? await conversationApi.resume(selectedId, latestTurn.turnId) : await conversationApi.retry(selectedId, latestTurn.turnId);
      if (selection.current !== selectedId) return;
      setTurns(previous => ({ ...previous, [result.turnId]: result }));
      await refreshConversation(selectedId);
      setNotice(action === 'cancel' ? '已请求停止。' : action === 'resume' ? '已请求从检查点继续，不自动重发未知模型请求。' : '已请求重试，状态会自动更新。');
    } catch (cause) { setError(errorText(cause, '操作失败。')); }
    finally { setPending(false); }
  }

  async function createPolicy() {
    if (!spaceId || pending) return;
    const scope: AccessPolicy['scope'] | null = grantKind === 'library' ? { kind: 'library' }
      : grantKind === 'folder' && grantFolderId ? { kind: 'folder', folderId: grantFolderId }
        : grantKind === 'fixed' && grantNoteId ? { kind: 'fixed', noteIds: [grantNoteId] } : null;
    if (!scope) { setError('请选择有效的目录或笔记。'); return; }
    const capturedScopeRevision = scopeRevision.current;
    setPending(true); setError(null);
    try {
      const policy = await conversationApi.createPolicy({ spaceId, scope,
        expiresAt: new Date(Date.now() + Number(grantDays) * 86400_000).toISOString() });
      if (space.current !== spaceId) return;
      setPolicies(previous => [policy, ...previous]);
      if (scopeRevision.current === capturedScopeRevision) { scopeRevision.current++; setScopeChoice(policy.policyId); }
      setGrantOpen(false); setNotice(`已授权${scopeName(policy)}，有效期至 ${formatTime(policy.expiresAt)}。`);
    } catch (cause) { setError(errorText(cause, '无法创建读取授权。')); }
    finally { setPending(false); }
  }

  async function revokePolicy(policy: AccessPolicy) {
    if (pending) return;
    const capturedSpace = space.current;
    const capturedScopeRevision = scopeRevision.current;
    setPending(true); setError(null);
    try {
      const revoked = await conversationApi.revokePolicy(policy);
      if (space.current !== capturedSpace) return;
      setPolicies(previous => previous.map(item => item.policyId === revoked.policyId ? revoked : item));
      if (scopeRevision.current === capturedScopeRevision) { scopeRevision.current++; setScopeChoice('plain'); }
      setNotice('读取授权已撤销。');
    } catch (cause) { setError(errorText(cause, '撤销授权失败。')); }
    finally { setPending(false); }
  }

  async function showTrace(turnId: string) {
    if (!selectedId || turns[turnId]) return;
    try {
      const detail = await conversationApi.turn(selectedId, turnId);
      if (selection.current === selectedId) setTurns(previous => ({ ...previous, [turnId]: detail }));
    } catch (cause) { setError(errorText(cause, '无法读取检索记录。')); }
  }

  return <WorkspacePanel as="main" className={styles.assistantPanel} aria-labelledby="assistant-title">
    <WorkspacePanelHeader className={styles.assistantHeader} title="AI 助手" code={inboxOpen ? 'INBOX' : 'CHAT'} titleId="assistant-title" icon={<SparkIcon size={14} />}
      breadcrumb={<PathTrail path={[{ id: 'assistant', label: 'AI 助手' }, { id: 'assistant-area', label: inboxOpen ? '成果收件箱' : '对话' },
        ...(inboxOpen ? [] : [{ id: 'assistant-conversation', label: conversationTitle, current: true }])]} variant="top" />}
      breadcrumbTitle={inboxOpen ? 'AI 助手 / 成果收件箱' : `AI 助手 / 对话 / ${conversationTitle}`}
      actionsLabel="助手操作" actions={<>
        <PopoverTrigger isOpen={statusOpen} onOpenChange={setStatusOpen}>
          <Button size="workspace" variant="ghost" className={styles.modelState}>
            <span className={styles.stateDot} data-state={status ? status.generationAvailable ? 'ready' : 'blocked' : 'loading'} aria-hidden="true" />
            {status ? status.executionLocation === 'local' ? '本机执行' : '服务器执行' : '正在读取模型状态'}
          </Button>
          <Popover placement="bottom end">
            <PopoverDialog aria-label="助手执行状态" className={styles.statusDetails}>
              <span>{status ? `执行位置：${status.executionLocation === 'local' ? '本机' : '服务器'}` : '正在读取模型状态'}</span>
              <span>{status?.modelId ? `${status.simulation ? '离线模拟' : 'DeepSeek'} · ${status.modelId}` : status ? '模型未配置' : ''}</span>
              {status?.simulation ? <span>离线模拟响应，未调用真实供应商。</span> : null}
              {status?.budget ? <span>{status.budget.availableMicrounits === null ? `今日已花费 ${(status.budget.spentMicrounits / 1_000_000).toFixed(2)} 元（未设每日上限）` : `今日可用 ${(status.budget.availableMicrounits / 1_000_000).toFixed(2)} 元`}</span> : null}
              {status?.priceNotice ? <span>{status.priceNotice}</span> : null}
              {status && !status.generationAvailable ? <span>{status.unavailableReason ?? '当前无法生成回答。'}</span> : null}
              {status && !status.configured ? <Button variant="ghost" size="compact" onPress={() => navigate('/settings')}>打开模型设置</Button> : null}
              {!status?.generationAvailable ? <Button variant="ghost" size="compact" onPress={() => void reloadPage()}>重试读取状态</Button> : null}
            </PopoverDialog>
          </Popover>
        </PopoverTrigger>
        <Button size="workspace" variant="primary" onPress={() => {
          pendingSend.current = null; setDraft(''); setInboxOpen(false); navigate('/assistant?new=1');
        }}><PlusIcon size={17} />新对话</Button>
        <MenuTrigger>
          <IconButton size={30} aria-label="更多操作"><MoreHorizontalIcon size={16} /></IconButton>
          <MenuPopover><Menu ariaLabel="更多操作" onAction={key => {
            if (key === 'records') setManagementOpen(open => !open);
            else if (key === 'settings') navigate('/settings');
            else navigate('/assistant?view=legacy');
          }}>
            <MenuItem id="records">执行记录</MenuItem>
            <MenuItem id="settings">模型设置</MenuItem>
            <MenuItem id="legacy">旧版任务</MenuItem>
          </Menu></MenuPopover>
        </MenuTrigger>
      </>} />
    <WorkspacePanelBody className={`${styles.body} ${inboxOpen ? styles.withInbox : ''}`} aria-label="AI 助手工作区">
      <aside className={styles.history} aria-label="会话历史">
        <SegmentedControl className={styles.areaTabs} aria-label="助手导航">
          <SegmentedButton aria-pressed={!inboxOpen} onPress={() => setInboxOpen(false)}>对话</SegmentedButton>
          <SegmentedButton ref={inboxTrigger} aria-label="AI 成果收件箱" aria-pressed={inboxOpen} count={pendingArtifacts || undefined} onPress={() => openInbox()}>成果</SegmentedButton>
        </SegmentedControl>
        <div className={styles.mobileMenu}>
          <PopoverTrigger isOpen={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <Button variant="ghost" size="compact">菜单</Button>
            <Popover placement="bottom end" className={styles.mobileMenuPopover}>
              <PopoverDialog aria-label="最近对话" className={styles.mobileMenuBody}>
                <div className={styles.mobileMenuHeader}><strong>最近对话</strong><Button variant="ghost" size="compact" onPress={() => setMobileMenuOpen(false)}>关闭菜单</Button></div>
                {conversations.map(item => <Button variant="ghost" key={item.conversationId} onPress={() => chooseConversation(item.conversationId)}>
                  {titles[item.conversationId] ?? `会话 · ${formatTime(item.createdAt)}`}</Button>)}
                <Select label="知识空间" selectedKey={spaceId} onSelectionChange={key => switchSpace(String(key))}
                  options={(serverData.spaces ?? []).map(item => ({ id: item.id, label: item.name ?? '未命名空间' }))} />
              </PopoverDialog>
            </Popover>
          </PopoverTrigger>
        </div>
        <div className={styles.spaceSwitch}><Select label="知识空间" presentation="toolbar" selectedKey={spaceId} onSelectionChange={key => switchSpace(String(key))}
          options={(serverData.spaces ?? []).map(item => ({ id: item.id, label: item.name ?? '未命名空间' }))} /></div>
        <div className={styles.historyList}>{conversations.length ? historyGroups.map(group => <section key={group.label} className={styles.historyGroup}>
          <h2>{group.label}</h2>
          {group.items.map(item => <PressableButton key={item.conversationId} type="button"
            className={styles.historyItem} aria-current={item.conversationId === selectedId && !inboxOpen ? 'true' : undefined}
            onPress={() => { setInboxOpen(false); chooseConversation(item.conversationId); }}>
            <span>{titles[item.conversationId] ?? `会话 · ${formatTime(item.createdAt)}`}</span>
            {item.readOnly ? <small>只读</small> : <time dateTime={item.createdAt}>{group.label === '今天' ? formatClock(item.createdAt) : formatDay(item.createdAt)}</time>}
          </PressableButton>)}
        </section>) : <p className={styles.muted}>还没有会话。</p>}</div>
      </aside>
      <div className={styles.content}>
        {status && !status.generationAvailable ? <p className={styles.statusWarning} role="status">{status.unavailableReason ?? '当前无法生成回答。'}</p> : null}
        {spaceId && (recordMessage || managementOpen) ? <NoteActions key={`${spaceId}:${recordMessage?.messageId ?? 'management'}`} spaceId={spaceId} refreshKey={messages.at(-1)?.messageId} conversationId={selectedId ?? undefined} message={recordMessage ?? undefined} onCloseSource={() => { setRecordMessage(null); setManagementOpen(false); }} onOpenNote={onOpenNote} /> : null}
        <div className={styles.messages} aria-live="polite">
          {!selected ? <div className={styles.welcome}>
            <span className={styles.welcomeMark}><BookIcon size={48} /><SparkIcon size={22} /></span>
            <h2>和你的笔记聊聊</h2>
            <p>{activePolicies.length ? '助手可以检索你已授权的笔记，回答附带来源，整理结果先放进成果等你确认。'
              : '现在是普通聊天，不会读取任何笔记。授权后，助手可以检索、引用并整理你的笔记。'}</p>
            <div className={styles.starters}>
              <Button className={styles.starter} onPress={() => { setDraft('请基于我的笔记回答：'); pendingSend.current = null; }}>
                <SearchIcon size={18} /><strong>基于笔记提问</strong><span>回答附带来源，可以逐条核对。</span></Button>
              <Button className={styles.starter} onPress={() => { setDraft('帮我把下面的内容整理成一篇笔记：'); pendingSend.current = null; }}>
                <EditIcon size={18} /><strong>整理成笔记</strong><span>生成草稿放进成果，确认后才写入。</span></Button>
              <Button className={styles.starter} onPress={() => {
                setGrantKind('library'); setGrantNoteId(initialNoteId ?? notes[0]?.id ?? '');
                setGrantFolderId(folders[0]?.id ?? ''); setGrantOpen(true);
              }}><BookIcon size={18} /><strong>先授权读取范围</strong><span>选择整个知识空间、一个目录或一篇笔记。</span></Button>
            </div>
          </div> : null}
          {selected?.readOnly ? <p className={styles.readOnly}>此会话属于历史资料集，只能回看。请新建对话继续提问。</p> : null}
          {loading ? <p className={styles.muted}>正在恢复消息…</p> : null}
          {messages.map(message => {
            const turn = turns[message.turnId];
            const citations = message.citations ?? [];
            return <article key={message.messageId} className={`${styles.message} ${message.role === 'user' ? styles.user : styles.assistant}`}>
              {message.role === 'assistant' ? <div className={styles.messageMeta}><BookIcon size={18} /><strong>Knowra</strong><time dateTime={message.createdAt}>{formatClock(message.createdAt)}</time></div> : null}
              <div className={styles.messageText}><ReadableMarkdown text={message.content} /></div>
              {message.role === 'assistant' ? <>
                {citations.length ? <div className={styles.sources} aria-label="回答来源">
                  {citations.map((ref, index) => <Button key={`${ref.noteVersionId}:${ref.start}:${index}`} variant="default" size="compact" className={styles.sourceChip}
                    onPress={() => void openSource(ref, message.messageId)}><b>{index + 1}</b>来源 {index + 1} · {noteName(ref.noteId)}</Button>)}
                </div> : !message.sourceFree ? <p className={styles.muted}>此回答未列出可核对引用。</p> : null}
                <div className={styles.messageActions}>
                  <IconButton size={30} aria-label="复制回答" onPress={() => { void navigator.clipboard?.writeText(message.content).then(() => setNotice('已复制回答。'), () => setNotice('浏览器不允许复制，请手动选择文字。')); }}><CopyIcon size={15} /></IconButton>
                  {!selected?.readOnly ? <Button variant="ghost" size="compact" onPress={() => setRecordMessage(message)}><NoteIcon size={15} />记录为笔记</Button> : null}
                <ConversationTrace turnId={message.turnId} turn={turn} turnStatusLabel={turn ? statusName[turn.status] : undefined}
                  onLoad={showTrace} onReviewCandidates={() => navigate('/knowledge')} />
                </div>
                {artifacts.filter(action => action.requestId === message.turnId).map(action => <PressableButton
                  key={action.actionId} type="button" className={styles.artifactCard} onPress={() => openInbox(action.actionId)}>
                  <NoteIcon size={19} /><span>{action.plan.items.map(item => item.after.title).join('、')}<small>成果草稿 · 点击审阅</small></span>
                  <Badge tone={activeActionStatuses.includes(action.status) ? 'warning' : 'neutral'}>{activeActionStatuses.includes(action.status) ? '待审阅' : '已处理'}</Badge>
                </PressableButton>)}
              </> : null}
              {sourceView?.messageId === message.messageId ? <section className={styles.sourceDetail} aria-label="引用原文定位">
                <h3>{noteName(sourceView.ref.noteId)} · 历史版本</h3>
                <p>{sourceView.text.slice(Math.max(0, sourceView.ref.start - 80), sourceView.ref.start)}
                  <mark>{sourceView.text.slice(sourceView.ref.start, sourceView.ref.end)}</mark>
                  {sourceView.text.slice(sourceView.ref.end, sourceView.ref.end + 80)}</p>
                {notes.some(note => note.id === sourceView.ref.noteId) ? <Button variant="default" size="compact"
                  onPress={() => onOpenNote(sourceView.ref.noteId)}>打开当前笔记</Button> : null}
                <Button variant="ghost" size="compact" onPress={closeSource}>关闭原文</Button>
              </section> : null}
            </article>;
          })}
          {latestTurn && latestTurn.status !== 'succeeded' ? <div className={styles.turnState} role="status">
            <strong>{statusName[latestTurn.status]}</strong>
            <span>{latestTurn.status === 'running' ? phaseName[latestTurn.phase] : latestTurn.errorCode ?? ''}</span>
            {isActive(latestTurn) ? <Button variant="ghost" size="compact" isDisabled={pending}
              onPress={() => void actOnTurn('cancel')}>停止生成</Button> : null}
            {budgetBlock(latestTurn.errorCode) ? <>
              <span>费用上限已拦截本轮，可调整后继续：</span>
              <Button variant="default" size="compact" onPress={() => navigate('/settings')}>提高上限</Button>
              {budgetBlock(latestTurn.errorCode) !== 'turn' ? <Button variant="default" size="compact" isDisabled={pending}
                onPress={() => void allowBudget(budgetBlock(latestTurn.errorCode) as 'daily' | 'monthly')}>{budgetBlock(latestTurn.errorCode) === 'daily' ? '今日放行' : '本月放行'}</Button> : null}
            </> : null}
            {['failed', 'interrupted', 'staged'].includes(latestTurn.status) ? <>
              <Button variant="default" size="compact" isDisabled={pending || !status?.generationAvailable || selected?.readOnly || deliveryUncertain}
                onPress={() => void actOnTurn('resume')}>从检查点继续</Button>
              <Button variant="default" size="compact" isDisabled={pending || !status?.generationAvailable || selected?.readOnly}
                onPress={() => void actOnTurn('retry')}>重试本轮</Button>
              {deliveryUncertain ? <p>此前模型请求的发送结果未知，继续不会自动重发。重新调用可能产生重复费用。</p> : null}
            </> : null}
          </div> : null}
        </div>
        {error ? <div className={styles.error} role="alert">{error} <Button variant="ghost" size="compact"
          onPress={() => void reloadPage()}>重新加载助手</Button></div> : null}
        {notice ? <p className={styles.muted} role="status">{notice}</p> : null}
        {reviewingOtherDraft ? <p className={styles.reviewWarning} role="status">当前审阅成果不能作为此轮聊天的修改目标；右侧选稿不会改变实际目标。关闭审阅后可继续普通对话。</p> : null}
        <div className={styles.composer} aria-label="提问区">
          <div className={styles.composerInner}>
            {selected?.readOnly ? <div className={styles.readOnlyComposer}>
              <span>这是历史会话，只能回看。</span>
              <Button variant="primary" size="compact" onPress={() => navigate('/assistant?new=1')}>新对话</Button>
            </div> : <>
              {initialNoteId && notes.some(note => note.id === initialNoteId) ? <p className={styles.composerHint}>来自笔记「{noteName(initialNoteId)}」；授权后才能读取。</p> : null}
              {extractNote && (proposalsFlag === 'off' || proposalsFlag === 'unknown') ? <p className={styles.composerHint} role="status">
                {proposalsFlag === 'off' ? '该功能未开启，可在设置中开启。' : '无法确认“AI 提炼知识点”是否已开启，可在设置中查看。'}
                <Button variant="ghost" size="compact" onPress={() => navigate('/settings')}>前往设置</Button></p> : null}
              <div className={styles.composerCard} data-conversation-composer="true">
          <TextAreaField label="消息" presentation="composer" value={draft}
                  onChange={value => { setDraft(value); pendingSend.current = null; }}
                  placeholder={selected ? '继续追问，或说说接下来想做什么…' : '给 Knowra 发消息…'} rows={2} />
                <div className={styles.composerToolbar}>
                  <MenuTrigger>
                    <Button className={styles.scopeChip} size="compact" emphasis={chosenPolicy ? 'soft' : 'normal'} aria-label={`资料范围：${chosenPolicy ? scopeName(chosenPolicy) : '普通聊天'}`}>
                      <BookIcon size={14} />{chosenPolicy ? `可读取：${scopeName(chosenPolicy)} · 至 ${formatDay(chosenPolicy.expiresAt)}` : '普通聊天 · 不读取笔记'}<ChevronDownIcon size={12} />
                    </Button>
                    <MenuPopover><Menu ariaLabel="读取范围" onAction={key => {
                      if (key === 'grant') {
                        setGrantKind('library'); setGrantNoteId(initialNoteId ?? notes[0]?.id ?? '');
                        setGrantFolderId(folders[0]?.id ?? ''); setGrantOpen(true);
                      } else if (key === 'revoke') { if (chosenPolicy) void revokePolicy(chosenPolicy); }
                      else { scopeRevision.current++; setScopeChoice(String(key)); pendingSend.current = null; }
                    }}>
                      <MenuItem id="plain" icon={scopeMark(scopeChoice === 'plain')}>普通聊天 · 不读取笔记</MenuItem>
                      {activePolicies.map(policy => <MenuItem id={policy.policyId} key={policy.policyId} icon={scopeMark(scopeChoice === policy.policyId)}>{`${scopeName(policy)} · 至 ${formatTime(policy.expiresAt)}`}</MenuItem>)}
                      <MenuSeparator />
                      <MenuItem id="grant">设置读取范围</MenuItem>
                      <MenuItem id="revoke" isDisabled={!chosenPolicy || pending} isDanger>撤销此授权</MenuItem>
                    </Menu></MenuPopover>
                  </MenuTrigger>
                  <ConversationAttachmentPicker key={spaceId ?? 'no-space'} isDisabled={!spaceId} conversationId={selectedId} ensureConversation={ensureAttachmentConversation} />
                  <span className={styles.composerSpacer} />
                  {draft.length > 3000 ? <span className={styles.charCount} data-over={draft.length > 3800 || undefined}>{draft.length} / 3800</span> : null}
                  <IconButton size={30} tone="primary" aria-label={pending ? '处理中…' : pendingSend.current ? '重试发送' : '发送消息'}
                    isDisabled={!draft.trim() || draft.length > 3800 || pending || loading || reviewingOtherDraft || !status?.generationAvailable
                    || blocked(latestTurn) || scopeChoice !== 'plain' && !chosenPolicy}
                    onPress={() => void send()}><span className={styles.sendIcon}><ArrowRightIcon size={16} /></span></IconButton>
                </div>
              </div>
              <p className={styles.composerHint}>{chosenPolicy ? '仅相关且获授权的笔记片段可能发送给 DeepSeek。' : '附件仅存于当前对话，尚不能用于内容问答；需授权后才能读取笔记。'}</p>
              {draft.length > 3800 ? <p className={styles.composerError} role="alert">问题超过 3800 字符。</p> : null}
            </>}
          </div>
        </div>
      </div>
      {spaceId ? <AIInbox key={spaceId} spaceId={spaceId} isOpen={inboxOpen} focusActionId={focusedActionId} selectedMismatch={reviewingOtherDraft}
        onSelectedActionChange={setReviewedAction} onRowsChange={setArtifacts} onOpenChange={next => {
        setInboxOpen(next); if (!next && inboxOpen) { const opener = inboxOpener.current ?? inboxTrigger.current;
          window.requestAnimationFrame(() => opener?.focus({ preventScroll: true })); setFocusedActionId(null); }
      }} refreshKey={`${messages.at(-1)?.messageId ?? ''}:${latestTurn?.status ?? ''}`} onOpenNote={onOpenNote} /> : null}
  </WorkspacePanelBody>
    <Dialog title="确认重新调用模型" isOpen={retryConfirmOpen} onOpenChange={setRetryConfirmOpen} size="sm">
      <DialogBody><p>此前请求可能已发送，结果与费用尚未核清。重试会重新调用模型，可能产生重复费用；已发送的内容无法收回。</p></DialogBody>
      <DialogFooter><Button variant="ghost" onPress={() => setRetryConfirmOpen(false)}>暂不重试</Button>
        <Button variant="primary" isDisabled={pending} onPress={() => void actOnTurn('retry', true)}>确认重试本轮</Button></DialogFooter>
    </Dialog>
    <Dialog title="授权助手读取资料" description={status?.simulation
      ? '离线模拟仅在当前运行端处理授权片段，不向供应商发送。可随时撤销，过期后自动失效。'
      : '助手只在本次对话选择此范围时检索资料。相关片段可能发送给 DeepSeek；附件不会发送。可随时撤销，过期后自动失效。'}
      isOpen={grantOpen} onOpenChange={setGrantOpen} isPending={pending} size="md">
      <DialogBody>
        <div className={styles.grantFields}>
          <Select label="授权范围" selectedKey={grantKind} onSelectionChange={key => setGrantKind(String(key) as typeof grantKind)}
            options={[{ id: 'library', label: '当前知识空间' }, { id: 'folder', label: '一个目录' }, { id: 'fixed', label: '一篇笔记' }]} />
          {grantKind === 'folder' ? <Select label="目录" selectedKey={grantFolderId || null} onSelectionChange={key => setGrantFolderId(String(key))}
            options={folders.map(folder => ({ id: folder.id, label: folder.name }))} /> : null}
          {grantKind === 'fixed' ? <Select label="笔记" selectedKey={grantNoteId || null} onSelectionChange={key => setGrantNoteId(String(key))}
            options={notes.map(note => ({ id: note.id, label: note.title || '无标题笔记' }))} /> : null}
          <Select label="有效期" selectedKey={grantDays} onSelectionChange={key => setGrantDays(String(key))}
            options={[{ id: '1', label: '1 天' }, { id: '7', label: '7 天' }, { id: '30', label: '30 天' }]} />
          <p className={styles.muted}>普通笔记可供 AI 读取，不代表公开共享；私密笔记始终排除。授权不自动发送整篇资料。助手每次检索和外发前都会核对范围、版本和有效期。</p>
        </div>
      </DialogBody>
      <DialogFooter><Button variant="ghost" onPress={() => setGrantOpen(false)}>取消</Button>
        <Button variant="primary" isDisabled={pending || grantKind === 'folder' && !grantFolderId || grantKind === 'fixed' && !grantNoteId}
          onPress={() => void createPolicy()}>确认授权</Button></DialogFooter>
    </Dialog>
  </WorkspacePanel>;
}

/** 费用上限造成的失败码对应的规则；其余错误返回 null。 */
function budgetBlock(code: string | null): 'daily' | 'monthly' | 'turn' | null {
  return code === 'AI_DAILY_BUDGET_EXCEEDED' ? 'daily' : code === 'AI_MONTHLY_BUDGET_EXCEEDED' ? 'monthly' : code === 'AI_JOB_BUDGET_EXCEEDED' ? 'turn' : null;
}

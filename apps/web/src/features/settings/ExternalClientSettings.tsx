import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiRequestError } from '@study-accelerator/web-core';
import { Button } from '../../components/ui/button/Button';
import { Badge } from '../../components/ui/status/Badge';
import { Checkbox } from '../../components/ui/input/Checkbox';
import { Select, TextField } from '../../components/ui/input';
import { Dialog, DialogBody, DialogFooter } from '../../components/ui/overlay/Dialog';
import { useAppStore } from '../../store/AppStoreProvider';
import { TaskWorkspaceGrantFields } from './TaskWorkspaceGrantFields';
import type { TaskWorkspaceGrant } from './externalClients';
import { KnowledgeReadConsent } from './KnowledgeReadConsent';
import { externalClients, isDesktopRuntime, type CreatePairingInput, type McpAuditEntry, type McpOverview, type McpPairing, type PairingScope } from './externalClients';
import styles from './SettingsView.module.css';
import { McpClientChoice } from './McpClientChoice';
import { McpConnectionDialog } from './McpConnectionDialog';
import { clientNames, inferMcpClient, type McpClient } from './mcpConnection';

const time = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });
const statusBadge = { active: { tone: 'success', text: '有效' }, expired: { tone: 'neutral', text: '已过期' }, revoked: { tone: 'neutral', text: '已撤销' } } as const;
const message = (failure: unknown, fallback: string) => failure instanceof Error && failure.message ? failure.message : fallback;

/** 外部 AI 客户端（MCP）只在 Mac 应用的本地运行端提供；网页版不显示。 */
export function ExternalClientSettings() { return isDesktopRuntime() ? <ExternalClientPanel /> : null; }

function ExternalClientPanel() {
  const serverData = useAppStore(state => state.serverData);
  const spaceId = serverData.currentSpaceId;
  const loadWorkspace = useAppStore(state => state.loadWorkspace);
  // 直接打开或刷新设置页时工作区尚未加载（只有笔记、助手等页面会加载），这里补加载以获得当前知识空间与目录。
  useEffect(() => { if (!spaceId) void loadWorkspace().catch(() => undefined); }, [spaceId, loadWorkspace]);
  const notes = useMemo(() => serverData.notes.filter(note => !note.deleted && (!note.spaceId || note.spaceId === spaceId)), [serverData.notes, spaceId]);
  // 目录是嵌套树：用扁平索引取全部层级，并以“父 / 子”路径区分同名目录。
  const folders = useMemo(() => {
    const byId = serverData.foldersById;
    const live = Object.values(byId).filter(folder => !folder.deletedAt && (!folder.spaceId || folder.spaceId === spaceId));
    const pathOf = (id: string) => {
      const names: string[] = []; const seen = new Set<string>();
      for (let cursor: string | null | undefined = id; cursor && byId[cursor] && !seen.has(cursor); cursor = byId[cursor].parentId) { seen.add(cursor); names.unshift(byId[cursor].name); }
      return names.join(' / ');
    };
    return live.map(folder => ({ id: folder.id, name: pathOf(folder.id) })).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }, [serverData.foldersById, spaceId]);
  const [taskPairing, setTaskPairing] = useState<McpPairing | null>(null);
  const [taskWorkspaces, setTaskWorkspaces] = useState<{ id: string; name: string }[]>([]);
  const [taskEpoch, setTaskEpoch] = useState<string | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskGrants, setTaskGrants] = useState<TaskWorkspaceGrant[]>([]);
  const [taskConfirmed, setTaskConfirmed] = useState(false);
  const [taskImagesConfirmed, setTaskImagesConfirmed] = useState(false);
  const [overview, setOverview] = useState<McpOverview | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [connection, setConnection] = useState<McpPairing | null>(null);
  const [revoking, setRevoking] = useState<McpPairing | null>(null);
  const [knowledgePairing, setKnowledgePairing] = useState<McpPairing | null>(null);
  const [knowledgeUnderstood, setKnowledgeUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [audit, setAudit] = useState<{ pairingId: string; items: McpAuditEntry[] } | null>(null);
  const [chooseOpen, setChooseOpen] = useState(false);
  const [client, setClient] = useState<McpClient>('claude');
  // 创建表单
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<'none' | 'library' | 'folder' | 'fixed'>('none');
  const [folderId, setFolderId] = useState('');
  const [noteId, setNoteId] = useState('');
  const [days, setDays] = useState('7');
  const [understood, setUnderstood] = useState(false);
  const [allowPropose, setAllowPropose] = useState(false);
  const [proposeUnderstood, setProposeUnderstood] = useState(false);
  const [allowKnowledgeRead, setAllowKnowledgeRead] = useState(false);
  const [createKnowledgeUnderstood, setCreateKnowledgeUnderstood] = useState(false);

  const refresh = useCallback(async () => {
    try { setOverview(await externalClients.overview()); setError(''); setUnsupported(false); }
    catch (failure) {
      if (failure instanceof ApiRequestError && (failure.status === 404 || failure.status === 409)) setUnsupported(true);
      else setError('无法读取外部客户端配对，请重试。');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { setLoading(true); void refresh(); }, [refresh, attempt]);

  useEffect(() => {
    if (!overview?.taskWorkspacesAvailable || !createOpen && !taskPairing) return;
    let active = true; setTaskLoading(true); setTaskWorkspaces([]); setTaskEpoch(null);
    void externalClients.taskWorkspaces().then(result => { if (active) { setTaskWorkspaces(result.items); setTaskEpoch(result.datasetEpoch); } })
      .catch(() => { if (active) setError('无法读取任务工作区，请关闭后重试。'); }).finally(() => { if (active) setTaskLoading(false); });
    return () => { active = false; };
  }, [overview?.taskWorkspacesAvailable, createOpen, taskPairing]);

  const scopeText = (pairing: McpPairing) => pairing.scope.kind === 'none' ? '未授权普通笔记或知识' : pairing.scope.kind === 'library' ? '整个知识空间'
    : pairing.scope.kind === 'folder' ? `目录：${folders.find(folder => folder.id === (pairing.scope as { folderId: string }).folderId)?.name ?? '已移除目录'}`
      : `${(pairing.scope as { noteIds: string[] }).noteIds.length} 篇笔记`;

  const scope: PairingScope | null = kind === 'none' ? { kind: 'none' } : kind === 'library' ? { kind: 'library' } : kind === 'folder' && folderId ? { kind: 'folder', folderId }
    : kind === 'fixed' && noteId ? { kind: 'fixed', noteIds: [noteId] } : null;
  const taskValid = !taskLoading && taskGrants.every(grant => taskWorkspaces.some(workspace => workspace.id === grant.workspaceId))
    && (!taskGrants.length || taskConfirmed && taskEpoch !== null) && (!taskGrants.some(grant => grant.includeImages) || taskImagesConfirmed);
  const taskInput = taskGrants.length ? { taskWorkspaceGrants: taskGrants, taskWorkspaceConfirmed: true as const,
    ...(taskGrants.some(grant => grant.includeImages) ? { taskImagesConfirmed: true as const } : {}) } : {};
  const canCreate = Boolean(scope && label.trim() && taskValid && !busy && (kind === 'none' ? taskGrants.length > 0
    : spaceId && understood && (!allowPropose || proposeUnderstood) && (!allowKnowledgeRead || createKnowledgeUnderstood)));


  function openCreate(selected: McpClient) {
    setClient(selected); setChooseOpen(false);
    setLabel(clientNames[selected]); setKind('none'); setTaskGrants([]); setTaskConfirmed(false); setTaskImagesConfirmed(false); setFolderId(folders[0]?.id ?? ''); setNoteId(notes[0]?.id ?? ''); setDays('7'); setUnderstood(false); setAllowPropose(false); setProposeUnderstood(false);
    setAllowKnowledgeRead(false); setCreateKnowledgeUnderstood(false);
    setError(''); setNotice(''); setCreateOpen(true);
  }
  async function create() {
    if (!canCreate || !scope || kind !== 'none' && !spaceId) return;
    setBusy(true); setError('');
    try {
      const input: CreatePairingInput = { label: label.trim(), ...(kind === 'none' ? {} : { spaceId: spaceId! }), scope, expiresInDays: Number(days), egressConfirmed: true, ...taskInput,
        ...(kind !== 'none' && allowPropose ? { allowPropose: true as const, proposeConfirmed: true as const } : {}),
        ...(kind !== 'none' && allowKnowledgeRead ? { allowKnowledgeRead: true as const, knowledgeReadConfirmed: true as const } : {}) };
      const pairing = await (taskGrants.length ? externalClients.create(input, taskEpoch!) : externalClients.create(input));
      setCreateOpen(false); setNotice(`已创建配对“${pairing.label}”。请按下面的连接方式配置客户端。`);
      await refresh(); setConnection(pairing);
    } catch (failure) { setError(message(failure, '创建配对失败。')); }
    finally { setBusy(false); }
  }
  async function revoke(pairing: McpPairing) {
    setBusy(true); setError('');
    try {
      await externalClients.revoke(pairing.pairingId);
      setRevoking(null); setConnection(current => current?.pairingId === pairing.pairingId ? null : current);
      setNotice(`已撤销“${pairing.label}”，该客户端立即无法读取。`); await refresh();
    } catch (failure) { setError(message(failure, '撤销失败，请重试。')); }
    finally { setBusy(false); }
  }
  async function setKnowledgeRead(pairing: McpPairing, enabled: boolean) {
    if (busy || enabled && !knowledgeUnderstood) return;
    setBusy(true); setError('');
    try {
      const updated = await externalClients.setKnowledgeRead(pairing.pairingId, enabled
        ? { allowKnowledgeRead: true, knowledgeReadConfirmed: true } : { allowKnowledgeRead: false });
      setOverview(current => current ? { ...current, items: current.items.map(item => item.pairingId === updated.pairingId ? updated : item) } : current);
      setConnection(current => current?.pairingId === updated.pairingId ? updated : current);
      setKnowledgePairing(null); setKnowledgeUnderstood(false);
      setNotice(`已${updated.allowKnowledgeRead ? '开启' : '关闭'}“${updated.label}”的知识点读取。`);
    } catch (failure) { setError(message(failure, '保存知识读取设置失败，请重试。')); }
    finally { setBusy(false); }
  }
  async function saveTaskGrants() {
    if (!taskPairing || !taskValid || busy) return;
    setBusy(true); setError('');
    try {
      const updated = await externalClients.setTaskWorkspaceGrants(taskPairing.pairingId, taskGrants.length ? { ...taskInput, taskWorkspaceGrants: taskGrants } : { taskWorkspaceGrants: [] }, taskGrants.length ? taskEpoch! : undefined);
      setOverview(current => current ? { ...current, items: current.items.map(item => item.pairingId === updated.pairingId ? updated : item) } : current);
      setConnection(current => current?.pairingId === updated.pairingId ? updated : current);
      setTaskPairing(null); setNotice('已更新任务工作区权限，进行中的调用会重新检查授权。');
    } catch (failure) { setError(message(failure, '任务工作区授权保存失败。')); }
    finally { setBusy(false); }
  }
  async function toggleAudit(pairing: McpPairing) {
    if (audit?.pairingId === pairing.pairingId) { setAudit(null); return; }
    try { setAudit({ pairingId: pairing.pairingId, items: await externalClients.audit(pairing.pairingId) }); }
    catch { setError('无法读取最近调用记录。'); }
  }


  if (unsupported) return null;
  const blocked = overview && !overview.aiEnabled ? 'AI 功能未开启，无法创建外部客户端配对。'
    : overview && !overview.egressEnabled ? '外发已被紧急停止，外部客户端暂时无法读取笔记。' : '';
  const adapter = overview?.adapter ?? null;

  return <section className={styles.group} aria-labelledby="settings-external-clients-heading">
    <h3 id="settings-external-clients-heading">外部 AI 客户端</h3>
    <div className={styles.settingList}>
      <div className={styles.settingRow}>
        <div className={styles.settingCopy}>
          <h4>外部 AI 客户端（MCP）</h4>
          <p>让 Claude Code 或 Codex 通过本机连接读取你选定范围内的笔记。知识点读取由每个客户端的独立总开关控制，默认关闭。每个客户端单独配对，可随时撤销，到期自动失效。</p>
          {blocked ? <p role="status">{blocked}</p> : null}
          {!blocked && overview && !spaceId ? <p role="status">普通笔记范围尚在加载；可先设置任务工作区。</p> : null}
        </div>
        <div className={styles.settingControl}>
          <Button variant="primary" size="compact" isDisabled={loading || !overview || Boolean(blocked)} onPress={() => setChooseOpen(true)}>添加外部客户端</Button>
        </div>
      </div>
      {overview?.items.length ? <ul className={styles.clientList} aria-label="已配对的外部客户端">
        {overview.items.map(pairing => <li key={pairing.pairingId} className={styles.clientRow}>
          <div className={styles.settingCopy}>
            <div className={styles.clientTitle}><h4>{pairing.label}</h4><Badge tone={statusBadge[pairing.status].tone}>{statusBadge[pairing.status].text}</Badge>
              {pairing.allowPropose ? <Badge tone="accent">可提交候选</Badge> : null}
              {pairing.taskWorkspaceGrants?.length ? <Badge tone="accent">{pairing.taskWorkspaceGrants.length} 个任务工作区</Badge> : null}
              {pairing.allowKnowledgeRead ? <Badge tone="accent">可读取知识点</Badge> : null}</div>
            <p className={styles.clientMeta}>{scopeText(pairing)} · 到期 {time(pairing.expiresAt)} · {pairing.lastUsedAt ? `最近使用 ${time(pairing.lastUsedAt)}` : '从未使用'} · 共调用 {pairing.calls} 次</p>
            {pairing.taskWorkspaceReauthorizationRequired ? <p role="status">资料库已恢复或切换，任务工作区权限需重新选择并确认。</p> : null}
            {pairing.status === 'active' && pairing.allowPropose && overview && !overview.proposalsEnabled ? <p className={styles.clientMeta} role="status">“AI 提炼知识点”未开启，暂不能提交</p> : null}
            {audit?.pairingId === pairing.pairingId ? (audit.items.length
              ? <ul className={styles.clientAudit} aria-label={`${pairing.label}最近调用`}>{audit.items.map((entry, index) => <li key={`${entry.at}-${index}`}>
                {time(entry.at)} · {entry.event === 'call' ? entry.tool : entry.event === 'created' ? '创建配对' : entry.event === 'revoked' ? '撤销配对'
                  : entry.event === 'knowledge_read_enabled' ? '开启知识点读取' : entry.event === 'knowledge_read_disabled' ? '关闭知识点读取' : '被拒绝'} · {entry.status === 'ok' ? `成功，返回 ${entry.fragments ?? 0} 个片段` : entry.code ?? entry.status ?? ''}</li>)}</ul>
              : <p className={styles.clientMeta}>还没有调用记录。</p>) : null}
          </div>
          <div className={styles.clientActions}>
            {pairing.status === 'active' && pairing.scope.kind !== 'none' ? <Button size="compact" isDisabled={busy} aria-label={`${pairing.allowKnowledgeRead ? '关闭' : '开启'}知识点读取：${pairing.label}`}
              onPress={() => {
                if (pairing.allowKnowledgeRead) void setKnowledgeRead(pairing, false);
                else { setKnowledgeUnderstood(false); setError(''); setNotice(''); setKnowledgePairing(pairing); }
              }}>{pairing.allowKnowledgeRead ? '关闭知识点读取' : '开启知识点读取'}</Button> : null}
            {pairing.status === 'active' && overview.taskWorkspacesAvailable ? <Button size="compact" isDisabled={busy} aria-label={`任务工作区权限：${pairing.label}`} onPress={() => { setTaskPairing(pairing); setTaskGrants(pairing.taskWorkspaceReauthorizationRequired ? [] : pairing.taskWorkspaceGrants ?? []); setTaskConfirmed(false); setTaskImagesConfirmed(false); setError(''); }}>任务工作区权限</Button> : null}
            {pairing.status === 'active' ? <Button size="compact" aria-label={`查看连接方式：${pairing.label}`} onPress={() => { setClient(inferMcpClient(pairing.label)); setConnection(pairing); }}>查看连接方式</Button> : null}
            <Button size="compact" variant="ghost" aria-label={`最近调用：${pairing.label}`} onPress={() => void toggleAudit(pairing)}>最近调用</Button>
            {pairing.status === 'active' ? <Button size="compact" variant="ghost" aria-label={`撤销：${pairing.label}`} onPress={() => setRevoking(pairing)}>撤销</Button> : null}
          </div>
        </li>)}
      </ul> : null}
    </div>
    {loading ? <p className={styles.modelHint}>读取中</p> : null}
    {!loading && overview && !overview.items.length ? <p className={styles.modelHint}>还没有配对的外部客户端。</p> : null}
    {notice ? <p role="status" className={styles.modelNotice}>{notice}</p> : null}
    {error && !createOpen && !revoking && !knowledgePairing && !taskPairing ? <p role="alert" className={styles.modelError}>{error}</p> : null}
    {!loading && !overview && !unsupported ? <Button size="compact" onPress={() => setAttempt(value => value + 1)}>重试读取</Button> : null}

    {/* 步骤共用同一焦点范围，取消/Escape 始终归还最初的添加入口。 */}
    <Dialog title={chooseOpen ? '选择客户端' : '选择外部 AI 客户端权限'} isOpen={chooseOpen || createOpen}
      onOpenChange={open => { if (!open && !busy) { setChooseOpen(false); setCreateOpen(false); } }} isPending={busy} size="md">
      {chooseOpen ? <McpClientChoice onChoose={openCreate} onClose={() => setChooseOpen(false)} /> : <>
      <DialogBody>
        <div className={styles.dialogFields}>
          <p className={styles.dialogNote}>2 确认权限 · {clientNames[client]}。创建后再配置和检查连接。</p>
          <TextField label="客户端名称" value={label} onChange={setLabel} isRequired maxLength={60} placeholder="例如：Claude Code" />
          <Select label="授权范围" selectedKey={kind} onSelectionChange={key => { setKind(String(key) as typeof kind); setUnderstood(false); setAllowKnowledgeRead(false); setAllowPropose(false); }}
            options={[{ id: 'none', label: '不授权普通笔记（仅任务工作区）' }, { id: 'library', label: '当前知识空间' }, { id: 'folder', label: '一个目录' }, { id: 'fixed', label: '一篇笔记' }]} />
          {kind === 'folder' ? <Select label="目录" selectedKey={folderId || null} onSelectionChange={key => setFolderId(String(key))}
            options={folders.map(folder => ({ id: folder.id, label: folder.name }))} /> : null}
          {kind === 'fixed' ? <Select label="笔记" selectedKey={noteId || null} onSelectionChange={key => setNoteId(String(key))}
            options={notes.map(note => ({ id: note.id, label: note.title || '无标题笔记' }))} /> : null}
          <Select label="有效期" selectedKey={days} onSelectionChange={key => setDays(String(key))}
            options={[{ id: '1', label: '1 天' }, { id: '7', label: '7 天（默认）' }, { id: '30', label: '30 天' }, { id: '90', label: '90 天' }]} />
          {kind !== 'none' ? <>
          <p className={styles.dialogNote}>被读取的笔记片段会发送给该客户端所属的厂商（如 Anthropic、OpenAI），费用由客户端自己的订阅承担，不计入知境预算。笔记读取仅限你选定的范围，不含标记为私密的笔记。下方“允许读取知识点”单独授权当前资料库中的全部知识点；提交候选也需单独开启。可随时关闭或撤销，到期自动失效。</p>
          <Checkbox isSelected={understood} onChange={setUnderstood}>我了解所选范围内的笔记片段会发给该客户端所属的厂商</Checkbox>
          <Checkbox isSelected={allowKnowledgeRead} onChange={value => { setAllowKnowledgeRead(value); if (!value) setCreateKnowledgeUnderstood(false); }}>允许读取知识点（全部开放，默认关闭）</Checkbox>
          {allowKnowledgeRead ? <KnowledgeReadConsent label={label} isSelected={createKnowledgeUnderstood} onChange={setCreateKnowledgeUnderstood} isDisabled={busy} /> : null}
          <Checkbox isSelected={allowPropose} onChange={value => { setAllowPropose(value); if (!value) setProposeUnderstood(false); }}>同时允许该客户端提交待审核的知识候选（默认不允许）</Checkbox>
          {allowPropose ? <>
            <p className={styles.dialogNote}>开启后，该客户端可以把它从你笔记里提炼的内容作为待审核的知识候选提交到知境。候选不会自动入库，也不会被确认，需要你在知识库逐条审核；它只能引用自己已读取过的原文，每天最多提交 200 条。仍需要“AI 提炼知识点”开关处于开启状态。</p>
            <Checkbox isSelected={proposeUnderstood} onChange={setProposeUnderstood}>我了解提交的候选由客户端的模型生成，可能有误，我会在知识库逐条审核</Checkbox>
          </> : null}
          </> : <p className={styles.dialogNote}>此配对不提供普通笔记或知识读取。请选择下面至少一个任务工作区。</p>}
          {overview?.taskWorkspacesAvailable ? <TaskWorkspaceGrantFields workspaces={taskWorkspaces} grants={taskGrants} onChange={setTaskGrants}
            confirmed={taskConfirmed} onConfirmed={setTaskConfirmed} imagesConfirmed={taskImagesConfirmed} onImagesConfirmed={setTaskImagesConfirmed} disabled={busy || taskLoading} /> : null}
          {taskLoading ? <p role="status">正在读取任务工作区…</p> : null}
          {error ? <p role="alert" className={styles.modelError}>{error}</p> : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" isDisabled={busy} onPress={() => { setCreateOpen(false); setChooseOpen(true); }}>上一步</Button>
        <Button variant="ghost" isDisabled={busy} onPress={() => setCreateOpen(false)}>取消</Button>
        <Button variant="primary" isPending={busy} isDisabled={!canCreate} onPress={() => void create()}>创建配对</Button>
      </DialogFooter>
      </>}
    </Dialog>

    <Dialog title={taskPairing ? `任务工作区权限：${taskPairing.label}` : '任务工作区权限'} isOpen={Boolean(taskPairing)}
      onOpenChange={open => { if (!open && !busy) { setTaskPairing(null); setError(''); } }} isPending={busy} size="md">
      <DialogBody>
        <TaskWorkspaceGrantFields workspaces={taskWorkspaces} grants={taskGrants} onChange={setTaskGrants} confirmed={taskConfirmed} onConfirmed={setTaskConfirmed}
          imagesConfirmed={taskImagesConfirmed} onImagesConfirmed={setTaskImagesConfirmed} disabled={busy || taskLoading} />
        {taskLoading ? <p role="status">正在读取任务工作区…</p> : null}
        {error ? <p role="alert" className={styles.modelError}>{error}</p> : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" isDisabled={busy} onPress={() => setTaskPairing(null)}>取消</Button>
        <Button variant="ghost" isDisabled={busy || taskLoading} onPress={() => { setTaskGrants([]); setTaskConfirmed(false); setTaskImagesConfirmed(false); }}>清空任务权限选择</Button>
        <Button variant="primary" isDisabled={!taskValid || busy} isPending={busy} onPress={() => void saveTaskGrants()}>保存任务权限</Button>
      </DialogFooter>
    </Dialog>

    <Dialog title={knowledgePairing ? `允许“${knowledgePairing.label}”读取全部知识点？` : '允许读取知识点'} isOpen={Boolean(knowledgePairing)}
      onOpenChange={open => { if (!open && !busy) { setKnowledgePairing(null); setKnowledgeUnderstood(false); setError(''); } }} isPending={busy} size="md">
      <DialogBody>
        <KnowledgeReadConsent label={knowledgePairing?.label ?? ''} isSelected={knowledgeUnderstood} onChange={setKnowledgeUnderstood} isDisabled={busy} />
        {error ? <p role="alert" className={styles.modelError}>{error}</p> : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" isDisabled={busy} onPress={() => { setKnowledgePairing(null); setKnowledgeUnderstood(false); setError(''); }}>取消</Button>
        <Button variant="primary" isPending={busy} isDisabled={!knowledgeUnderstood || busy} onPress={() => knowledgePairing && void setKnowledgeRead(knowledgePairing, true)}>确认开启</Button>
      </DialogFooter>
    </Dialog>

    {connection ? <McpConnectionDialog key={connection.pairingId} pairing={connection} adapter={adapter} initialClient={client} onOverview={setOverview} onClose={() => setConnection(null)} /> : null}

    <Dialog title={revoking ? `撤销“${revoking.label}”？` : '撤销配对'} isOpen={Boolean(revoking)} onOpenChange={open => { if (!open && !busy) setRevoking(null); }} isPending={busy} size="sm">
      <DialogBody>
        <p>撤销后该客户端立即无法读取笔记，配对文件会被删除。需要时可以重新创建配对。</p>
        {error ? <p role="alert" className={styles.modelError}>{error}</p> : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" isDisabled={busy} onPress={() => setRevoking(null)}>取消</Button>
        <Button variant="primary" isPending={busy} onPress={() => revoking && void revoke(revoking)}>确认撤销</Button>
      </DialogFooter>
    </Dialog>
  </section>;
}

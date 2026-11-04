import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/button/Button';
import { PressableButton } from '../../components/ui/button/PressableButton';
import { Select, TextAreaField } from '../../components/ui/input';
import { WorkspacePanel, WorkspacePanelBody, WorkspacePanelHeader } from '../../components/workspace/WorkspacePanel';
import { useNavigate } from '../../app/router';
import { useAppStore } from '../../store/AppStoreProvider';
import { SparkIcon } from '../../components/icons/knowra';
import { PathTrail } from '../../shell/PathTrail';
import { assistantApi, type AssistantJob, type AssistantPreview, type AssistantStatus, type AssistantSource } from './assistantApi';
import styles from './AssistantView.module.css';

const active = (status: AssistantJob['status']) => ['pending', 'running', 'retrying', 'cancelling'].includes(status);
const statusLabel: Record<AssistantJob['status'], string> = {
  pending: '等待执行', running: '生成中', retrying: '重试中', cancelling: '取消中',
  cancelled: '已取消', succeeded: '已完成', failed: '失败'
};
const eventLabel: Record<string, string> = {
  taskCreated: '任务已创建', attemptPrepared: '调用参数已核对', budgetReserved: '预算已预留',
  providerRequestStarted: '开始请求模型', providerResponseReceived: '已收到模型响应',
  resultValidated: '回答与引用已校验', budgetSettled: '费用已结算',
  taskSucceeded: '任务已完成', attemptFailed: '本次调用失败', taskFailed: '任务失败'
};
const stageLabel: Record<string, string> = {
  budgetReservation: '预算预留', preSendValidation: '发送前校验', providerResponse: '模型请求或响应',
  resultValidation: '回答与引用校验', budgetSettlement: '费用结算', resultPersistence: '结果保存'
};
const failureLabel: Record<string, string> = {
  AI_JSON_INVALID: '模型没有返回有效的 JSON', AI_ANSWER_INVALID: '回答不符合约定格式',
  AI_OUTPUT_TRUNCATED: '模型回答达到输出上限',
  AI_CITATION_INVALID: '引用与发送的原文不一致', AI_CITATION_MISSING: '回答缺少可核对引用',
  AI_RESPONSE_INVALID: '模型响应结构无效', AI_RESPONSE_TOO_LARGE: '模型响应超过大小上限',
  AI_CREDENTIAL_UNAVAILABLE: '模型凭据不可用', AI_MODEL_CHANGED: '模型配置已变更',
  AI_PROVIDER_REQUEST_INVALID: '模型服务拒绝了请求参数', AI_KEY_REJECTED: '模型服务拒绝了密钥',
  AI_PROVIDER_BALANCE: '模型账户余额不足', AI_RATE_LIMITED: '模型服务请求过于频繁',
  AI_PROVIDER_UNAVAILABLE: '模型服务暂时不可用', AI_USAGE_LIMIT: '模型用量超过预留范围',
  AI_GRANT_STALE: '授权或来源范围已失效', AI_SOURCE_STALE: '来源版本已发生变化',
  AI_TASK_FAILED: '调用未完成，具体原因未能识别'
};
const yuan = (microunits: number) => (microunits / 1_000_000).toFixed(2);

function diagnosticText(payload: Record<string, string | number | boolean>) {
  const parts = [
    payload.stage ? `阶段：${stageLabel[String(payload.stage)] ?? payload.stage}` : null,
    payload.code ? `错误码：${payload.code}` : null,
    payload.httpStatus ? `HTTP ${payload.httpStatus}` : null,
    payload.finishReason ? `结束原因：${payload.finishReason}` : null,
    payload.inputTokens !== undefined ? `输入 ${payload.inputTokens} token` : null,
    payload.outputTokens !== undefined ? `输出 ${payload.outputTokens} token` : null,
    payload.maxOutputTokens !== undefined ? `输出上限 ${payload.maxOutputTokens} token` : null,
    payload.sourceCount !== undefined ? `${payload.sourceCount} 个来源片段` : null,
    payload.inputUpperBoundBytes !== undefined ? `请求体上界 ${payload.inputUpperBoundBytes} 字节` : null,
    payload.reservedMicrounits !== undefined ? `预留 ${yuan(Number(payload.reservedMicrounits))} 元` : null,
    payload.actualMicrounits !== undefined ? `结算 ${yuan(Number(payload.actualMicrounits))} 元` : null,
    payload.budgetDisposition === 'unknown' ? '费用待核对，预留额暂占预算' : null,
    payload.budgetDisposition === 'settled' ? '已按模型用量结算' : null,
    payload.budgetDisposition === 'released' ? '未发送，预留额已释放' : null,
    payload.responseId ? `供应商请求 ID：${payload.responseId}` : null
  ];
  return parts.filter(Boolean).join(' · ');
}

export function LegacyAssistantView({ pathname, onOpenNote, readOnly = false }: { pathname: string; onOpenNote(noteId: string): void; readOnly?: boolean }) {
  const navigate = useNavigate();
  const serverData = useAppStore(state => state.serverData);
  const getNoteVersion = useAppStore(state => state.getNoteVersion);
  const spaceId = serverData.currentSpaceId;
  const currentSpaceRef = useRef(spaceId);
  currentSpaceRef.current = spaceId;
  const initialNoteId = useMemo(() => new URLSearchParams(pathname.split('?')[1] ?? '').get('noteId'), [pathname]);
  const notes = useMemo(() => serverData.notes.filter(note => !note.deleted && (!note.spaceId || note.spaceId === spaceId)), [serverData.notes, spaceId]);
  const folders = useMemo(() => serverData.folderTree.filter(folder => !folder.deletedAt && (!folder.spaceId || folder.spaceId === spaceId)), [serverData.folderTree, spaceId]);
  const [scopeKind, setScopeKind] = useState<'note' | 'folder'>('note');
  const [noteId, setNoteId] = useState<string | null>(initialNoteId);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [preview, setPreview] = useState<AssistantPreview | null>(null);
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [jobs, setJobs] = useState<AssistantJob[]>([]);
  const [selectedJob, setSelectedJob] = useState<AssistantJob | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sourceView, setSourceView] = useState<{ source: AssistantSource; content: string } | null>(null);
  const listJobs = readOnly ? assistantApi.listLegacy : assistantApi.list;
  const getJob = readOnly ? assistantApi.getLegacy : assistantApi.get;

  useEffect(() => { if (initialNoteId && notes.some(note => note.id === initialNoteId)) setNoteId(initialNoteId); }, [initialNoteId, notes]);
  useEffect(() => { if (!notes.some(note => note.id === noteId)) setNoteId(notes[0]?.id ?? null); }, [noteId, notes]);
  useEffect(() => { if (!folders.some(folder => folder.id === folderId)) setFolderId(folders[0]?.id ?? null); }, [folderId, folders]);
  useEffect(() => {
    if (!spaceId) return;
    let cancelled = false;
    setJobs([]); setSelectedJob(null); setPreview(null); setRequestKey(null); setSourceView(null);
    void assistantApi.status().then(nextStatus => { if (!cancelled) setStatus(nextStatus); })
      .catch(cause => { if (!cancelled) setError(cause.message); });
    void listJobs(spaceId).then(nextJobs => {
      if (cancelled) return;
      setJobs(nextJobs);
      if (nextJobs[0]) void getJob(nextJobs[0].jobId).then(job => { if (!cancelled) setSelectedJob(job); })
        .catch(cause => { if (!cancelled) setError(cause.message); });
    }).catch(cause => { if (!cancelled) setError(cause.message); });
    return () => { cancelled = true; };
  }, [spaceId, readOnly]);

  useEffect(() => {
    if (!selectedJob || !active(selectedJob.status)) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void getJob(selectedJob.jobId).then(job => {
        if (cancelled) return;
        setSelectedJob(job);
        setJobs(previous => previous.map(item => item.jobId === job.jobId ? job : item));
        if (!active(job.status)) void assistantApi.status().then(nextStatus => {
          if (!cancelled) setStatus(nextStatus);
        }).catch(() => undefined);
      }).catch(cause => { if (!cancelled) setError(cause.message); });
    }, 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [selectedJob?.jobId, selectedJob?.status]);

  const noteName = (id: string) => notes.find(note => note.id === id)?.title || '已移除的笔记';
  const resetPreview = () => { setPreview(null); setRequestKey(null); setNotice(null); };

  async function reloadStatus() {
    setError(null);
    try { setStatus(await assistantApi.status()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法读取模型状态。'); }
  }

  async function prepare() {
    if (!spaceId || !question.trim()) return;
    const scope = scopeKind === 'note' && noteId ? { kind: 'note' as const, noteId }
      : scopeKind === 'folder' && folderId ? { kind: 'folder' as const, folderId } : null;
    if (!scope) { setError('请选择笔记或目录。'); return; }
    setPending(true); setError(null); setNotice(null); setPreview(null);
    try {
      const prepared = await assistantApi.preview({ spaceId, scope, question: question.trim() });
      if (spaceId === currentSpaceRef.current) { setPreview(prepared); setRequestKey(crypto.randomUUID()); }
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法预览发送范围。'); }
    finally { setPending(false); }
  }

  async function start() {
    if (!preview || !requestKey) return;
    setPending(true); setError(null);
    try {
      const job = await assistantApi.start(preview, requestKey);
      if (job.spaceId === currentSpaceRef.current) {
        setSelectedJob(job);
        setJobs(previous => [job, ...previous.filter(item => item.jobId !== job.jobId)]);
        setPreview(null);
        setRequestKey(null);
        setNotice('任务已创建，状态会自动更新。');
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法创建任务。'); }
    finally { setPending(false); }
  }

  async function cancel() {
    if (!selectedJob) return;
    setPending(true); setError(null);
    try {
      const job = await assistantApi.cancel(selectedJob.jobId);
      setSelectedJob(job);
      setJobs(previous => previous.map(item => item.jobId === job.jobId ? job : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法取消任务。'); }
    finally { setPending(false); }
  }

  async function openSource(source: AssistantSource) {
    setError(null);
    const requestedSpace = selectedJob?.spaceId;
    try {
      const version = await getNoteVersion(source.noteId, source.noteVersionId);
      if (version.content.length < source.end || source.contentHash && version.contentHash !== source.contentHash) {
        throw new Error('原文版本与引用范围不一致。');
      }
      if (requestedSpace === currentSpaceRef.current) setSourceView({ source, content: version.content });
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法打开引用原文。'); }
  }

  function sourceButton(source: AssistantSource, label: string) {
    return <Button key={source.sourceId + source.start} variant="ghost" size="compact" onPress={() => void openSource(source)}>
      {label} · {noteName(source.noteId)} · {source.start + 1}–{source.end}
    </Button>;
  }

  return <WorkspacePanel as="main" aria-labelledby="assistant-title">
    <WorkspacePanelHeader title="AI 助手" code="AI" titleId="assistant-title" icon={<SparkIcon size={14} />}
      breadcrumb={<PathTrail path={[{ id: 'assistant', label: 'AI 助手', current: true }]} variant="top" />}
      actionsLabel="执行位置" actions={<span className={styles.location}>{status?.executionLocation === 'local' ? '本机执行' : status?.executionLocation === 'server' ? '服务器执行' : '正在读取状态'}</span>} />
    <WorkspacePanelBody grid className={styles.body} aria-label="AI 助手工作区">
      <aside className={styles.history} aria-label="历史任务">
        <h2>最近任务</h2>
        {jobs.length ? jobs.map(job => <PressableButton key={job.jobId} type="button" className={styles.historyItem}
          aria-current={selectedJob?.jobId === job.jobId ? 'true' : undefined}
          onPress={() => { setError(null); setSourceView(null); void getJob(job.jobId)
            .then(detail => { if (detail.spaceId === currentSpaceRef.current) setSelectedJob(detail); })
            .catch(cause => setError(cause.message)); }}>
          <span>{job.question || '只读问答'}</span><small>{statusLabel[job.status]}</small>
        </PressableButton>) : <p className={styles.empty}>当前知识空间还没有助手任务。</p>}
      </aside>
      <div className={styles.content}>
        <div className={styles.banner} role="status">
          <strong>{!status ? '正在读取模型状态' : status.modelId ? `${status.simulation ? '离线模拟' : 'DeepSeek'} · ${status.modelId}` : '模型未配置'}</strong>
          <span>{readOnly ? '旧版任务只读回看。新提问请返回对话主页面。' : status?.unavailableReason ?? (status ? '当前可在确认来源范围后创建只读问答任务。' : '请稍候…')}</span>
          {readOnly ? <Button variant="ghost" size="compact" onPress={() => navigate('/assistant')}>返回对话</Button> : null}
          {status?.budget ? <span>北京时间 {status.budget.day} · {status.budget.availableMicrounits === null ? '未设每日上限' : `可用 ${yuan(status.budget.availableMicrounits)} 元`}
            {status.budget.heldMicrounits > 0 ? ` · 待核对预留 ${yuan(status.budget.heldMicrounits)} 元` : ''}
            {status.budget.spentMicrounits > 0 ? ` · 已结算 ${yuan(status.budget.spentMicrounits)} 元` : ''}</span> : null}
          {status?.priceNotice ? <span>{status.priceNotice}</span> : null}
          {status && !status.configured ? <Button variant="ghost" size="compact" onPress={() => navigate('/settings')}>打开模型设置</Button> : null}
          {!status && error ? <Button variant="ghost" size="compact" onPress={() => void reloadStatus()}>重试读取状态</Button> : null}
        </div>
        {!readOnly ? <section className={styles.card} aria-label="提出问题">
          <h2>向笔记提问</h2>
          <p className={styles.hint}>{status?.simulation ? '离线模拟响应，未调用真实供应商。' : '仅选中的笔记或目录片段会进入发送预览；确认前不会发送给 DeepSeek。'}</p>
          <div className={styles.scopeRow}>
            <Select label="读取范围" selectedKey={scopeKind} onSelectionChange={key => { setScopeKind(String(key) as 'note' | 'folder'); resetPreview(); }}
              options={[{ id: 'note', label: '一篇笔记' }, { id: 'folder', label: '一个目录' }]} />
            {scopeKind === 'note' ? <Select label="笔记" selectedKey={noteId} onSelectionChange={key => { setNoteId(String(key)); resetPreview(); }}
              options={notes.map(note => ({ id: note.id, label: note.title || '无标题笔记' }))} />
              : <Select label="目录" selectedKey={folderId} onSelectionChange={key => { setFolderId(String(key)); resetPreview(); }}
                options={folders.map(folder => ({ id: folder.id, label: folder.name }))} />}
          </div>
          <TextAreaField label="问题" value={question} onChange={value => { setQuestion(value); resetPreview(); }}
            placeholder="请基于选中的资料回答…" rows={3} />
          <div className={styles.actions}><Button variant="primary" isDisabled={pending || !spaceId || !question.trim()}
            onPress={() => void prepare()}>预览发送范围</Button></div>
        </section> : null}
        {!readOnly && preview ? <section className={styles.card} aria-label="发送预览">
          <h2>发送预览</h2>
          <p className={styles.hint}>接收方：{status?.simulation ? '本端离线模拟' : 'DeepSeek'} · {preview.sources.length} 个片段 · 输入上界约 {preview.estimatedInputTokens} 字节。预览将在 {new Date(preview.expiresAt).toLocaleTimeString('zh-CN')} 失效。</p>
          <div className={styles.sources}>{preview.sources.map(source => <article key={source.sourceId} className={styles.source}>
            <strong>{noteName(source.noteId)} · {source.start + 1}–{source.end}</strong>
            <pre>{source.text}</pre>
          </article>)}</div>
          {preview.omissions.length ? <p className={styles.hint}>未发送：{preview.omissions.length} 个片段。请缩小范围或调整问题后重新预览。</p> : null}
          <div className={styles.actions}><Button variant="primary" isDisabled={pending || !status?.generationAvailable}
            onPress={() => void start()}>确认范围并提问</Button>
            <Button variant="ghost" onPress={resetPreview}>取消预览</Button></div>
          {!status?.generationAvailable ? <p className={styles.hint}>{status?.unavailableReason ?? '当前仅可核对发送范围。'}</p> : null}
        </section> : null}
        {selectedJob ? <section className={styles.card} aria-label="任务详情">
          <div className={styles.jobHeader}><h2>{selectedJob.question || '只读问答'}</h2><span>{statusLabel[selectedJob.status]}</span></div>
          {selectedJob.status === 'succeeded' && selectedJob.result ? <>
            <p className={styles.answer}>{selectedJob.result.answer || '已核对来源，但未找到足够依据。'}</p>
            <h3>来源</h3>
            <div className={styles.citations}>{selectedJob.result.citations.map((citation, index) => sourceButton(citation, `引用 ${index + 1}`))}</div>
          </> : <p className={styles.hint}>{selectedJob.status === 'failed'
            ? (() => { const failure = [...(selectedJob.diagnostics ?? [])].reverse().find(event => event.safePayload.code);
              const code = String(failure?.safePayload.code ?? '');
              const truncated = code === 'AI_ANSWER_INVALID' && selectedJob.diagnostics?.some(event =>
                event.eventKind === 'providerResponseReceived' && event.safePayload.finishReason === 'length');
              return code ? `任务未完成：${truncated ? failureLabel.AI_OUTPUT_TRUNCATED : failureLabel[code] ?? '请查看调用详情'}（${code}）。`
                : '任务未完成。旧任务未记录失败原因；请查看下方调用详情。'; })()
            : `当前阶段：${selectedJob.phase}`}</p>}
          {selectedJob.diagnostics ? <details className={styles.diagnostics}>
            <summary>调用详情 · {selectedJob.diagnostics.length} 条记录</summary>
            {selectedJob.diagnostics.length ? <ol>{selectedJob.diagnostics.map(event => <li key={event.sequence}>
              <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleTimeString('zh-CN')}</time>
              <strong>{eventLabel[event.eventKind] ?? event.eventKind}</strong>
              {diagnosticText(event.safePayload) ? <span>{diagnosticText(event.safePayload)}</span> : null}
            </li>)}</ol> : <p>这条旧任务没有诊断记录，无法追溯具体失败原因。</p>}
            <p>仅记录状态、费用及错误码；不记录 API Key、笔记正文或模型原始回答。</p>
          </details> : null}
          {sourceView && selectedJob.result?.citations.some(citation => citation.sourceId === sourceView.source.sourceId) ? <div className={styles.sourceDetail} aria-label="引用原文定位">
            <h3>{noteName(sourceView.source.noteId)} · 历史版本 {sourceView.source.noteVersionId}</h3>
            <p>{sourceView.content.slice(Math.max(0, sourceView.source.start - 80), sourceView.source.start)}
              <mark>{sourceView.content.slice(sourceView.source.start, sourceView.source.end)}</mark>
              {sourceView.content.slice(sourceView.source.end, sourceView.source.end + 80)}</p>
            <Button variant="default" size="compact" onPress={() => onOpenNote(sourceView.source.noteId)}>打开笔记</Button>
            <Button variant="ghost" size="compact" onPress={() => setSourceView(null)}>关闭原文</Button>
          </div> : null}
          {!readOnly && active(selectedJob.status) ? <Button variant="ghost" isDisabled={pending} onPress={() => void cancel()}>取消任务</Button> : null}
        </section> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {notice ? <p className={styles.hint} role="status">{notice}</p> : null}
      </div>
    </WorkspacePanelBody>
  </WorkspacePanel>;
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiRequestError, type ExtractionJobDetail, type ExtractionJobSummary } from '@study-accelerator/web-core';
import { useExtractionEnvironment } from './ExtractionEnvironment';
import { extractionIntentKey, readExtractionIntent, saveExtractionIntent, type ExtractionIntent } from './extractionIntentRecovery';

const activeStatuses = new Set(['pending', 'running', 'retrying', 'cancelling']);
const storageWarning = '浏览器任务恢复记录不可用。本页保留请求标识，请先查询任务状态，避免刷新后重复开始。';
export function useKnowledgeExtractionTasks(spaceId: string, noteId: string, canWrite: boolean) {
  const environment = useExtractionEnvironment();
  const { api, capability } = environment;
  const scope = useMemo(() => ({}), [spaceId, noteId, environment.scopeKey]);
  const recoveryKey = extractionIntentKey(spaceId, noteId);
  const current = useRef(scope); current.current = scope;
  const [stateScope, setStateScope] = useState(scope);
  const [open, setOpenState] = useState(false);
  const visible = useRef(open); visible.current = stateScope === scope && open;
  const [items, setItems] = useState<ExtractionJobSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [job, setJobState] = useState<ExtractionJobDetail | null>(null);
  const selected = useRef<ExtractionJobDetail | null>(null);
  const [intent, setIntentState] = useState<ExtractionIntent | null>(null);
  const intended = useRef<ExtractionIntent | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef<{ kind: 'read' | 'write' } | null>(null);
  const requery = useRef(false);
  const skipOpenRefresh = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [recoveryWarning, setRecoveryWarning] = useState('');
  const sequence = useRef(0);
  const alive = () => current.current === scope && visible.current;
  const setJob = (value: ExtractionJobDetail | null) => { selected.current = value; setJobState(value); };
  const setIntent = (value: ExtractionIntent | null) => {
    intended.current = value; setIntentState(value);
    if (!saveExtractionIntent(recoveryKey, value)) setRecoveryWarning(storageWarning);
  };
  function setOpen(value: boolean) {
    visible.current = value;
    if (!value) {
      sequence.current++; skipOpenRefresh.current = false;
      // Closing abandons a read's UI ownership. An in-flight POST must retain its duplicate guard.
      if (busy.current?.kind === 'read') { busy.current = null; setPending(false); }
    } else if (busy.current) requery.current = true;
    setOpenState(value);
  }
  useEffect(() => {
    current.current = scope; sequence.current++; busy.current = null; requery.current = false;
    setStateScope(scope); setPending(false); setOpen(false); setJob(null);
    const restored = readExtractionIntent(recoveryKey);
    intended.current = restored.intent; setIntentState(restored.intent);
    setItems([]); setNextCursor(null); setHistoryLoaded(false); setError(''); setNotice(''); setRecoveryWarning(restored.failed ? storageWarning : '');
    return () => { if (current.current === scope) current.current = {}; };
  }, [scope, recoveryKey]);

  function begin(kind: 'read' | 'write' = 'read') { const token = { kind }; busy.current = token; setPending(true); setError(''); return token; }
  function finish(token: object) {
    if (current.current !== scope || busy.current !== token) return;
    busy.current = null; setPending(false);
    if (requery.current && alive()) { requery.current = false; void refresh(); }
  }
  function accept(value: ExtractionJobDetail) {
    if (value.spaceId !== spaceId) throw new Error('任务不属于当前空间。');
    setJob(value);
    if (intended.current?.scopeId === value.scopeId) setIntent({ ...intended.current, jobId: value.jobId });
    setItems(rows => rows.some(row => row.jobId === value.jobId)
      ? rows.map(row => row.jobId === value.jobId ? value : row) : [value, ...rows]);
  }
  function expired(cause: unknown) {
    if (!(cause instanceof ApiRequestError) || ![403, 404, 410].includes(cause.status)) return false;
    setIntent(null); setJob(null); setNotice('原任务或范围已不可访问，请重新核对当前范围后明确开始。'); return true;
  }
  async function getDetail(jobId: string, id: number) {
    const value = await api!.getJob(jobId);
    if (alive() && id === sequence.current) accept(value);
  }
  async function refresh(cursor?: string) {
    if (!api || !capability.canReadJobs || busy.current || !alive()) return;
    const id = ++sequence.current, token = begin();
    const task = intended.current;
    let target = selected.current?.jobId ?? null;
    const recovering = !cursor && task?.submitted && !target;
    try {
      // Exact-key lookup recovers a submission; it is never the current-space history page.
      if (recovering) {
        try {
          const recovered = await api.listJobs({ spaceId, idempotencyKey: task.taskKey });
          if (!alive() || id !== sequence.current) return;
          target = recovered.items.find(row => row.scopeId === task.scopeId)?.jobId ?? null;
          if (!target) {
            if (task.jobId) { setIntent(null); setNotice('原任务已不可访问，请重新核对当前范围后明确开始。'); }
            else setNotice('尚未查询到这次提交。请先查询状态；再次提交会沿用同一请求标识。');
          }
        } catch (cause) {
          if (!alive() || id !== sequence.current) return;
          if (!expired(cause)) setError('连接中断，任务状态未知。请查询提交结果。');
        }
      }
      // A history-page failure must not prevent an exact submission from being recovered.
      if (!cursor && target) {
        try { await getDetail(target, id); if (alive() && id === sequence.current) setNotice(''); }
        catch (cause) {
          if (!alive() || id !== sequence.current) return;
          if (!expired(cause)) setError('任务详情暂时无法读取，请刷新任务。');
        }
        if (!alive() || id !== sequence.current) return;
      }
      const page = await api.listJobs({ spaceId, ...(cursor ? { cursor } : {}) });
      if (!alive() || id !== sequence.current) return;
      setItems(rows => cursor ? [...rows, ...page.items.filter(row => !rows.some(old => old.jobId === row.jobId))] : page.items);
      setNextCursor(page.nextCursor); setHistoryLoaded(true);
      if (cursor) return;
      if (!task && !target && page.items[0]) await getDetail(page.items[0].jobId, id);
    } catch (cause) { if (alive() && id === sequence.current && !expired(cause)) setError(recovering && !target
      ? '连接中断，任务状态未知。请查询提交结果。' : '任务状态暂时无法读取，请重试查询。'); }
    finally { finish(token); }
  }
  async function select(jobId: string) {
    if (!api || !capability.canReadJobs || busy.current) return;
    const id = ++sequence.current, token = begin(); setIntent(null); setJob(null); setNotice('');
    try { await getDetail(jobId, id); }
    catch (cause) { if (alive() && id === sequence.current && !expired(cause)) setError('任务详情暂时无法读取，请刷新任务。'); }
    finally { finish(token); }
  }
  async function start(input: { scopeId: string; taskKey: string }) {
    if (!api || !canWrite || !capability.canStart) return;
    if (busy.current) {
      setOpen(true); setNotice('已有任务请求尚未完成，请先查询其结果，再从已保存范围明确开始。'); return;
    }
    skipOpenRefresh.current = !visible.current;
    setOpen(true); const token = begin('write'); setNotice('');
    setIntent({ ...input, submitted: true }); setJob(null);
    const id = ++sequence.current;
    try {
      const value = await api.startJob({ scopeId: input.scopeId, idempotencyKey: input.taskKey });
      if (alive() && id === sequence.current) { accept(value); requery.current = true; }
    } catch (cause) {
      if (!alive() || id !== sequence.current || expired(cause)) return;
      setNotice('提交响应中断，正在查询同一请求的任务；不会自动重复创建。');
      try {
        const page = await api.listJobs({ spaceId, idempotencyKey: input.taskKey });
        const found = page.items.find(row => row.scopeId === input.scopeId);
        if (found) { await getDetail(found.jobId, id); if (alive() && id === sequence.current) { setNotice('已查询到原任务。'); requery.current = true; } }
        else if (alive() && id === sequence.current) setError('尚未确认任务是否创建，请查询提交结果或使用同一请求重试。');
      } catch (queryError) { if (alive() && id === sequence.current && !expired(queryError)) setError('连接中断，任务状态未知。请查询提交结果。'); }
    } finally { finish(token); }
  }
  function prepare(scopeId: string) {
    if (!canWrite || !capability.canStart || busy.current) return;
    if (!(intended.current?.scopeId === scopeId && intended.current.submitted && !selected.current)) {
      setIntent({ scopeId, taskKey: crypto.randomUUID(), submitted: false }); setJob(null);
    }
    setError(''); setNotice('将使用这个已保存的固定范围；不会改用当前草稿。'); setOpen(true);
  }
  async function action(kind: 'cancel' | 'retry') {
    const target = selected.current;
    if (!api || !target || !canWrite || busy.current || !(kind === 'cancel' ? target.actions.canCancel : target.actions.canRetry)) return;
    const id = ++sequence.current, token = begin('write');
    try {
      const value = await (kind === 'cancel' ? api.cancelJob(target.jobId) : api.retryJob(target.jobId));
      if (alive() && id === sequence.current) {
        accept(value); setNotice(kind === 'cancel' && value.status === 'succeeded' ? '候选已保存，无法撤回；请在知识库核对。' : '');
      }
    } catch (cause) {
      if (alive() && id === sequence.current && !expired(cause)) {
        setError('操作结果尚未确认，已重新查询任务状态。');
        try { await getDetail(target.jobId, id); } catch { /* Keep the last DTO, never invent a failed state. */ }
      }
    } finally { finish(token); }
  }
  useEffect(() => {
    if (!open || !api || !capability.canReadJobs) return;
    if (skipOpenRefresh.current) skipOpenRefresh.current = false; else void refresh();
    const timer = window.setInterval(() => {
      if (busy.current || !selected.current || !activeStatuses.has(selected.current.status)) return;
      const id = ++sequence.current, token = begin();
      void getDetail(selected.current.jobId, id).catch(cause => {
        if (alive() && id === sequence.current && !expired(cause)) setError('连接中断，请刷新任务状态。');
      }).finally(() => finish(token));
    }, 1000);
    return () => { window.clearInterval(timer); sequence.current++; };
  }, [open, api, capability.canReadJobs, scope]);
  return { open: stateScope === scope && open, setOpen, items, nextCursor, historyLoaded, job, intent, pending, error, notice, recoveryWarning,
    refresh, select, start, prepare, action, capability, canWrite };
}

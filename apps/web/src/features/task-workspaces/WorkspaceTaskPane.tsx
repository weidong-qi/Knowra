import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentDTO, TaskDetail, TaskEvent, TaskWorkspaceApi } from '@study-accelerator/web-core';
import { Button } from '../../components/ui/button/Button';
import { TaskDetailView } from './TaskDetailView';
import { taskError } from './taskPresentation';
export function WorkspaceTaskPane({ api, workspaceId, taskId, documents, archived, onChanged, onOpenVersion }: {
  api: TaskWorkspaceApi; workspaceId: string; taskId: string; documents: DocumentDTO[]; archived: boolean;
  onChanged(): void; onOpenVersion(documentId: string, versionId: string): void;
}) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = ++generation.current;
    try {
      const [detail, page] = await Promise.all([api.getTask({ workspaceId, taskId }), api.listTaskEvents({ workspaceId, taskId, limit: 50 })]);
      if (ticket !== generation.current) return;
      setTask(detail); setEvents(page.items); setNext(page.nextAfterSequence); setError('');
    } catch (error) { if (ticket === generation.current) setError(taskError(error)); }
  }, [api, workspaceId, taskId]);
  useEffect(() => { alive.current = true; void refresh(); const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 10000); return () => { alive.current = false; ++generation.current; clearInterval(timer); }; }, [refresh]);
  async function changed() { if (!alive.current) return; await refresh(); if (alive.current) onChanged(); }
  return <>
    <Button variant="ghost" onPress={() => void refresh()}>刷新任务</Button>
    {error && <p role="alert">{error}</p>}
    {!task ? <p role="status">正在加载任务…</p> : <TaskDetailView task={task} documents={documents} events={events} canWrite={!archived}
      onReload={() => api.getTask({ workspaceId, taskId })}
      onPublish={async input => { await api.publishTask({ ...input, workspaceId, taskId, operationId: crypto.randomUUID() }); await changed(); }}
      onReview={async input => { await api.reviewSubmission({ ...input, workspaceId, taskId, operationId: crypto.randomUUID() }); await changed(); }}
      onCancel={async () => { await api.cancelTask({ workspaceId, taskId, operationId: crypto.randomUUID(), expectedRevision: task.revision }); await changed(); }}
      onOpenVersion={onOpenVersion} onMoreEvents={next === null ? undefined : () => {
        const ticket = generation.current;
        void api.listTaskEvents({ workspaceId, taskId, afterSequence: next, limit: 50 }).then(page => {
          if (ticket !== generation.current) return;
          setEvents(current => [...current, ...page.items.filter(item => !current.some(existing => existing.sequence === item.sequence))]); setNext(page.nextAfterSequence);
        }).catch(error => { if (ticket === generation.current) setError(taskError(error)); });
      }} />}
  </>;
}

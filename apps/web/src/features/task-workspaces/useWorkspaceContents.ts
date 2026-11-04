import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentDTO, TaskSummary, TaskWorkspaceApi } from '@study-accelerator/web-core';
import { taskError } from './taskPresentation';
export function useWorkspaceContents(api: TaskWorkspaceApi, workspaceId: string) {
  const [documents, setDocuments] = useState<DocumentDTO[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = ++generation.current;
    try {
      const docs: DocumentDTO[] = [], cards: TaskSummary[] = [];
      let cursor: string | undefined;
      do { const page = await api.listDocuments({ workspaceId, limit: 50, cursor }); docs.push(...page.items); cursor = page.nextCursor ?? undefined; } while (cursor && ticket === generation.current);
      cursor = undefined;
      do { const page = await api.listTasks({ workspaceId, limit: 50, cursor }); cards.push(...page.items); cursor = page.nextCursor ?? undefined; } while (cursor && ticket === generation.current);
      if (ticket !== generation.current) return;
      setDocuments(docs); setTasks(cards); setError('');
    } catch (error) { if (ticket === generation.current) setError(taskError(error)); }
    finally { if (ticket === generation.current) setLoading(false); }
  }, [api, workspaceId]);
  useEffect(() => {
    void refresh();
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15000);
    return () => { ++generation.current; clearInterval(interval); };
  }, [refresh]);
  return { documents, tasks, error, loading, refresh };
}

import { useEffect, useRef, useState } from 'react';
import type { TaskWorkspaceApi, Workspace } from '@study-accelerator/web-core';
import { Button } from '../../components/ui/button/Button';
import { useNavigate } from '../../app/router';
import { CreateEntityDialog } from './CreateEntityDialog';
import { useWorkspaceContents } from './useWorkspaceContents';
import { WorkspaceContextPanel } from './WorkspaceContextPanel';
import { TaskBoard } from './TaskBoard';
import { WorkspaceDocumentPane } from './WorkspaceDocumentPane';
import { WorkspaceTaskPane } from './WorkspaceTaskPane';
import styles from './TaskWorkspaces.module.css';
export function WorkspaceContents({ api, workspace, datasetId, datasetEpoch, query }: {
  api: TaskWorkspaceApi; workspace: Workspace; datasetId: string; datasetEpoch: string; query: URLSearchParams;
}) {
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const navigate = useNavigate();
  const { documents, tasks, error, loading, refresh } = useWorkspaceContents(api, workspace.id);
  const [creating, setCreating] = useState<'document' | 'task' | null>(null);
  const documentId = query.get('document'); const versionId = query.get('version') ?? undefined; const taskId = query.get('task');
  const archived = Boolean(workspace.archivedAt);
  const base = `/task-workspaces?workspace=${encodeURIComponent(workspace.id)}`;
  const openDocument = (id: string, version?: string) => navigate(`${base}&document=${encodeURIComponent(id)}${version ? `&version=${encodeURIComponent(version)}` : ''}`);
  return <div className={styles.root}>
    <header className={`${styles.header} ${styles.workspaceHeader}`}><h2>{workspace.name}</h2><span className={styles.spacer} />
      <Button variant="default" onPress={() => navigate(base)}>任务看板</Button>
      <WorkspaceContextPanel label="看板操作" toolbar>{() => <><Button variant="ghost" onPress={() => void refresh()}>刷新看板</Button>
      <Button variant="default" isDisabled={archived} onPress={() => setCreating('document')}>新建文档</Button>
      <Button isDisabled={archived} onPress={() => setCreating('task')}>新建任务</Button></>}</WorkspaceContextPanel>
    </header>
    {archived && <p className={styles.notice}>工作区已归档，不能继续编辑或执行任务。</p>}
    {error && <p role="alert" className={styles.notice}>{error}</p>}
    <div className={styles.layout}>
      <aside className={styles.sidebar} aria-label="协作文档列表"><WorkspaceContextPanel label="协作文档" current={documents.find(document => document.id === documentId)?.title ?? `${documents.length} 篇文档`}>{close => <><h2>协作文档</h2>{documents.map(document => <Button key={document.id} variant="ghost" aria-current={documentId === document.id ? 'true' : undefined} onPress={() => { close(); openDocument(document.id); }}>{document.title}</Button>)}</>}</WorkspaceContextPanel></aside>
      <main className={styles.main}>
        {documentId ? <WorkspaceDocumentPane key={`${documentId}:${versionId ?? 'current'}`} api={api} workspaceId={workspace.id} documentId={documentId} versionId={versionId}
          datasetId={datasetId} datasetEpoch={datasetEpoch} archived={archived} onChanged={() => void refresh()} />
          : taskId ? <WorkspaceTaskPane key={taskId} api={api} workspaceId={workspace.id} taskId={taskId} documents={documents} archived={archived}
            onChanged={() => void refresh()} onOpenVersion={openDocument} />
          : loading ? <p role="status">正在加载看板…</p> : <TaskBoard tasks={tasks} onOpen={id => navigate(`${base}&task=${encodeURIComponent(id)}`)} />}
      </main>
    </div>
    {creating && <CreateEntityDialog title={creating === 'document' ? '新建文档' : '新建任务'} onClose={() => setCreating(null)} onCreate={async (title, operationId) => {
      if (creating === 'document') { const result = await api.createDocument({ workspaceId: workspace.id, operationId, title, markdown: '' }); if (!alive.current) return; await refresh(); if (alive.current) openDocument(result.data.document.id); }
      else { const result = await api.createTask({ workspaceId: workspace.id, operationId, title }); if (!alive.current) return; await refresh(); if (alive.current) navigate(`${base}&task=${encodeURIComponent(result.data.task.id)}`); }
    }} />}
  </div>;
}

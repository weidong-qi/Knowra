import { useEffect, useMemo, useRef, useState } from 'react';
import type { TaskWorkspaceApi, TaskWorkspaceCapabilities, Workspace } from '@study-accelerator/web-core';
import { Button } from '../../components/ui/button/Button';
import { useLocation, useNavigate } from '../../app/router';
import { taskWorkspaceApi, createEpochTaskWorkspaceApi } from './taskWorkspaceClient';
import { CreateEntityDialog } from './CreateEntityDialog';
import { WorkspaceContextPanel } from './WorkspaceContextPanel';
import { WorkspaceContents } from './WorkspaceContents';
import { taskError } from './taskPresentation';
import styles from './TaskWorkspaces.module.css';

export function TaskWorkspacesView({ api = taskWorkspaceApi }: { api?: TaskWorkspaceApi }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const query = new URLSearchParams(pathname.split('?')[1] ?? '');
  const workspaceId = query.get('workspace') ?? '';
  const [capabilities, setCapabilities] = useState<TaskWorkspaceCapabilities | null>(null);
  const boundApi = useMemo(() => api === taskWorkspaceApi ? createEpochTaskWorkspaceApi(capabilities?.datasetEpoch ?? null) : api, [api, capabilities?.datasetEpoch]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const identity = useRef<string | null>(null);
  const alive = useRef(true);
  const generation = useRef(0);
  async function refresh() {
    const ticket = ++generation.current;
    try {
      const capability = await api.getCapabilities();
      if (ticket !== generation.current) return;
      const nextIdentity = JSON.stringify([capability.datasetId, capability.datasetEpoch]);
      if (identity.current !== nextIdentity) { identity.current = nextIdentity; setWorkspaces([]); }
      setCapabilities(capability);
      if (!capability.available) { setWorkspaces([]); return; }
      const items: Workspace[] = []; let cursor: string | undefined;
      do { const page = await api.listWorkspaces({ limit: 50, cursor }); items.push(...page.items); cursor = page.nextCursor ?? undefined; } while (cursor && ticket === generation.current);
      if (ticket !== generation.current) return;
      setWorkspaces(items); setError('');
    } catch (error) { if (ticket === generation.current) setError(taskError(error)); }
  }
  useEffect(() => {
    alive.current = true; void refresh(); const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15000);
    return () => { alive.current = false; ++generation.current; clearInterval(timer); };
  }, [api]);
  const active = workspaces.find(workspace => workspace.id === workspaceId);
  const available = capabilities?.available && capabilities.datasetId && capabilities.datasetEpoch;
  return <section className={styles.root} aria-label="任务工作区">
    <header className={styles.header}><div><h1>任务工作区</h1><p>共同写文档，冻结需求，按版本验收成果。</p></div>
      <span className={styles.spacer} /><WorkspaceContextPanel label="工作区操作" toolbar>{() => <><Button variant="ghost" onPress={() => void refresh()}>刷新工作区</Button>
      <Button isDisabled={!available} onPress={() => setCreating(true)}>创建工作区</Button>
      <Button variant="ghost" onPress={() => navigate('/settings')}>外部 Agent 授权</Button></>}</WorkspaceContextPanel>
    </header>
    {error && <p className={`${styles.notice} ${styles.error}`} role="alert">{error}</p>}
    {!capabilities && !error && <p className={styles.notice} role="status">正在检查任务工作区能力…</p>}
    {capabilities && !available && <p className={styles.notice} role="status">当前宿主尚未提供任务工作区能力。私人笔记仍可正常使用。</p>}
    {available && <div className={styles.layout}>
      <aside className={styles.sidebar} aria-label="工作区列表"><WorkspaceContextPanel label="协作工作区" current={active?.name ?? "选择工作区"}>{close => <><h2>协作工作区</h2>
        {workspaces.map(workspace => <Button key={workspace.id} variant="ghost" aria-current={workspace.id === workspaceId ? 'true' : undefined}
          onPress={() => { close(); navigate(`/task-workspaces?workspace=${encodeURIComponent(workspace.id)}`); }}>{workspace.name}{workspace.archivedAt ? '（已归档）' : ''}</Button>)}
        {!workspaces.length && <p className={styles.meta}>创建一个工作区开始。不会自动导入私人笔记。</p>}
      </>}</WorkspaceContextPanel></aside>
      {active ? <WorkspaceContents key={`${capabilities.datasetId}:${capabilities.datasetEpoch}:${active.id}`} api={boundApi} workspace={active}
        datasetId={capabilities.datasetId!} datasetEpoch={capabilities.datasetEpoch!} query={query} />
        : <main className={styles.main}><p>选择工作区，或创建一个新的协作空间。</p></main>}
    </div>}
    {creating && available && <CreateEntityDialog title="创建工作区" onClose={() => setCreating(false)} onCreate={async (name, operationId) => {
      const result = await boundApi.createWorkspace({ operationId, name });
      if (!alive.current) return; await refresh(); if (alive.current) navigate(`/task-workspaces?workspace=${encodeURIComponent(result.data.workspace.id)}`);
    }} />}
  </section>;
}

import { useEffect, useState } from 'react';
import type { SpaceDeletionPreview, SpaceMigrationPreview } from '@study-accelerator/web-core';
import { Button, Dialog, DialogBody, DialogFooter, Select, TextField } from '../../components/ui';
import { WorkspacePanel, WorkspacePanelBody, WorkspacePanelFooter, WorkspacePanelHeader } from '../../components/workspace/WorkspacePanel';
import { PathTrail } from '../../shell/PathTrail';
import { useNavigate } from '../../app/router';
import { useAppStore } from '../../store/AppStoreProvider';
import styles from './SpaceManagerView.module.css';

const errorText = (reason: unknown) => reason instanceof Error ? reason.message : '操作失败，请重试。';

export function SpaceManagerView() {
  const navigate = useNavigate();
  const state = useAppStore(value => value);
  const spaces = state.serverData.spaces;
  const canManage = state.canWriteWorkspace() && state.persistenceMode === 'remote';
  const [name, setName] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [sourceId, setSourceId] = useState(state.serverData.currentSpaceId ?? '');
  const [targetId, setTargetId] = useState('');
  const [migration, setMigration] = useState<SpaceMigrationPreview | null>(null);
  const [deletion, setDeletion] = useState<SpaceDeletionPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!sourceId && state.serverData.currentSpaceId) setSourceId(state.serverData.currentSpaceId);
  }, [sourceId, state.serverData.currentSpaceId]);

  async function operate(action: () => Promise<void>) {
    if (pending) return;
    setPending(true); setError(''); setNotice('');
    try { await action(); }
    catch (reason) { setError(errorText(reason)); }
    finally { setPending(false); }
  }

  return <WorkspacePanel as="main" aria-labelledby="space-manager-title">
    <WorkspacePanelHeader title="空间管理" code="SPACE" titleId="space-manager-title"
      breadcrumb={<PathTrail path={[{ id: 'materials', label: '笔记库', onNavigate: () => navigate('/materials') }, { id: 'spaces', label: '空间管理', current: true }]} variant="top" />}
      breadcrumbTitle="笔记库 / 空间管理" actionsLabel="空间操作"
      actions={<Button size="workspace" variant="primary" isDisabled={!canManage || pending} onPress={() => setCreateOpen(true)}>新建空间</Button>} />
    <WorkspacePanelBody className={styles.body}>
      {!canManage ? <p role="status" className={styles.notice}>当前模式可查看和切换空间。创建、迁移及永久删除请在网页版完成。</p> : null}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {notice ? <p role="status" className={styles.notice}>{notice}</p> : null}
      <section className={styles.section} aria-label="空间列表"><h2>空间</h2><div className={styles.cards}>
        {spaces.map(space => <article className={styles.card} key={space.id}>
          <div><h3>{space.name}</h3><p>{space.defaultFlag ? '默认空间 · 系统外壳保留' : '自建空间'}{state.serverData.currentSpaceId === space.id ? ' · 当前使用' : ''}</p></div>
          <div className={styles.actions}>
            <Button isDisabled={pending || state.serverData.currentSpaceId === space.id} onPress={() => void operate(async () => { await state.selectKnowledgeSpace(space.id); navigate('/materials'); })}>切换</Button>
            <Button variant="ghost" isDisabled={pending} onPress={() => void operate(async () => setDeletion(await state.inspectEmptySpaceDeletion(space.id)))}>删除预览</Button>
          </div>
        </article>)}
      </div></section>
      <section className={styles.section} aria-label="空间内容迁移"><h2>迁移空间内资产</h2><p>整包迁移笔记、目录、标签、标注与已保存分析范围，包含回收站内容；知识点和训练资产是全局对象，不会移动或删除。目标空间需为空。</p>
        <div className={styles.migrationFields}>
          <Select label="源空间" selectedKey={sourceId || null} options={spaces.map(space => ({ id: space.id, label: space.name ?? '未命名空间' }))} onSelectionChange={key => { setSourceId(String(key)); setMigration(null); }} />
          <Select label="目标空间" selectedKey={targetId || null} placeholder="选择空空间" options={spaces.filter(space => space.id !== sourceId).map(space => ({ id: space.id, label: space.name ?? '未命名空间' }))} onSelectionChange={key => { setTargetId(String(key)); setMigration(null); }} />
          <Button isDisabled={!canManage || pending || !sourceId || !targetId} onPress={() => void operate(async () => setMigration(await state.previewSpaceMigration(sourceId, targetId)))}>预览迁移</Button>
        </div>
        {migration ? <div className={styles.preview}>
          <p>笔记 {migration.counts.notes ?? 0}、目录 {migration.counts.folders ?? 0}、标签 {migration.counts.tags ?? 0}、标注 {migration.counts.annotations ?? 0}、保存范围 {migration.counts.analysisScopes ?? 0}。</p>
          {migration.blockers.length ? <p role="alert">暂不能迁移：{migration.blockers.join('、')}。请处理跨空间引用或清空目标空间后重新预览。</p> : <p>迁移后原空间外壳仍保留；旧设备待同步，备份按保留策略处理。</p>}
          <Button variant="danger" isDisabled={!canManage || pending || migration.decision !== 'can-migrate'} onPress={() => void operate(async () => { await state.migrateSpaceAssets(sourceId, targetId, migration.previewHash); setMigration(null); setNotice('空间内资产已迁移；请检查目标空间与离线设备的同步状态。'); })}>确认整包迁移</Button>
        </div> : null}
      </section>
    </WorkspacePanelBody>
    <WorkspacePanelFooter><span>{spaces.length} 个空间</span><span>默认空间外壳与用户内容分开管理</span></WorkspacePanelFooter>
    <Dialog title="新建空间" isOpen={createOpen} isPending={pending} onOpenChange={open => { if (!pending) setCreateOpen(open); }}>
      <DialogBody><TextField label="空间名称" value={name} onChange={setName} isDisabled={pending} />{error ? <p role="alert" className={styles.error}>{error}</p> : null}</DialogBody>
      <DialogFooter><Button variant="ghost" isDisabled={pending} onPress={() => setCreateOpen(false)}>取消</Button><Button variant="primary" isDisabled={!canManage || !name.trim()} isPending={pending} onPress={() => void operate(async () => { await state.createKnowledgeSpace(name.trim()); setCreateOpen(false); setName(''); setNotice('空间已创建，可切换或作为迁移目标。'); })}>创建</Button></DialogFooter>
    </Dialog>
    <Dialog title="删除空空间？" isOpen={Boolean(deletion)} isPending={pending} onOpenChange={open => { if (!open && !pending) setDeletion(null); }}>
      <DialogBody><p>仅删除空容器。默认空间的系统外壳保留；不会清除全局知识或训练资产。</p>
        {deletion?.references.length ? <p>仍有 {deletion.references.length} 个空间内对象（含回收站），请先迁移或逐项处理。</p> : null}
        {deletion?.decision === 'system-shell-protected' ? <p>默认空间外壳不可删除，可以迁移其中的自有内容。</p> : null}
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      </DialogBody>
      <DialogFooter><Button variant="ghost" isDisabled={pending} onPress={() => setDeletion(null)}>返回</Button><Button variant="danger" isDisabled={!canManage || deletion?.decision !== 'can-delete-empty-container'} isPending={pending} onPress={() => deletion && void operate(async () => { await state.deleteEmptySpace(deletion.asset.id, deletion.expectedUpdatedAt); setDeletion(null); setNotice('空空间已删除；离线设备待同步，备份按保留策略处理。'); })}>确认永久删除</Button></DialogFooter>
    </Dialog>
  </WorkspacePanel>;
}

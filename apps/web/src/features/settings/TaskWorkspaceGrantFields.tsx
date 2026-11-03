import { Checkbox } from '../../components/ui/input/Checkbox';
import type { TaskWorkspaceGrant } from './externalClients';
import styles from './SettingsView.module.css';

export function TaskWorkspaceGrantFields({ workspaces, grants, onChange, confirmed, onConfirmed, imagesConfirmed, onImagesConfirmed, disabled = false }: {
  workspaces: { id: string; name: string }[]; grants: TaskWorkspaceGrant[]; onChange: (value: TaskWorkspaceGrant[]) => void;
  confirmed: boolean; onConfirmed: (value: boolean) => void; imagesConfirmed: boolean; onImagesConfirmed: (value: boolean) => void; disabled?: boolean;
}) {
  const set = (id: string, patch: Partial<TaskWorkspaceGrant>) => { onChange(grants.map(grant => grant.workspaceId === id ? { ...grant, ...patch } : grant)); onConfirmed(false); onImagesConfirmed(false); };
  return <fieldset disabled={disabled} className={styles.dialogFields}>
    <legend>任务工作区权限（默认不授权）</legend>
    <p className={styles.dialogNote}>选择工作区后，读取权限覆盖其中现有及以后新建的文档。协写文档、执行任务和读取图片分别开启。Agent 只能提交成果，由你验收；没有发布、验收或取消任务的工具。</p>
    {!workspaces.length ? <p>暂无可授权的任务工作区，请先创建工作区。</p> : null}
    {workspaces.map(workspace => {
      const grant = grants.find(item => item.workspaceId === workspace.id);
      return <div key={workspace.id}>
        <Checkbox isDisabled={disabled} isSelected={Boolean(grant)} onChange={selected => {
          onChange(selected ? [...grants, { workspaceId: workspace.id, read: true, writeDocuments: false, executeTasks: false, includeImages: false }]
            : grants.filter(item => item.workspaceId !== workspace.id)); onConfirmed(false); onImagesConfirmed(false);
        }}>读取工作区：{workspace.name}</Checkbox>
        {grant ? <div className={styles.dialogFields}>
          <Checkbox isDisabled={disabled} isSelected={grant.writeDocuments} onChange={value => set(workspace.id, { writeDocuments: value })}>协写文档：{workspace.name}</Checkbox>
          <Checkbox isDisabled={disabled} isSelected={grant.executeTasks} onChange={value => set(workspace.id, { executeTasks: value })}>领取与执行任务：{workspace.name}</Checkbox>
          <Checkbox isDisabled={disabled} isSelected={grant.includeImages} onChange={value => set(workspace.id, { includeImages: value })}>读取文档引用的图片：{workspace.name}</Checkbox>
        </div> : null}
      </div>;
    })}
    {grants.some(grant => !workspaces.some(w => w.id === grant.workspaceId)) ? <p role="alert">部分已授权工作区当前不可用。取消后重新打开，或关闭全部任务权限后再选择。</p> : null}
    {grants.length ? <Checkbox isDisabled={disabled} isSelected={confirmed} onChange={onConfirmed}>我了解所选工作区现有及以后新建的文档会发给该客户端及其所属厂商</Checkbox> : null}
    {grants.some(grant => grant.includeImages) ? <Checkbox isDisabled={disabled} isSelected={imagesConfirmed} onChange={onImagesConfirmed}>我另外同意将这些工作区中文档引用的图片原始内容发送给该客户端及其所属厂商</Checkbox> : null}
  </fieldset>;
}

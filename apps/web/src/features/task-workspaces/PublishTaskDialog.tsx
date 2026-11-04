import { useState } from 'react';
import type { DocumentDTO, TaskDetail } from '@study-accelerator/web-core';
import { Button, Dialog, DialogBody, DialogFooter, Select, TextAreaField } from '../../components/ui';
import { TASK_LABELS, taskError } from './taskPresentation';
import styles from './TaskWorkspaces.module.css';
export interface PublishRequirements {
  expectedRevision: number;
  description: { documentId: string; versionId: string };
  acceptanceCriteria: string[];
  inScope: string;
  outOfScope: string;
}
export interface PublishDraft { base: TaskDetail; documentId: string; criteria: string; inScope: string; outOfScope: string }
export function PublishTaskDialog({ task, documents, savedDraft, onDraftChange, onReload, onPublish, onClose }: {
  task: TaskDetail; documents: Pick<DocumentDTO, 'id' | 'title' | 'currentVersionId'>[];
  savedDraft: PublishDraft | null; onDraftChange(draft: PublishDraft | null): void;
  onReload(): Promise<TaskDetail>; onPublish(input: PublishRequirements): Promise<void>; onClose(): void;
}) {
  const [draft, setDraft] = useState<PublishDraft>(() => savedDraft ?? { base: task, documentId: task.currentRequirement?.description.documentId ?? '', criteria: task.currentRequirement?.acceptanceCriteria.join('\n') ?? '', inScope: task.currentRequirement?.inScope ?? '', outOfScope: task.currentRequirement?.outOfScope ?? '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [latest, setLatest] = useState<TaskDetail | null>(null);
  const selected = documents.find(document => document.id === draft.documentId);
  const replacing = draft.base.status === 'running' || draft.base.status === 'review';
  const terminal = draft.base.status === 'accepted' || draft.base.status === 'cancelled';
  function change(patch: Partial<PublishDraft>) { const next = { ...draft, ...patch }; setDraft(next); onDraftChange(next); }
  return <Dialog title="发布需求" isOpen isPending={pending} onOpenChange={open => { if (!open) onClose(); }} size="md">
    <DialogBody><div className={styles.form}>
      <p>发布会冻结说明文档当前已保存的版本。未保存的编辑不会发布。当前发布基线：任务修订 {draft.base.revision}。</p>
      {replacing && <p role="alert">重新发布会立即使当前执行和提交成果失效，旧提交将不能验收。外部 Agent 可能仍在运行，需要你另行告知。</p>}
      {terminal && <p role="alert">此任务已结束，不能继续发布需求。你的输入仍保留，可另建任务。</p>}
      <Select label="需求说明文档" selectedKey={draft.documentId || null} onSelectionChange={id => change({ documentId: String(id ?? '') })}
        options={documents.map(document => ({ id: document.id, label: document.title }))} />
      <TextAreaField label="验收标准（每行一条）" value={draft.criteria} onChange={criteria => change({ criteria })} rows={4} isRequired />
      <TextAreaField label="包含范围" value={draft.inScope} onChange={inScope => change({ inScope })} />
      <TextAreaField label="不包含范围" value={draft.outOfScope} onChange={outOfScope => change({ outOfScope })} />
      {error && <p role="alert">{error}</p>}
      <Button variant="ghost" isDisabled={pending} onPress={() => {
        setPending(true); setError(''); setLatest(null);
        void onReload().then(value => setLatest(value)).catch(error => setError(taskError(error))).finally(() => setPending(false));
      }}>核对最新任务</Button>
      {latest && <section className={styles.snapshot} aria-label="最新任务修订核对">
        <h3>最新任务修订 {latest.revision} · {TASK_LABELS[latest.status]}</h3>
        <p className={styles.meta}>当前冻结需求：{latest.currentRequirementId ?? '尚未发布'} · 文档版本：{latest.currentRequirement?.description.versionId ?? '无'}</p>
        <p>以下为当前冻结验收标准。核对后，可保留你的表单输入并明确更新提交基线。</p>
        <ul>{latest.currentRequirement?.acceptanceCriteria.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul>
        <p className={styles.prewrap}>包含：{latest.currentRequirement?.inScope || '未填写'}{'\n'}不包含：{latest.currentRequirement?.outOfScope || '未填写'}</p>
        {(latest.status === 'running' || latest.status === 'review') && <p>使用此修订重新发布会使当前执行及成果失效。</p>}
        <Button onPress={() => { change({ base: latest }); setLatest(null); setError(''); }}>保留输入并使用此任务修订</Button>
      </section>}
    </div></DialogBody>
    <DialogFooter><Button variant="ghost" onPress={onClose} isDisabled={pending}>取消</Button>
      <Button isDisabled={pending || terminal || !selected || !draft.criteria.trim()} onPress={() => {
        if (!selected) return;
        setPending(true); setError(''); onDraftChange(draft);
        void onPublish({ expectedRevision: draft.base.revision, description: { documentId: selected.id, versionId: selected.currentVersionId }, acceptanceCriteria: draft.criteria.split('\n').map(value => value.trim()).filter(Boolean), inScope: draft.inScope, outOfScope: draft.outOfScope })
          .then(() => { onDraftChange(null); onClose(); }).catch(error => setError(taskError(error))).finally(() => setPending(false));
      }}>{replacing ? '确认使旧执行失效并发布' : '确认发布冻结版本'}</Button></DialogFooter>
  </Dialog>;
}

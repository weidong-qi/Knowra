import { useState } from 'react';
import type { DocumentDTO, TaskDetail, TaskEvent } from '@study-accelerator/web-core';
import { Button, Dialog, DialogBody, DialogFooter, TextAreaField } from '../../components/ui';
import { PublishTaskDialog, type PublishRequirements, type PublishDraft } from './PublishTaskDialog';
import { TASK_LABELS, taskError, EVENT_LABELS, ATTEMPT_LABELS } from './taskPresentation';
import styles from './TaskWorkspaces.module.css';
export function TaskDetailView({ task, documents, events, onPublish, onReview, onCancel, onOpenVersion, onMoreEvents, canWrite, onReload }: {
  task: TaskDetail; documents: Pick<DocumentDTO, 'id' | 'title' | 'currentVersionId'>[]; events: TaskEvent[];
  onPublish(input: PublishRequirements): Promise<void>;
  onReview(input: { expectedRevision: number; submissionId: string; decision: 'accepted' | 'returned'; comment: string }): Promise<void>;
  onCancel(): Promise<void>;
  onOpenVersion(documentId: string, versionId: string): void;
  onMoreEvents?: () => void; canWrite: boolean; onReload?(): Promise<TaskDetail>;
}) {
  const [publishDraft, setPublishDraft] = useState<PublishDraft | null>(null);
  const [publishing, setPublishing] = useState<TaskDetail | null>(null);
  const [decision, setDecision] = useState<'accepted' | 'returned' | 'cancelled' | null>(null);
  const [reviewTarget, setReviewTarget] = useState<{ revision: number; submissionId: string | null; requirementId: string | null } | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const attempt = task.currentAttempt;
  const submission = attempt?.submission;
  const currentSubmission = task.status === 'review' && attempt?.id === task.activeAttemptId && submission?.requirementId === task.currentRequirementId;
  const targetCurrent = reviewTarget !== null && reviewTarget.revision === task.revision && reviewTarget.requirementId === task.currentRequirementId && reviewTarget.submissionId === (submission?.id ?? null);
  function openDecision(value: 'accepted' | 'returned' | 'cancelled') { setReviewTarget({ revision: task.revision, submissionId: submission?.id ?? null, requirementId: task.currentRequirementId }); setDecision(value); setError(''); }
  const actionable = canWrite && task.status !== 'accepted' && task.status !== 'cancelled';
  return <section className={styles.detail} aria-label="任务详情">
    <div className={styles.actions}><h2>{task.title}</h2><span>{TASK_LABELS[task.status]}</span>
      {actionable && <><Button onPress={() => setPublishing(task)}>{task.currentRequirementId ? '修改并重新发布需求' : '发布需求'}</Button>
        <Button variant="ghost" onPress={() => openDecision('cancelled')}>取消任务</Button></>}
    </div>
    <p className={styles.meta}>任务修订 {task.revision}。外部 Agent 的领取和身份由配对权限管理，请在授权后手动通知 Agent。</p>
    {task.currentRequirement && <section className={styles.snapshot}><h3>冻结需求 · 第 {task.currentRequirement.ordinal} 版</h3>
      <Button variant="default" onPress={() => onOpenVersion(task.currentRequirement!.description.documentId, task.currentRequirement!.description.versionId)}>查看冻结说明</Button>
      <ul>{task.currentRequirement.acceptanceCriteria.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul>
      <p className={styles.prewrap}>包含：{task.currentRequirement.inScope || '未填写'}{'\n'}不包含：{task.currentRequirement.outOfScope || '未填写'}</p>
    </section>}
    {attempt && <section className={styles.snapshot}><h3>当前执行 · 第 {attempt.generation} 次</h3>
      <p className={styles.meta}>执行身份：{attempt.actor.id} · 状态：{ATTEMPT_LABELS[attempt.status]}</p>
      <p>{attempt.leaseExpiresAt ? `租约截止：${new Date(attempt.leaseExpiresAt).toLocaleString()}` : '当前无活动租约'}</p>
      {task.status === 'running' && task.leaseExpired && <p role="status">租约已到期，可由获授权的 Agent 重新领取。</p>}
      {attempt.progress && <p className={styles.prewrap}>进度：{attempt.progress.message}</p>}
      {submission && <><h3>提交成果</h3><p className={styles.prewrap}>{submission.summary}</p>
        {submission.artifacts.map((artifact, index) => <Button key={`${artifact.documentId}:${artifact.versionId}`} variant="default" onPress={() => onOpenVersion(artifact.documentId, artifact.versionId)}>查看成果 {index + 1} 的冻结版本</Button>)}
        <p className={styles.meta}>提交 {submission.id} · 需求 {submission.requirementId}</p>
        {canWrite && currentSubmission && <div className={styles.actions}><Button onPress={() => openDecision('accepted')}>接受成果</Button><Button variant="default" onPress={() => openDecision('returned')}>退回重做</Button></div>}
      </>}
    </section>}
    {task.latestReview && <section className={styles.snapshot}><h3>最新验收决定</h3><p>{task.latestReview.decision === 'accepted' ? '已接受成果' : '已退回重做'}</p><p className={styles.prewrap}>{task.latestReview.comment || '未填写意见'}</p></section>}
    <section className={styles.snapshot}><h3>任务记录</h3>
      <ol>{events.map(event => <li key={event.sequence}>{new Date(event.createdAt).toLocaleString()} · {EVENT_LABELS[event.type] ?? '任务更新'}</li>)}</ol>
      {onMoreEvents && <Button variant="ghost" onPress={onMoreEvents}>加载更多记录</Button>}
    </section>
    {publishing && <PublishTaskDialog task={publishing} documents={documents} savedDraft={publishDraft} onDraftChange={setPublishDraft} onReload={onReload ?? (() => Promise.resolve(task))} onPublish={onPublish} onClose={() => setPublishing(null)} />}
    {decision && <Dialog title={decision === 'accepted' ? '确认接受成果' : decision === 'returned' ? '退回重做' : '取消任务'} isOpen isPending={pending} onOpenChange={open => { if (!open) setDecision(null); }}>
      <DialogBody><p>{decision === 'cancelled' ? '取消会让当前租约失效，但不能停止外部 Agent 进程。' : '此决定仅针对当前需求和当前提交的冻结成果版本。请先查看成果，再确认。'}</p>
        {decision !== 'cancelled' && <TextAreaField label="验收意见" value={comment} onChange={setComment} />}
        {!targetCurrent && <p role="alert">任务已变化，请关闭对话框，重新核对当前成果。</p>}{error && <p role="alert">{error}</p>}</DialogBody>
      <DialogFooter><Button variant="ghost" onPress={() => setDecision(null)} isDisabled={pending}>暂不处理</Button>
        <Button isDisabled={pending || !targetCurrent || (decision !== 'cancelled' && !currentSubmission)} onPress={() => {
          setPending(true); setError('');
          const work = decision === 'cancelled' ? onCancel() : onReview({ expectedRevision: task.revision, submissionId: submission!.id, decision, comment });
          void work.then(() => { setDecision(null); setComment(''); }).catch(error => setError(taskError(error))).finally(() => setPending(false));
        }}>{decision === 'accepted' ? '确认接受当前成果' : decision === 'returned' ? '确认退回当前成果' : '确认取消任务'}</Button></DialogFooter>
    </Dialog>}
  </section>;
}

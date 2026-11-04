import type { TaskSummary } from '@study-accelerator/web-core';
import { CardButton } from '../../components/ui/button/CardButton';
import { TASK_LABELS, taskColumn } from './taskPresentation';
import styles from './TaskWorkspaces.module.css';

function executorLabel(task: TaskSummary) {
  const executor = task.currentExecutor;
  if (!executor) return null;
  return executor.label?.trim() || `客户端 ${executor.id.slice(0, 8)}`;
}
export function TaskBoard({ tasks, onOpen }: { tasks: TaskSummary[]; onOpen(id: string): void }) {
  return <div className={styles.board} aria-label="任务看板">
    {([['ready', '准备'], ['active', '执行与验收'], ['done', '已结束']] as const).map(([column, title]) => <section className={styles.column} key={column}>
      <h2>{title}<span className={styles.columnCount}>{tasks.filter(task => taskColumn(task) === column).length}</span></h2>
      {tasks.filter(task => taskColumn(task) === column).map(task => {
        const executor = executorLabel(task);
        const status = `${TASK_LABELS[task.status]}${task.status === 'running' && task.leaseExpired ? ' · 租约已到期，可重新领取' : ''}`;
        const description = [status, executor && `执行客户端：${executor}`, task.latestProgress && `最新进度：${task.latestProgress.message}`, '打开任务详情查看完整记录'].filter(Boolean).join('；');
        return <article className={styles.card} key={task.id} aria-label={`${task.title}任务卡`}>
          <CardButton aria-label={task.title} aria-describedby={`task-card-description-${task.id}`} onPress={() => onOpen(task.id)}>
            <span className={styles.cardTitle}>{task.title}</span>
            <span className={styles.cardStatus}>{status}</span>
            {executor && <span className={`${styles.meta} ${styles.cardExecutor}`}>执行客户端：{executor}</span>}
            {task.latestProgress && <>
              <span className={styles.cardProgress}>最新进度：{task.latestProgress.message}</span>
              <time className={styles.meta} dateTime={task.latestProgress.updatedAt}>进度更新 {new Date(task.latestProgress.updatedAt).toLocaleString()}</time>
            </>}
            {task.status === 'running' && !task.latestProgress && <span className={styles.meta}>尚未报告进度</span>}
            {task.leaseExpiresAt && <span className={styles.meta}>租约截止 {new Date(task.leaseExpiresAt).toLocaleString()}</span>}
          </CardButton>
          <span id={`task-card-description-${task.id}`} hidden>{description}</span>
        </article>;
      })}
      {!tasks.some(task => taskColumn(task) === column) && <p className={styles.meta}>暂无任务</p>}
    </section>)}
  </div>;
}

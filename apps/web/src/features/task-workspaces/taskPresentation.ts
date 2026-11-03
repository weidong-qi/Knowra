import type { TaskSummary } from '@study-accelerator/web-core';
export const TASK_LABELS: Record<TaskSummary['status'], string> = { draft: '草稿', ready: '待领取', running: '执行中', review: '待验收', accepted: '已接受', cancelled: '已取消' };
export function taskColumn(task: TaskSummary) {
  if (task.status === 'draft' || task.status === 'ready') return 'ready';
  if (task.status === 'running' || task.status === 'review') return 'active';
  return 'done';
}
export function taskError(error: unknown) {
  if (error && typeof error === 'object' && 'status' in error && error.status === 409) return '内容或任务状态已变化。你的草稿仍保留，请刷新并核对最新版本后再操作。';
  return '操作未完成，请检查连接并重试。你的草稿仍保留。';
}

export const EVENT_LABELS: Record<string, string> = { created: '创建任务', published: '发布冻结需求', claimed: '领取任务', renewed: '续租', progress: '更新进度', submitted: '提交成果', released: '释放领取', accepted: '人工接受成果', returned: '人工退回重做', cancelled: '取消任务', workspaceArchived: '归档工作区' };
export const ATTEMPT_LABELS = { running: '执行中', submitted: '已提交', released: '已释放', expired: '已过期', superseded: '已被新需求替代', cancelled: '已取消' };

import type { DocumentDTO, TaskDetail } from '@study-accelerator/web-core';
const time = '2026-10-15T12:00:00Z';
export function syntheticDocument(overrides: Partial<DocumentDTO> = {}): DocumentDTO {
  return { id: 'doc', workspaceId: 'workspace', title: '合成说明', revision: 1, currentVersionId: 'version', version: { id: 'version', ordinal: 1, contentHash: 'synthetic-hash', createdAt: time, actor: { kind: 'user', id: 'synthetic-user' } }, markdown: '合成正文', start: 0, end: 4, hasMore: false, attachments: [], ...overrides };
}
export function syntheticTask(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return { id: 'task', workspaceId: 'workspace', title: '合成任务', status: 'review', revision: 4, currentRequirementId: 'requirement', activeAttemptId: 'attempt', leaseExpiresAt: null, claimable: false, leaseExpired: false, currentExecutor: null, latestProgress: null, updatedAt: time,
    currentRequirement: { id: 'requirement', ordinal: 1, description: { documentId: 'doc', versionId: 'version' }, acceptanceCriteria: ['合成验收标准'], inScope: '本域', outOfScope: '私人笔记', createdAt: time, actor: { kind: 'user', id: 'synthetic-user' } },
    currentAttempt: { id: 'attempt', taskId: 'task', workspaceId: 'workspace', requirementId: 'requirement', generation: 1, actor: { kind: 'mcp', id: 'synthetic-agent' }, status: 'submitted', leaseExpiresAt: null, progress: { message: '已完成合成检查', updatedAt: time }, submission: { id: 'submission', requirementId: 'requirement', summary: '合成成果', artifacts: [{ documentId: 'doc', versionId: 'version' }], createdAt: time }, startedAt: time, finishedAt: time }, latestReview: null, events: { afterSequence: 0 }, ...overrides };
}

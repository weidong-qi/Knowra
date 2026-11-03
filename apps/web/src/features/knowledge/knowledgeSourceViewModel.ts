import type { KnowledgeEvidence } from '@study-accelerator/web-core';

export function evidenceHealthLabel(status: KnowledgeEvidence['status']) {
  return { valid: '来源可用', stale: '需复核', invalid: '来源不可用', insufficient: '来源不足' }[status] ?? '待核对';
}

export function evidenceApplicabilityLabel(status: KnowledgeEvidence['applicabilityStatus']) {
  return status === 'withdrawn' ? '已撤回适用性' : status === 'needsReview' ? '适用性待核对' : '适用性已采用';
}

export function sourceVersionError(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'NOTE_VERSION_NOT_FOUND' || error.code === 'NOTE_NOT_FOUND') {
      return '历史版本暂不可用。保存的来源摘录仍保留，请核对来源后重试。';
    }
  }
  return '历史版本读取失败，请重试。保存的来源摘录仍可查看。';
}

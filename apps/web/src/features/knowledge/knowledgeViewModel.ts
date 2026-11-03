import type { KnowledgeItem, KnowledgeReviewStatus } from '@study-accelerator/web-core';

export const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeReviewStatus, string> = {
  candidate: '候选', confirmed: '已确认', needsRevision: '待修订', archived: '已归档'
};
export const KNOWLEDGE_TYPE_OPTIONS = [
  { id: 'concept', label: '概念' }, { id: 'fact', label: '事实' },
  { id: 'principle', label: '原理' }, { id: 'process', label: '流程' },
  { id: 'algorithm', label: '算法' }, { id: 'formula', label: '公式' },
  { id: 'comparison', label: '比较' }, { id: 'application', label: '应用' }
] as const;

export function knowledgeStatusLabel(status?: string) {
  return KNOWLEDGE_STATUS_LABELS[status as KnowledgeReviewStatus] ?? '候选';
}

export function knowledgeTypeLabel(type: string) {
  return KNOWLEDGE_TYPE_OPTIONS.find(option => option.id === type)?.label ?? type;
}

export function filterKnowledgeItems(items: KnowledgeItem[], status: string, query: string) {
  const search = query.trim().toLocaleLowerCase();
  return items.filter(item => !item.deletedAt)
    .filter(item => status === 'all' ? item.reviewStatus !== 'archived' : (item.reviewStatus ?? 'candidate') === status)
    .filter(item => !search || [item.title, item.canonicalStatement, item.userExplanation].some(text => text.toLocaleLowerCase().includes(search)))
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.title.localeCompare(b.title, 'zh-CN'));
}

export function knowledgeError(error: unknown, fallback = '操作失败，请重试。') {
  if (error && typeof error === 'object' && 'code' in error) {
    const messages: Record<string, string> = {
      KNOWLEDGE_ITEM_UPDATE_CONFLICT: '这条知识已被其他操作更新。本次输入已保留，请先复制需要保留的文字，再取消并重新加载。',
      KNOWLEDGE_ITEM_CONTENT_REQUIRED: '确认前请填写标题和核心陈述。',
      KNOWLEDGE_ITEM_SOURCE_REQUIRED: '来源目前不可用，请重新核对来源标注后再确认。',
      KNOWLEDGE_EVIDENCE_VERSION_REQUIRED: '这条标注尚未关联已保存的笔记版本。请先保存笔记，再重新打开候选创建面板。',
      KNOWLEDGE_EVIDENCE_VERSION_MISMATCH: '来源版本已经变化。本次输入已保留，请先复制需要保留的文字，再重新打开候选创建面板。',
      KNOWLEDGE_EVIDENCE_REVISION_CONFLICT: '来源标注已经变化。本次输入已保留，请先复制需要保留的文字，再重新打开候选创建面板。'
    };
    const message = messages[String(error.code)];
    if (message) return message;
  }
  return error instanceof Error ? error.message : fallback;
}

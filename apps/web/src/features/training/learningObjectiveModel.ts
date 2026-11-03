import type { TrainingAssetRecord } from '@study-accelerator/web-core';

// 与知识领域已冻结的八种动作、四种层级及确认兼容规则一致。
export const OBJECTIVE_ACTIONS = { identify: '识别', explain: '解释', apply: '应用', compare: '比较', analyze: '分析', calculate: '计算', design: '设计', evaluate: '评价' };
export const OBJECTIVE_LEVELS = { remember: '记忆', understand: '理解', apply: '应用', analyze: '分析' };
const COMPATIBLE_LEVELS: Record<string, string> = { identify: 'remember', explain: 'understand', apply: 'apply', calculate: 'apply', compare: 'analyze', analyze: 'analyze', design: 'analyze', evaluate: 'analyze' };
export function objectiveStatus(record: TrainingAssetRecord) {
  return record.deletedAt ? '已删除' : record.reviewStatus === 'archived' ? '已归档' : record.reviewStatus === 'confirmed' ? '已确认' : '待确认';
}
export function objectiveFieldsValid(value: { objective: string; actionVerb: string; cognitiveLevel: string }) {
  return Boolean(value.objective.trim() && COMPATIBLE_LEVELS[value.actionVerb] === value.cognitiveLevel);
}
export function objectiveConfirmable(value: { objective: string; actionVerb: string; cognitiveLevel: string }) {
  return objectiveFieldsValid(value) && !/^(?:能够|能|可以)?\s*(?:了解|熟悉|掌握)/u.test(value.objective.trim());
}
export function objectiveError(error: unknown) {
  const messages: Record<string, string> = {
    LEARNING_OBJECTIVE_CONTENT_REQUIRED: '请补齐目标、动作和认知层级后再确认。',
    LEARNING_OBJECTIVE_VAGUE_VERB: '请将“了解、熟悉、掌握”改写为可观察的具体行为后再确认。',
    LEARNING_OBJECTIVE_COGNITIVE_LEVEL_MISMATCH: '动作与认知层级不匹配，请核对后再确认。',
    KNOWLEDGE_ITEM_NOT_CONFIRMED: '父知识尚未确认，请重新核对知识状态。',
    KNOWLEDGE_ITEM_NOT_FOUND: '父知识已不可用，请重新加载核对。',
    LEARNING_OBJECTIVE_NOT_FOUND: '学习目标已不可用，请重新加载核对。',
    LEARNING_OBJECTIVE_BASELINE_INVALID: '审阅版本不完整，请重新加载并核对。',
    LEARNING_OBJECTIVE_UPDATE_CONFLICT: '学习目标或父知识已变化，请重新加载并核对。'
  };
  return messages[(error as { code?: string })?.code ?? ''] ?? (error instanceof Error ? error.message : '学习目标操作失败，请重试。');
}
export function objectiveActionLabel(value = '') { return OBJECTIVE_ACTIONS[value as keyof typeof OBJECTIVE_ACTIONS] ?? (value || '未填写'); }
export function objectiveLevelLabel(value = '') { return OBJECTIVE_LEVELS[value as keyof typeof OBJECTIVE_LEVELS] ?? (value || '未填写'); }

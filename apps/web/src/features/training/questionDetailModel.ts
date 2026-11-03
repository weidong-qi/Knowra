import type { TrainingAssetRecord } from '@study-accelerator/web-core';

export interface QuestionSource {
  id: string;
  sourceType: string;
  sourceId: string | null;
  quote: string;
  status: string;
  locator: Record<string, unknown> | null;
}

export function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function questionSources(question: TrainingAssetRecord): QuestionSource[] {
  if (!Array.isArray(question.sources)) return [];
  return question.sources.flatMap((value, index) => {
    const source = objectValue(value);
    return source ? [{ id: textValue(source.id) || `${question.id}-source-${index}`, sourceType: textValue(source.sourceType),
      sourceId: textValue(source.sourceId) || null, quote: textValue(source.quote), status: textValue(source.status), locator: objectValue(source.locator) }] : [];
  });
}

export const questionTypeLabel = (value: unknown) => ({ singleChoice: '单选题', multipleChoice: '多选题', trueFalse: '判断题', shortAnswer: '简答题' }[textValue(value)] ?? '题型未设置');
export const difficultyLabel = (value: unknown) => ({ easy: '简单', medium: '中等', hard: '困难' }[textValue(value)] ?? '难度未设置');
export const reviewLabel = (record: TrainingAssetRecord) => record.deletedAt ? '回收站' : record.archivedAt ? '已归档' : ({ draft: '草稿', validating: '待校验', candidate: '待确认', confirmed: '已确认', archived: '已归档' }[record.reviewStatus ?? ''] ?? '状态待核对');
export const sourceTypeLabel = (value: string) => ({ knowledgeItem: '知识单元', learningObjective: '学习目标', noteVersion: '笔记版本', knowledgeEvidence: '知识证据', manual: '人工来源', pastPaper: '历年试题', ai: 'AI 来源' }[value] ?? '其他来源');
export const sourceStatusLabel = (value: string) => ({ active: '来源记录有效', stale: '来源需复核', reanchored: '已重新定位' }[value] ?? '来源状态待核对');

export function choiceOptions(question: TrainingAssetRecord) {
  return Array.isArray(question.options) ? question.options.flatMap(value => {
    const option = objectValue(value);
    return option ? [{ id: String(option.id ?? '').trim(), text: String(option.text ?? '') }] : [];
  }) : [];
}

export function choiceAnswer(question: TrainingAssetRecord): string[] {
  const options = choiceOptions(question);
  const answers = Array.isArray(question.referenceAnswer) ? question.referenceAnswer : [question.referenceAnswer];
  return answers.filter(value => value !== null && value !== undefined).map(value => {
    const id = String(value).trim();
    const option = options.find(item => item.id === id);
    return option ? `${id} · ${option.text}` : `${id}（未找到对应选项）`;
  });
}

/** 时间戳沿用历史记录的未知值；原生 Date 负责转换或抛错。 */
export interface KnowledgeItemTimestampView {
  updatedAt?: unknown;
}

export interface KnowledgeItemBaselineInput {
  expectedUpdatedAt?: unknown;
}

type NativeDateConstructor = new (value: unknown) => Date;
type NativeDateParse = (value: unknown) => number;

import { conflictError, validationError } from './knowledge-errors.ts';

export function assertKnowledgeItemBaseline(item: KnowledgeItemTimestampView, input: unknown = {}): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('KNOWLEDGE_ITEM_BASELINE_INVALID', '知识操作参数无效。');
  }
  if ((input as KnowledgeItemBaselineInput).expectedUpdatedAt === undefined) return;
  if (
    typeof (input as KnowledgeItemBaselineInput).expectedUpdatedAt !== 'string' ||
    !Number.isFinite((Date.parse as NativeDateParse)((input as KnowledgeItemBaselineInput).expectedUpdatedAt))
  ) {
    throw validationError('KNOWLEDGE_ITEM_BASELINE_INVALID', '知识版本无效，请重新加载后再操作。');
  }
  if (
    new (Date as NativeDateConstructor)((input as KnowledgeItemBaselineInput).expectedUpdatedAt).toISOString() !==
    new (Date as NativeDateConstructor)(item.updatedAt).toISOString()
  ) {
    throw conflictError('KNOWLEDGE_ITEM_UPDATE_CONFLICT', '知识已被其他操作修改，请重新加载并核对后再保存或确认。');
  }
}

/** 确保同一毫秒内连续编辑也会推进并发基线。 */
export function nextKnowledgeItemTimestamp(item: KnowledgeItemTimestampView | null | undefined): string {
  return new Date(Math.max(Date.now(), ((Date.parse as NativeDateParse)(item?.updatedAt) || 0) + 1)).toISOString();
}

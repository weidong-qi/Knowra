export interface LearningObjectiveTimestampView {
  updatedAt?: unknown;
}

export interface LearningObjectiveReviewBaseline {
  objectiveUpdatedAt?: unknown;
  knowledgeUpdatedAt?: unknown;
}

export interface LearningObjectiveReviewInput {
  reviewBaseline?: unknown;
}

export interface LearningObjectiveReviewOptions {
  hasObjective?: boolean;
}

// 只描述原有属性访问；不是对捕获异常或审阅输入的运行时验证。
interface ReviewErrorView {
  code?: unknown;
  statusCode?: unknown;
  cause?: unknown;
  meta?: unknown;
}

type NativeDateConstructor = new (value: unknown) => Date;
type NativeDateParse = (value: unknown) => number;

import { createAppError } from '../../../errors/app-error.ts';
import { conflictError } from './knowledge-errors.ts';

const invalidBaseline = (message: string) => createAppError('LEARNING_OBJECTIVE_BASELINE_INVALID', message, 400);
const conflictMessage = '目标或父知识已被其他操作修改，请重新加载并核对后再保存或确认。';

function readReviewBaseline(input: unknown = {}, hasObjective = true): LearningObjectiveReviewBaseline | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw invalidBaseline('学习目标审阅参数无效。');
  }
  if (!Object.hasOwn(input, 'reviewBaseline')) return null;
  const baseline = (input as LearningObjectiveReviewInput).reviewBaseline;
  const fields = hasObjective ? ['objectiveUpdatedAt', 'knowledgeUpdatedAt'] : ['knowledgeUpdatedAt'];
  if (
    !baseline ||
    typeof baseline !== 'object' ||
    Array.isArray(baseline) ||
    fields.some(
      field =>
        typeof (baseline as Record<string, unknown>)[field] !== 'string' ||
        !Number.isFinite((Date.parse as NativeDateParse)((baseline as Record<string, unknown>)[field])) ||
        new (Date as NativeDateConstructor)((baseline as Record<string, unknown>)[field]).toISOString() !==
          (baseline as Record<string, unknown>)[field]
    )
  ) {
    throw invalidBaseline('审阅版本无效，请重新加载后再操作。');
  }
  return baseline as LearningObjectiveReviewBaseline;
}

/** 旧调用可省略；审阅入口须提交所展示的父知识与目标基线。 */
export function assertLearningObjectiveBaseline(
  objective: LearningObjectiveTimestampView | null | undefined,
  knowledgeItem: LearningObjectiveTimestampView,
  input: unknown = {}
): void {
  const baseline = readReviewBaseline(input, Boolean(objective));
  if (!baseline) return;
  const matches = (left: unknown, right: unknown) =>
    typeof right === 'string' &&
    Number.isFinite((Date.parse as NativeDateParse)(right)) &&
    left === new Date(right).toISOString();
  if (
    !matches(baseline.knowledgeUpdatedAt, knowledgeItem.updatedAt) ||
    (objective && !matches(baseline.objectiveUpdatedAt, objective.updatedAt))
  ) {
    throw conflictError('LEARNING_OBJECTIVE_UPDATE_CONFLICT', conflictMessage);
  }
}

function isPostgresReviewConflict(error: unknown): boolean {
  const seen = new Set<object>();
  for (
    let cause = error;
    cause && typeof cause === 'object' && !seen.has(cause);
    cause = (cause as ReviewErrorView).cause
  ) {
    seen.add(cause);
    if (
      (cause as ReviewErrorView).code === 'P2034' ||
      ((cause as ReviewErrorView).code === 'P2010' &&
        (['40001', '40P01'] as readonly unknown[]).includes(
          ((cause as ReviewErrorView).meta as { code?: unknown } | null | undefined)?.code
        ))
    )
      return true;
  }
  return false;
}

/** 仅新审阅动作映射可重审的事务竞争；不重试，也不改变旧调用或其他 API 错误。 */
export async function withLearningObjectiveReviewErrors<T>(
  input: unknown,
  operation: () => T,
  { hasObjective = true }: LearningObjectiveReviewOptions = {}
): Promise<Awaited<T>> {
  const baseline = readReviewBaseline(input, hasObjective);
  try {
    return await operation();
  } catch (error) {
    const isExistingDomainError =
      (error as ReviewErrorView | null | undefined)?.code &&
      Number.isInteger((error as ReviewErrorView).statusCode) &&
      !((error as ReviewErrorView).code as { startsWith(prefix: string): unknown }).startsWith('DATABASE_');
    if (baseline && !isExistingDomainError && isPostgresReviewConflict(error)) {
      throw createAppError('LEARNING_OBJECTIVE_UPDATE_CONFLICT', conflictMessage, 409, { cause: error });
    }
    throw error;
  }
}

export function nextLearningObjectiveTimestamp(objective: LearningObjectiveTimestampView | null | undefined): string {
  return new Date(Math.max(Date.now(), ((Date.parse as NativeDateParse)(objective?.updatedAt) || 0) + 1)).toISOString();
}

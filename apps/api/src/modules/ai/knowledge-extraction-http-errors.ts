import { createAppError } from '../../errors/app-error.ts';
import type { AppError } from '../../errors/app-error.ts';
import type { ExtractionSafeError, RawExtractionHttpError } from './knowledge-extraction-query-types.ts';

type RawError = Omit<Partial<AppError>, 'code'> & { code?: unknown };

// HTTP 和任务视图只使用固定文案；持久事件中的任意 message/payload 不直接公开。
const messages = {
  KNOWLEDGE_EXTRACTION_UNAVAILABLE: [503, '知识提炼暂不可用；仍可保存分析范围和手动整理知识。'],
  KNOWLEDGE_EXTRACTION_RECOVERING: [503, '正在恢复提炼任务记录，请稍后重试。'],
  KNOWLEDGE_EXTRACTION_REQUEST_INVALID: [422, '提炼请求无效，请重新核对范围。'],
  KNOWLEDGE_EXTRACTION_REQUEST_REJECTED: [403, '提炼请求来源无效。'],
  KNOWLEDGE_EXTRACTION_TASK_NOT_FOUND: [404, '提炼任务不存在或资料集已切换。'],
  KNOWLEDGE_EXTRACTION_TASK_STALE: [404, '提炼任务不存在或资料集已切换。'],
  KNOWLEDGE_EXTRACTION_SCOPE_FORBIDDEN: [409, '分析范围不可用，请重新核对范围。'],
  KNOWLEDGE_EXTRACTION_SOURCE_UNAVAILABLE: [409, '来源已删除或移动，请重新核对范围。'],
  KNOWLEDGE_EXTRACTION_GRANT_INVALID: [409, '本次授权或来源已失效，请重新核对范围后开始。'],
  KNOWLEDGE_EXTRACTION_ATTEMPT_LIMIT: [409, '本次任务已达到重试上限，请重新核对范围后开始。'],
  KNOWLEDGE_EXTRACTION_NOT_RETRYABLE: [409, '当前任务不可重试。'],
  KNOWLEDGE_EXTRACTION_NOT_RUNNABLE: [409, '当前任务不可执行，请刷新任务状态。'],
  KNOWLEDGE_EXTRACTION_QUEUE_FULL: [409, '提炼任务繁忙，任务记录已保留，请稍后查看。'],
  KNOWLEDGE_EXTRACTION_CANCELLED: [409, '提炼已停止，未接纳新的候选。'],
  KNOWLEDGE_EXTRACTION_ATTEMPT_STALE: [409, '任务已结束或执行已过期，迟到结果未被接纳。'],
  KNOWLEDGE_EXTRACTION_INPUT_TOO_LARGE: [422, '分析范围过大，请缩小范围后重试。'],
  KNOWLEDGE_EXTRACTION_GATEWAY_INPUT_TOO_LARGE: [422, '分析范围过大，请缩小范围后重试。'],
  KNOWLEDGE_EXTRACTION_INPUT_CONFLICT: [409, '分析范围已变化，请重新核对。'],
  KNOWLEDGE_EXTRACTION_OUTPUT_CONFLICT: [409, '任务已保存另一份结果，请查看原候选。'],
  KNOWLEDGE_EXTRACTION_CANDIDATE_CONFLICT: [409, '候选发生冲突，本次结果未保存。'],
  KNOWLEDGE_EXTRACTION_TARGET_LIMIT: [422, '候选数量超出本次范围，本次结果未保存。'],
  KNOWLEDGE_EXTRACTION_REFUSED: [422, '提炼未得到可采用的结果。'],
  KNOWLEDGE_EXTRACTION_TRUNCATED: [422, '提炼结果不完整，请缩小范围后重试。'],
  KNOWLEDGE_EXTRACTION_RESPONSE_INCOMPLETE: [422, '提炼结果不完整，本次结果未保存。'],
  KNOWLEDGE_EXTRACTION_FAILED: [503, '提炼未完成，任务记录已保留，请稍后查看。'],
  AI_IDEMPOTENCY_CONFLICT: [409, '同一请求已绑定其他范围，请重新核对。']
} satisfies Record<string, readonly [number, string]>;

export function extractionSafeError<Code>(code: Code): ExtractionSafeError<Code> {
  const safe = Object.hasOwn(messages, code as PropertyKey) ? code : 'KNOWLEDGE_EXTRACTION_FAILED';
  return { code: safe, message: messages[safe as keyof typeof messages][1] };
}

export function extractionHttpError(error: unknown): RawExtractionHttpError {
  // 私有存储损坏、Mock约束失败和未知异常仅关闭本场景，不公开底层错误。
  const code = [
    'KNOWLEDGE_EXTRACTION_TASK_INVALID',
    'KNOWLEDGE_EXTRACTION_COMMIT_INVALID',
    'KNOWLEDGE_EXTRACTION_MOCK_ONLY'
  ].includes((error as RawError | null | undefined)?.code as string)
    ? 'KNOWLEDGE_EXTRACTION_UNAVAILABLE'
    : (error as RawError | null | undefined)?.code;
  const safe = extractionSafeError(code);
  // Object.hasOwn沿用属性键强制转换；code原值未经字符串转换，仍由原构造器透传。
  return (createAppError as (code: unknown, message: string, status: number) => RawExtractionHttpError)(
    safe.code,
    safe.message,
    messages[safe.code as keyof typeof messages][0]
  );
}

export const extractionUnavailable = () => extractionHttpError({ code: 'KNOWLEDGE_EXTRACTION_UNAVAILABLE' });

import { hashRecord } from './record-contract.ts';
import type { SourceReference } from './access-service-types.ts';

interface CheckpointData<Reference = unknown> {
  version: 1;
  nextRound: number;
  totalTools: number;
  initialSearchDone: boolean;
  // 默认保留本校验器未检查的外部元素；完整source形状由conversation AJV保证。
  sourceRefs: Reference[];
  searchTruncated: boolean;
  searchFallback: boolean;
  forceAnswer: boolean;
  noProgressRounds: number;
  handledAttemptOrdinal: number;
  externalContext: string;
  toolFeedback: string;
}
type RawCheckpoint = Partial<Record<keyof CheckpointData, unknown>>;
interface DurableModelResult {
  content: string;
  toolCalls: { id: string; name: string; arguments: object }[];
  finishReason: string;
  truncated: boolean;
  refused: boolean;
}
type RawModelResult = Partial<Record<keyof DurableModelResult, unknown>>;
type RawToolCall = Partial<Record<'id' | 'name' | 'arguments', unknown>>;
interface AttemptView {
  ordinal: number;
  status: string;
  responseRejectedCode?: string | null;
  modelResult?: object | null;
}

export const MAX_AGENT_RUN_MS = 10 * 60_000;
export const REJECTED_RESPONSE_CODES = new Set([
  'AI_CITATION_INVALID',
  'AI_OUTPUT_INVALID',
  'AI_OUTPUT_TRUNCATED',
  'AI_PROVIDER_REFUSED',
  'AI_TOOL_INVALID'
]);

export const emptyAgentCheckpoint = (): CheckpointData<SourceReference> => ({
  version: 1,
  nextRound: 0,
  totalTools: 0,
  initialSearchDone: false,
  sourceRefs: [],
  searchTruncated: false,
  searchFallback: false,
  forceAnswer: false,
  noProgressRounds: 0,
  handledAttemptOrdinal: 0,
  externalContext: '',
  toolFeedback: ''
});

const invalid = (message: string): never => {
  throw Object.assign(new Error(message), { code: 'AI_CHECKPOINT_INVALID' });
};

/** 仅保存继续执行所需的计数与来源标识；恢复时仍须重新验证读取和外发授权。 */
export function validateAgentCheckpoint(checkpoint: unknown, previous: CheckpointData | null = null): CheckpointData {
  const keys = Object.keys(emptyAgentCheckpoint());
  if (
    !checkpoint ||
    typeof checkpoint !== 'object' ||
    Array.isArray(checkpoint) ||
    Object.keys(checkpoint).length !== keys.length ||
    keys.some(key => !Object.hasOwn(checkpoint, key)) ||
    (checkpoint as RawCheckpoint).version !== 1 ||
    !Array.isArray((checkpoint as RawCheckpoint).sourceRefs) ||
    ((checkpoint as RawCheckpoint).sourceRefs as unknown[]).length > 128
  ) {
    invalid('执行检查点结构无效。');
  }
  for (const [key, maximum] of [
    ['nextRound', 8],
    ['totalTools', 14],
    ['noProgressRounds', 4],
    ['handledAttemptOrdinal', 16]
  ] as const) {
    if (
      !Number.isSafeInteger((checkpoint as RawCheckpoint)[key]) ||
      ((checkpoint as RawCheckpoint)[key] as number) < 0 ||
      ((checkpoint as RawCheckpoint)[key] as number) > maximum
    )
      invalid('执行检查点计数无效。');
  }
  for (const key of ['initialSearchDone', 'searchTruncated', 'searchFallback', 'forceAnswer'] as const) {
    if (typeof (checkpoint as RawCheckpoint)[key] !== 'boolean') invalid('执行检查点状态无效。');
  }
  for (const key of ['externalContext', 'toolFeedback'] as const) {
    if (
      typeof (checkpoint as RawCheckpoint)[key] !== 'string' ||
      ((checkpoint as RawCheckpoint)[key] as string).length > 3000
    )
      invalid('执行检查点上下文过长。');
  }
  if (
    previous &&
    ((checkpoint as CheckpointData).nextRound < previous.nextRound ||
      (checkpoint as CheckpointData).totalTools < previous.totalTools ||
      (checkpoint as CheckpointData).handledAttemptOrdinal < previous.handledAttemptOrdinal ||
      (previous.initialSearchDone && !(checkpoint as CheckpointData).initialSearchDone))
  )
    invalid('恢复不能重置模型或工具计数。');
  // 只完成外形校验；sourceRefs元素仍是外部原值，完整校验在conversation AJV入口。
  return structuredClone(checkpoint) as CheckpointData;
}

export function validateDurableModelResult(result: unknown): DurableModelResult {
  if (
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    typeof (result as RawModelResult).content !== 'string' ||
    ((result as RawModelResult).content as string).length > 120000 ||
    !Array.isArray((result as RawModelResult).toolCalls) ||
    ((result as RawModelResult).toolCalls as unknown[]).length > 2 ||
    typeof (result as RawModelResult).finishReason !== 'string' ||
    typeof (result as RawModelResult).truncated !== 'boolean' ||
    typeof (result as RawModelResult).refused !== 'boolean' ||
    JSON.stringify(result).length > 256000
  ) {
    invalid('持久模型响应结构无效。');
  }
  for (const call of (result as RawModelResult).toolCalls as (RawToolCall | null | undefined)[]) {
    if (
      !call ||
      typeof call.id !== 'string' ||
      !call.id ||
      call.id.length > 128 ||
      typeof call.name !== 'string' ||
      !call.name ||
      call.name.length > 128 ||
      !call.arguments ||
      typeof call.arguments !== 'object' ||
      Array.isArray(call.arguments)
    )
      invalid('持久工具请求无效。');
  }
  return structuredClone(result) as DurableModelResult;
}

/** 不确定发送须由用户显式重试；存在响应的 unknown 只代表费用未知。 */
export function assertResumableAttempts(
  attempts: readonly AttemptView[],
  checkpoint?: Pick<CheckpointData, 'handledAttemptOrdinal'> | null
) {
  const handled = checkpoint?.handledAttemptOrdinal ?? 0;
  if (attempts.some(attempt => attempt.ordinal > handled && attempt.responseRejectedCode)) {
    throw Object.assign(new Error('模型响应已验证拒绝，请显式重试。'), { code: 'AI_RESPONSE_REJECTED' });
  }
  if (
    attempts.some(
      attempt =>
        attempt.ordinal > handled &&
        (attempt.status === 'sent' || (['settled', 'unknown'].includes(attempt.status) && !attempt.modelResult))
    )
  ) {
    throw Object.assign(new Error('模型发送结果未确定，请显式重试；继续不会自动重发。'), {
      code: 'AI_DELIVERY_UNCERTAIN'
    });
  }
}

/** 显式重试的跳过与领取须同事务提交，避免领取后崩溃丢失验证拒绝状态。 */
export function retryRejectedResponses(
  attempts: readonly AttemptView[],
  checkpoint: CheckpointData | null | undefined,
  toolCount: number
) {
  const next = structuredClone(checkpoint ?? emptyAgentCheckpoint());
  next.totalTools = Math.max(next.totalTools, toolCount);
  for (const attempt of attempts
    .filter(row => row.ordinal > next.handledAttemptOrdinal && row.modelResult)
    .sort((a, b) => a.ordinal - b.ordinal)) {
    if (!attempt.responseRejectedCode) break;
    next.nextRound += 1;
    next.handledAttemptOrdinal = attempt.ordinal;
  }
  if (next.nextRound >= 4)
    throw Object.assign(new Error('本轮模型轮次已达到上限，请提交新任务。'), { code: 'AI_AGENT_LIMIT' });
  return validateAgentCheckpoint(next, checkpoint);
}

export function sameDurableModelResult(left: object, right: object) {
  return hashRecord(left) === hashRecord(right);
}

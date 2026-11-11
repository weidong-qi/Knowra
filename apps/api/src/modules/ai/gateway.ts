import type { GatewayOptions } from './boundary-types.ts';
import type { ProviderRequest, ProviderRequestTool } from './infrastructure/providers/deepseek-adapter.ts';

export interface GatewayRequest extends Omit<ProviderRequest, 'tools'> {
  tools?: ProviderRequestTool[];
  credentialRef?: string;
  budgetAttemptId?: string;
  verifyBeforeSend?: () => unknown;
  onSend?: () => void;
  expiresAt?: number;
}
export type GatewayStreamEvent =
  { type: 'delta'; content: string } | { type: 'result'; result: ReturnType<typeof normalize> };

interface RawToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}
// 供应商线格式的读取视图；保留以下运行校验及未校验元数据的原值透传。
interface RawResponse {
  choices?: {
    finish_reason: string;
    message: {
      content: string | null;
      tool_calls?: RawToolCall[];
      refusal?: unknown;
    };
  }[];
  model?: string | null;
  id?: string | null;
  usage?: { prompt_tokens: number; completion_tokens: number; prompt_cache_hit_tokens: number };
}
interface PreparedRequest extends ProviderRequest {
  tools: ProviderRequestTool[];
  maxTokens: number;
  format: 'text' | 'json';
}

const TOOL_NAMES = new Set([
  'notes_search',
  'notes_read',
  'folders_list',
  'tags_list',
  'web_search',
  'notes_create',
  'notes_append',
  'notes_propose_patch',
  'notes_propose_organize',
  'annotations_list',
  'knowledge_propose',
  'notes_list'
]);

export class AiGatewayError extends Error {
  code: string;
  retryable: boolean;
  httpStatus: number | null;
  constructor(
    code: string,
    message: string,
    { retryable = false, httpStatus = null }: { retryable?: boolean; httpStatus?: number | null } = {}
  ) {
    super(message);
    this.name = 'AiGatewayError';
    this.code = code;
    this.retryable = retryable;
    this.httpStatus = httpStatus;
  }
}

/** 仅供受信 worker 调用；预算服务未注入前真实供应商调用默认关闭。 */
export function createAiGateway({ adapter, resolveCredential, authorizePaidCall = async () => false }: GatewayOptions) {
  if (!adapter || typeof adapter.complete !== 'function' || typeof adapter.stream !== 'function') {
    throw new TypeError('AI adapter is required');
  }
  return {
    capabilities: () => adapter.capabilities(),
    async complete(request: GatewayRequest) {
      const prepared = await prepare(request);
      const control = {
        verifyBeforeSend: request.verifyBeforeSend,
        onSend: request.onSend,
        expiresAt: request.expiresAt
      };
      // 有队列的适配器在出队后复核；控制回调只留在宿主，不进入供应商载荷或 IPC。
      if (adapter.deferredSendValidation !== true) {
        if (typeof control.verifyBeforeSend === 'function') await control.verifyBeforeSend();
        control.onSend?.();
      }
      return normalize(await adapter.complete(prepared, control), prepared, adapter.provider);
    },
    async *stream(request: GatewayRequest): AsyncGenerator<GatewayStreamEvent, void, void> {
      const prepared = await prepare(request);
      if (typeof request.verifyBeforeSend === 'function') await request.verifyBeforeSend();
      let resultReceived = false;
      for await (const event of adapter.stream(prepared)) {
        if (event?.type === 'delta' && typeof event.content === 'string') {
          yield { type: 'delta', content: event.content };
        } else if (event?.type === 'result' && !resultReceived) {
          resultReceived = true;
          yield { type: 'result', result: normalize(event.result, prepared, adapter.provider) };
        } else throw new AiGatewayError('AI_STREAM_INVALID', '模型流响应无效。');
      }
      if (!resultReceived) throw new AiGatewayError('AI_STREAM_INCOMPLETE', '模型流未正常结束。', { retryable: true });
    }
  };

  async function prepare(request: GatewayRequest) {
    if (request?.signal?.aborted) throw new AiGatewayError('AI_CANCELLED', '模型请求已取消。');
    const input = normalizeAiRequest(request);
    if (adapter.provider === 'mock') return input;
    if (!request?.credentialRef || typeof resolveCredential !== 'function') {
      throw new AiGatewayError('AI_CREDENTIAL_UNAVAILABLE', '模型凭据不可用。');
    }
    if ((await authorizePaidCall(request)) !== true) {
      throw new AiGatewayError('AI_BUDGET_NOT_AUTHORIZED', '模型费用尚未预留，不能调用供应商。');
    }
    const credential = await resolveCredential(request.credentialRef);
    if (
      !credential ||
      typeof credential.apiKey !== 'string' ||
      !credential.apiKey ||
      !/^[a-zA-Z0-9._-]{1,80}$/.test(credential.modelId)
    ) {
      throw new AiGatewayError('AI_CREDENTIAL_UNAVAILABLE', '模型凭据不可用。');
    }
    if (request.modelId && request.modelId !== credential.modelId) {
      throw new AiGatewayError('AI_MODEL_CHANGED', '模型配置已变更，请重新开始任务。');
    }
    return { ...input, apiKey: credential.apiKey, modelId: credential.modelId };
  }
}

export function normalizeAiRequest(input: unknown): PreparedRequest {
  const value = input as GatewayRequest;
  if (!value || !Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > 32) {
    throw new AiGatewayError('AI_REQUEST_INVALID', '模型消息无效。');
  }
  const messages = value.messages.map(message => {
    if (
      !message ||
      !['system', 'user', 'assistant', 'tool'].includes(message.role) ||
      typeof message.content !== 'string' ||
      message.content.length > 120000
    ) {
      throw new AiGatewayError('AI_REQUEST_INVALID', '模型消息无效。');
    }
    if (message.role === 'tool' && (typeof message.tool_call_id !== 'string' || !message.tool_call_id)) {
      throw new AiGatewayError('AI_REQUEST_INVALID', '工具结果缺少调用 ID。');
    }
    return message.role === 'tool'
      ? { role: 'tool', content: message.content, tool_call_id: message.tool_call_id }
      : { role: message.role, content: message.content };
  });
  const maxTokens = value.maxTokens ?? 512;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 20000)
    throw new AiGatewayError('AI_REQUEST_INVALID', '输出 token 上限无效。');
  const format = value.format ?? 'text';
  if (!['text', 'json'].includes(format)) throw new AiGatewayError('AI_REQUEST_INVALID', '输出格式无效。');
  if (format === 'json' && !messages.some(message => /json/i.test(message.content))) {
    throw new AiGatewayError('AI_REQUEST_INVALID', 'JSON 输出请求需在提示词中明确指定 JSON。');
  }
  const tools = value.tools ?? [];
  if (
    !Array.isArray(tools) ||
    tools.length > 12 ||
    tools.some(
      tool =>
        !tool ||
        !TOOL_NAMES.has(tool.name) ||
        !tool.parameters ||
        typeof tool.parameters !== 'object' ||
        Array.isArray(tool.parameters)
    )
  ) {
    throw new AiGatewayError('AI_REQUEST_INVALID', '模型工具定义无效。');
  }
  if (new Set(tools.map(tool => tool.name)).size !== tools.length)
    throw new AiGatewayError('AI_REQUEST_INVALID', '模型工具名称重复。');
  return {
    messages,
    maxTokens,
    format,
    tools: tools.map(tool => ({
      name: tool.name,
      description: String(tool.description ?? '').slice(0, 500),
      parameters: tool.parameters
    })),
    signal: value.signal
  };
}

function normalize(input: unknown, request: PreparedRequest, provider: string) {
  const raw = input as RawResponse;
  const choice = raw?.choices?.[0];
  if (!choice || typeof choice.finish_reason !== 'string' || !choice.message || !Array.isArray(raw.choices)) {
    throw new AiGatewayError('AI_RESPONSE_INVALID', '模型响应结构无效。');
  }
  const finishReason = choice.finish_reason;
  if (
    !['stop', 'length', 'content_filter', 'tool_calls', 'insufficient_system_resource', 'aborted'].includes(
      finishReason
    )
  ) {
    throw new AiGatewayError('AI_RESPONSE_INVALID', '模型结束状态无效。');
  }
  const content = choice.message.content;
  if (content !== null && typeof content !== 'string')
    throw new AiGatewayError('AI_RESPONSE_INVALID', '模型文本无效。');
  const toolCalls = (choice.message.tool_calls ?? []).map(call => {
    if (
      call?.type !== 'function' ||
      !TOOL_NAMES.has(call.function?.name) ||
      !request.tools.some(tool => tool.name === call.function.name)
    ) {
      throw new AiGatewayError('AI_TOOL_INVALID', '模型请求了未授权工具。');
    }
    let args: unknown;
    try {
      args = JSON.parse(call.function.arguments);
    } catch {
      throw new AiGatewayError('AI_TOOL_ARGUMENTS_INVALID', '模型工具参数不是有效 JSON。');
    }
    if (!args || typeof args !== 'object' || Array.isArray(args))
      throw new AiGatewayError('AI_TOOL_ARGUMENTS_INVALID', '模型工具参数无效。');
    return { id: call.id, name: call.function.name, arguments: args as Record<string, unknown> };
  });
  const truncated = finishReason === 'length';
  const refused =
    finishReason === 'content_filter' ||
    (typeof choice.message.refusal === 'string' && Boolean(choice.message.refusal));
  let json: Record<string, unknown> | null = null;
  if (request.format === 'json' && !truncated && !refused && finishReason === 'stop') {
    try {
      json = parseJsonContent(content) as Record<string, unknown> | null;
    } catch {
      // 带工具的请求没有强制 JSON 模式；模型直接用自然语言作答时，按无引用的回答处理，而不是让整轮失败。
      if (!request.tools.length || typeof content !== 'string' || !content.trim())
        throw new AiGatewayError('AI_JSON_INVALID', '模型未返回有效 JSON。');
      json = { answer: content.trim(), citations: [] };
    }
    if (!json || typeof json !== 'object' || Array.isArray(json))
      throw new AiGatewayError('AI_JSON_INVALID', '模型 JSON 结果无效。');
  }
  const usage =
    raw.usage &&
    Number.isSafeInteger(raw.usage.prompt_tokens) &&
    raw.usage.prompt_tokens >= 0 &&
    Number.isSafeInteger(raw.usage.completion_tokens) &&
    raw.usage.completion_tokens >= 0
      ? {
          inputTokens: raw.usage.prompt_tokens,
          outputTokens: raw.usage.completion_tokens,
          unknown: false,
          // DeepSeek 额外返回的缓存命中数，仅用于用量展示；缺失或越界时记为未知，不影响计费口径。
          cacheHitTokens:
            Number.isSafeInteger(raw.usage.prompt_cache_hit_tokens) &&
            raw.usage.prompt_cache_hit_tokens >= 0 &&
            raw.usage.prompt_cache_hit_tokens <= raw.usage.prompt_tokens
              ? raw.usage.prompt_cache_hit_tokens
              : null
        }
      : { inputTokens: null, outputTokens: null, unknown: true };
  return {
    provider,
    modelId: raw.model ?? null,
    requestId: raw.id ?? null,
    content: content ?? '',
    json,
    toolCalls,
    finishReason,
    truncated,
    refused,
    usage
  };
}

/** JSON 模式偶尔带 ```json 围栏或前后说明文字；先严格解析，失败再截取最外层对象。 */
function parseJsonContent(content: string | null): unknown {
  try {
    return JSON.parse(content as string);
  } catch (error) {
    const start = content?.indexOf('{') ?? -1,
      end = content?.lastIndexOf('}') ?? -1;
    if (start < 0 || end <= start) throw error;
    return JSON.parse(content!.slice(start, end + 1));
  }
}

import { AiGatewayError } from '../../gateway.js';
import { serializedDeepSeekPayload } from '../../outbound-payload.ts';

const ENDPOINT = 'https://api.deepseek.com/chat/completions';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export function createDeepSeekAdapter({ fetchImpl = fetch, timeoutMs = 90000 } = {}) {
  return {
    provider: 'deepseek',
    capabilities: () => ({
      provider: 'deepseek',
      protocol: 'chat-completions',
      advertised: {
        text: true,
        streaming: true,
        toolCalls: true,
        jsonObject: true,
        cancel: true,
        usage: true
      },
      verified: false
    }),
    async complete(request) {
      const response = await send(request, false);
      const body = await boundedText(response);
      try {
        return JSON.parse(body);
      } catch {
        throw new AiGatewayError('AI_RESPONSE_INVALID', 'DeepSeek 返回的响应不是有效 JSON。');
      }
    },
    async *stream(request) {
      const response = await send(request, true);
      if (!response.body) throw new AiGatewayError('AI_STREAM_INVALID', 'DeepSeek 未返回流。');
      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      const calls = new Map();
      let buffer = '';
      let bytes = 0;
      let content = '';
      let finishReason = null;
      let usage = null;
      let model = null;
      let id = null;
      let done = false;
      try {
        while (!done) {
          const next = await reader.read();
          if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > MAX_RESPONSE_BYTES)
            throw new AiGatewayError('AI_RESPONSE_TOO_LARGE', 'DeepSeek 流响应超过上限。');
          buffer += decoder.decode(next.value, { stream: true });
          let frame;
          while ((frame = takeFrame(buffer)) !== null) {
            buffer = buffer.slice(frame.length);
            const payload = frame.text
              .split(/\r?\n/)
              .filter(line => line.startsWith('data:'))
              .map(line => line.slice(5).trimStart())
              .join('\n');
            if (!payload) continue;
            if (payload === '[DONE]') {
              done = true;
              break;
            }
            let chunk;
            try {
              chunk = JSON.parse(payload);
            } catch {
              throw new AiGatewayError('AI_STREAM_INVALID', 'DeepSeek 流事件无效。');
            }
            id ??= chunk.id ?? null;
            model ??= chunk.model ?? null;
            if (chunk.usage) usage = chunk.usage;
            const choice = chunk.choices?.[0];
            if (!choice) continue;
            if (choice.finish_reason) finishReason = choice.finish_reason;
            const delta = choice.delta ?? {};
            if (typeof delta.content === 'string' && delta.content) {
              content += delta.content;
              yield { type: 'delta', content: delta.content };
            }
            for (const call of delta.tool_calls ?? []) {
              if (!Number.isInteger(call.index) || call.index < 0 || call.index > 7)
                throw new AiGatewayError('AI_STREAM_INVALID', '模型工具流索引无效。');
              const current = calls.get(call.index) ?? {
                id: '',
                type: 'function',
                function: { name: '', arguments: '' }
              };
              current.id += call.id ?? '';
              current.function.name += call.function?.name ?? '';
              current.function.arguments += call.function?.arguments ?? '';
              calls.set(call.index, current);
            }
          }
        }
      } catch (error) {
        if (error instanceof AiGatewayError) throw error;
        if (request.signal?.aborted) throw new AiGatewayError('AI_CANCELLED', '模型请求已取消。');
        throw new AiGatewayError('AI_PROVIDER_UNAVAILABLE', 'DeepSeek 流连接中断。', { retryable: true });
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      if (!done || !finishReason)
        throw new AiGatewayError('AI_STREAM_INCOMPLETE', 'DeepSeek 流未正常结束。', { retryable: true });
      yield {
        type: 'result',
        result: {
          id,
          model,
          usage,
          choices: [
            {
              finish_reason: finishReason,
              message: { content, tool_calls: [...calls].sort((a, b) => a[0] - b[0]).map(([, call]) => call) }
            }
          ]
        }
      };
    }
  };

  async function send(request, stream) {
    const body = serializedDeepSeekPayload(request, { stream });
    let response;
    try {
      response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        redirect: 'error',
        headers: { Authorization: `Bearer ${request.apiKey}`, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(request.signal ? [request.signal] : [])])
      });
    } catch {
      if (request.signal?.aborted) throw new AiGatewayError('AI_CANCELLED', '模型请求已取消。');
      throw new AiGatewayError('AI_PROVIDER_UNAVAILABLE', '无法连接 DeepSeek。', { retryable: true });
    }
    if (!response.ok) throw providerError(response.status);
    return response;
  }
}

function providerError(status) {
  if (status === 401 || status === 403)
    return new AiGatewayError('AI_KEY_REJECTED', 'DeepSeek 拒绝了 API Key。', { httpStatus: status });
  if (status === 402)
    return new AiGatewayError('AI_PROVIDER_BALANCE', 'DeepSeek 账户余额不足。', { httpStatus: status });
  if (status === 429)
    return new AiGatewayError('AI_RATE_LIMITED', 'DeepSeek 请求过于频繁。', { retryable: true, httpStatus: status });
  if (status === 400 || status === 422)
    return new AiGatewayError('AI_PROVIDER_REQUEST_INVALID', 'DeepSeek 拒绝了模型请求参数。', { httpStatus: status });
  return new AiGatewayError('AI_PROVIDER_UNAVAILABLE', 'DeepSeek 暂时无法处理请求。', {
    retryable: status >= 500,
    httpStatus: status
  });
}

async function boundedText(response) {
  if (!response.body) throw new AiGatewayError('AI_RESPONSE_INVALID', 'DeepSeek 返回了空响应。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new AiGatewayError('AI_RESPONSE_TOO_LARGE', 'DeepSeek 响应超过上限。');
      text += decoder.decode(next.value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    if (error instanceof AiGatewayError) throw error;
    throw new AiGatewayError('AI_PROVIDER_UNAVAILABLE', 'DeepSeek 响应读取失败。', { retryable: true });
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function takeFrame(buffer) {
  const match = /\r?\n\r?\n/.exec(buffer);
  return match ? { text: buffer.slice(0, match.index), length: match.index + match[0].length } : null;
}

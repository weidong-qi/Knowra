import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseBody } from '../../http/request.ts';
import { sendJson } from '../../http/response.ts';
import { AppError, createAppError } from '../../errors/app-error.js';
import type { createAiTranslationService } from './translation-service.ts';

interface TranslationRouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: Pick<URL, 'pathname'>;
  translation?: Pick<ReturnType<typeof createAiTranslationService>, 'translate'> | null;
  unavailableReason?: string | null;
}

const CONFLICT = new Set([
  'AI_NOT_CONFIGURED',
  'AI_EGRESS_NOT_READY',
  'AI_PRICE_UNAVAILABLE',
  'AI_PAUSED_BY_USER',
  'AI_BUDGET_DAY_CHANGED',
  'AI_LATE_RESULT',
  'AI_CREDENTIAL_STALE',
  'AI_MODEL_CHANGED',
  'MODEL_CREDENTIAL_STALE'
]);
const BUDGET = new Set(['AI_DAILY_BUDGET_EXCEEDED', 'AI_MONTHLY_BUDGET_EXCEEDED', 'AI_JOB_BUDGET_EXCEEDED']);
const INVALID = new Set(['AI_TRANSLATION_INVALID', 'AI_TRANSLATION_TOO_LONG', 'AI_REQUEST_LIMIT']);

function statusFor(code: string) {
  if (INVALID.has(code)) return 422;
  if (CONFLICT.has(code)) return 409;
  if (BUDGET.has(code)) return 429;
  if (code === 'AI_CANCELLED') return 499;
  if (code.startsWith('AI_BUDGET_')) return 503;
  return 502;
}

/** POST /api/ai/translate：同步返回译文；客户端断开时中止模型请求。 */
export async function handleAiTranslationRoute({
  request,
  response,
  url,
  translation,
  unavailableReason
}: TranslationRouteContext) {
  if (url.pathname !== '/api/ai/translate') return false;
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') throw createAppError('METHOD_NOT_ALLOWED', '仅支持 POST。', 405);
  if (request.headers['x-knowra-ai-translate'] !== '1')
    throw createAppError('AI_REQUEST_REJECTED', '翻译请求无效。', 403);
  if (!translation) throw createAppError('AI_GENERATION_UNAVAILABLE', unavailableReason || 'AI 翻译当前不可用。', 503);
  const body = await parseBody(request, { limitBytes: 32 * 1024 });
  const controller = new AbortController();
  const abort = () => {
    if (!response.writableEnded) controller.abort();
  };
  response.on('close', abort);
  try {
    const data = await translation.translate(body as { text?: unknown }, { signal: controller.signal });
    sendJson(response, 200, { data });
    return true;
  } catch (error) {
    if (error instanceof AppError) throw error;
    const code = (error as { code?: unknown })?.code;
    if (typeof code === 'string' && /^(AI|MODEL)_[A-Z0-9_]{1,64}$/.test(code))
      throw createAppError(code, (error as Error).message || '翻译失败，请重试。', statusFor(code));
    throw error;
  } finally {
    response.off('close', abort);
  }
}

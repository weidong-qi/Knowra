import { parseBody } from '../../http/request.ts';
import { sendJson } from '../../http/response.ts';
import { createAppError } from '../../errors/app-error.js';

/** 云端是 Web 与 Mac 的唯一预算权威；所有请求仍受部署层 Basic Auth 保护。 */
export async function handleBudgetRoute({ request, response, url, authority, policy = null }) {
  if (!url.pathname.startsWith('/api/ai/budget/')) return false;
  if (!authority) throw createAppError('AI_BUDGET_UNAVAILABLE', '预算权威不可用。', 503);
  response.setHeader('Cache-Control', 'no-store');
  if (request.headers['x-knowra-ai-budget'] !== '1')
    throw createAppError('AI_BUDGET_REQUEST_REJECTED', '预算请求无效。', 403);
  const accountRef = 'deepseek-primary';
  try {
    if (request.method === 'GET' && url.pathname === '/api/ai/budget/status') {
      // 状态与预留都按服务端保存的预算设置执行，客户端无法指定或放宽上限。
      sendJson(response, 200, {
        data: await authority.status(accountRef, undefined, policy ? (await policy.view()).limits : undefined)
      });
      return true;
    }
    if (request.method === 'POST' && url.pathname === '/api/ai/budget/reserve') {
      const input = await parseBody(request, { limitBytes: 2048 });
      const limits = policy ? (await policy.snapshot()).limits : undefined;
      // 只描述对象展开读取的外部属性；保留原生对标量、null 的展开语义。
      sendJson(response, 200, {
        data: await authority.reserve({
          .../** @type {Record<string, unknown>} */ (input),
          day: undefined,
          limits,
          accountRef
        })
      });
      return true;
    }
    if (request.method === 'POST' && url.pathname === '/api/ai/budget/settle') {
      const input = await parseBody(request, { limitBytes: 2048 });
      sendJson(response, 200, {
        data: await authority.settle({ .../** @type {Record<string, unknown>} */ (input), accountRef })
      });
      return true;
    }
  } catch (error) {
    if (error.code?.startsWith('AI_BALANCE_') || error.code === 'AI_PAUSED_BY_USER')
      throw createAppError(error.code, error.message, 409);
    if (
      error.code?.startsWith('AI_BUDGET_') ||
      error.code?.startsWith('AI_DAILY_') ||
      error.code?.startsWith('AI_MONTHLY_') ||
      error.code?.startsWith('AI_JOB_')
    ) {
      throw createAppError(
        error.code,
        error.message,
        error.code.endsWith('EXCEEDED') || error.code.endsWith('CONFLICT') ? 409 : 422
      );
    }
    throw error;
  }
  return false;
}

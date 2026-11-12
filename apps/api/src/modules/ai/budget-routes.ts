import type { IncomingMessage, ServerResponse } from 'node:http';
import type { createJsonBudgetAuthority } from './budget-ledger.ts';
type BudgetRoutePort = Pick<ReturnType<typeof createJsonBudgetAuthority>, 'reserve' | 'settle' | 'status'>;
import type { createBudgetPolicy } from './budget-policy.ts';
interface BudgetRouteContext {
  request: IncomingMessage;
  response: Pick<ServerResponse, 'setHeader' | 'writeHead' | 'end'>;
  url: URL;
  authority?: BudgetRoutePort | null;
  policy?: Pick<ReturnType<typeof createBudgetPolicy>, 'view' | 'snapshot'> | null;
}

import { parseBody } from '../../http/request.ts';
import { sendJson } from '../../http/response.ts';
import { type AppError, createAppError } from '../../errors/app-error.ts';

/** 云端是 Web 与 Mac 的唯一预算权威；所有请求仍受部署层 Basic Auth 保护。 */
export async function handleBudgetRoute({
  request,
  response,
  url,
  authority,
  policy = null
}: BudgetRouteContext): Promise<boolean> {
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
          ...(input as Record<string, unknown>),
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
        data: await authority.settle({ ...(input as Record<string, unknown>), accountRef })
      });
      return true;
    }
  } catch (error) {
    if ((error as AppError).code?.startsWith('AI_BALANCE_') || (error as AppError).code === 'AI_PAUSED_BY_USER')
      throw createAppError((error as AppError).code, (error as AppError).message, 409);
    if (
      (error as AppError).code?.startsWith('AI_BUDGET_') ||
      (error as AppError).code?.startsWith('AI_DAILY_') ||
      (error as AppError).code?.startsWith('AI_MONTHLY_') ||
      (error as AppError).code?.startsWith('AI_JOB_')
    ) {
      throw createAppError(
        (error as AppError).code,
        (error as AppError).message,
        (error as AppError).code.endsWith('EXCEEDED') || (error as AppError).code.endsWith('CONFLICT') ? 409 : 422
      );
    }
    throw error;
  }
  return false;
}

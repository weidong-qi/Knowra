import type { IncomingMessage, ServerResponse } from 'node:http';
import type { createAiAssistantService } from './assistant-service.ts';
type AssistantRoutePort = Pick<
  ReturnType<typeof createAiAssistantService>,
  | 'allowRule'
  | 'balance'
  | 'budgetAlerts'
  | 'budgetSettings'
  | 'cancel'
  | 'get'
  | 'list'
  | 'markAlerts'
  | 'pauseRule'
  | 'preview'
  | 'resolveUnknown'
  | 'resumeRule'
  | 'saveBudgetSettings'
  | 'start'
  | 'status'
  | 'usage'
  | 'usageExport'
>;
interface AssistantRouteContext {
  request: IncomingMessage;
  response: Pick<ServerResponse, 'setHeader' | 'writeHead' | 'end'>;
  url: URL;
  assistant?: AssistantRoutePort | null;
}
import { parseBody } from '../../http/request.ts';
import { sendJson } from '../../http/response.ts';
import { AppError, createAppError } from '../../errors/app-error.ts';

export async function handleAssistantRoute({
  request,
  response,
  url,
  assistant
}: AssistantRouteContext): Promise<boolean> {
  if (!url.pathname.startsWith('/api/ai/assistant')) return false;
  if (!assistant) throw createAppError('AI_ASSISTANT_UNAVAILABLE', '助手服务不可用。', 503);
  response.setHeader('Cache-Control', 'no-store');
  const root = '/api/ai/assistant';
  const jobMatch = url.pathname.match(/^\/api\/ai\/assistant\/jobs\/([^/]+)(\/cancel)?$/);
  try {
    if (request.method === 'GET' && url.pathname === `${root}/status`) {
      sendJson(response, 200, { data: await assistant.status() });
      return true;
    }
    if (request.method === 'GET' && url.pathname === `${root}/usage/export`) {
      const csv = await assistant.usageExport();
      response.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="knowra-ai-usage.csv"',
        'X-Content-Type-Options': 'nosniff'
      });
      response.end(csv);
      return true;
    }
    if (request.method === 'GET' && url.pathname === `${root}/usage`) {
      sendJson(response, 200, { data: await assistant.usage() });
      return true;
    }
    if (request.method === 'GET' && url.pathname === `${root}/budget-settings`) {
      sendJson(response, 200, { data: await assistant.budgetSettings() });
      return true;
    }
    if (request.method === 'GET' && url.pathname === `${root}/alerts`) {
      sendJson(response, 200, { data: await assistant.budgetAlerts() });
      return true;
    }
    if (request.method === 'GET' && url.pathname === `${root}/balance`) {
      sendJson(response, 200, { data: await assistant.balance() });
      return true;
    }
    if (request.method === 'GET' && url.pathname === `${root}/jobs`) {
      sendJson(response, 200, { data: await assistant.list(url.searchParams.get('spaceId')) });
      return true;
    }
    if (request.method === 'GET' && jobMatch && !jobMatch[2]) {
      sendJson(response, 200, { data: await assistant.get(decodeURIComponent(jobMatch[1])) });
      return true;
    }
    if (request.method === 'POST') {
      if (request.headers['x-knowra-ai-assistant'] !== '1') {
        throw createAppError('AI_REQUEST_REJECTED', '助手请求无效。', 403);
      }
      if (url.pathname === `${root}/budget-settings`) {
        sendJson(response, 200, {
          data: await assistant.saveBudgetSettings(await parseBody(request, { limitBytes: 2048 }))
        });
        return true;
      }
      if (url.pathname === `${root}/usage/resolve`) {
        sendJson(response, 200, {
          data: await assistant.resolveUnknown(
            (await parseBody(request, { limitBytes: 512 })) as Parameters<AssistantRoutePort['resolveUnknown']>[0]
          )
        });
        return true;
      }
      if (url.pathname === `${root}/alerts/mark`) {
        sendJson(response, 200, {
          data: await assistant.markAlerts(
            (await parseBody(request, { limitBytes: 2048 })) as Parameters<AssistantRoutePort['markAlerts']>[0]
          )
        });
        return true;
      }
      if (url.pathname === `${root}/alerts/pause`) {
        sendJson(response, 200, {
          data: await assistant.pauseRule(
            (await parseBody(request, { limitBytes: 256 })) as Parameters<AssistantRoutePort['pauseRule']>[0]
          )
        });
        return true;
      }
      if (url.pathname === `${root}/alerts/resume`) {
        sendJson(response, 200, {
          data: await assistant.resumeRule(
            (await parseBody(request, { limitBytes: 256 })) as Parameters<AssistantRoutePort['resumeRule']>[0]
          )
        });
        return true;
      }
      if (url.pathname === `${root}/alerts/allow`) {
        sendJson(response, 200, {
          data: await assistant.allowRule(
            (await parseBody(request, { limitBytes: 256 })) as Parameters<AssistantRoutePort['allowRule']>[0]
          )
        });
        return true;
      }
      if (url.pathname === `${root}/balance/refresh`) {
        sendJson(response, 200, { data: await assistant.balance({ refresh: true }) });
        return true;
      }
      if (url.pathname === `${root}/preview`) {
        sendJson(response, 200, {
          data: await assistant.preview(
            (await parseBody(request, { limitBytes: 8192 })) as Parameters<AssistantRoutePort['preview']>[0]
          )
        });
        return true;
      }
      if (url.pathname === `${root}/jobs`) {
        sendJson(response, 202, {
          data: await assistant.start(
            (await parseBody(request, { limitBytes: 2048 })) as Parameters<AssistantRoutePort['start']>[0]
          )
        });
        return true;
      }
      if (jobMatch?.[2] === '/cancel') {
        sendJson(response, 200, { data: await assistant.cancel(decodeURIComponent(jobMatch[1])) });
        return true;
      }
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    if ((error as AppError).code?.startsWith('AI_')) {
      const status = ['AI_JOB_NOT_FOUND'].includes((error as AppError).code)
        ? 404
        : (error as AppError).code === 'AI_PRIVATE_STORAGE_UNAVAILABLE'
          ? 503
          : [
                'AI_GENERATION_UNAVAILABLE',
                'AI_PREVIEW_EXPIRED',
                'AI_APPROVAL_STALE',
                'AI_CREDENTIAL_STALE',
                'AI_SOURCE_STALE',
                'AI_NOT_CONFIGURED',
                'AI_BALANCE_STALE',
                'AI_PAUSED_BY_USER',
                'AI_BUDGET_ALERTS_INVALID'
              ].includes((error as AppError).code)
            ? 409
            : ['AI_BUDGET_UNAVAILABLE', 'AI_BALANCE_UNSUPPORTED', 'AI_BUDGET_SETTINGS_UNAVAILABLE'].includes(
                  (error as AppError).code
                )
              ? 503
              : (error as AppError).code === 'AI_BALANCE_UNAVAILABLE'
                ? 502
                : (error as AppError).code === 'AI_BALANCE_STORAGE_INVALID'
                  ? 500
                  : (error as AppError).code === 'AI_BUDGET_NOT_FOUND'
                    ? 404
                    : (error as AppError).code === 'AI_BUDGET_CONFLICT'
                      ? 409
                      : 422;
      throw createAppError((error as AppError).code, (error as AppError).message, status);
    }
    throw error;
  }
  return false;
}

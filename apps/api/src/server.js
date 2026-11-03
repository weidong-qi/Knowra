import { createTaskWorkspaceService } from './modules/task-workspaces/service.ts';
import { handleTaskWorkspaceRoute } from './modules/task-workspaces/routes.ts';
import { handleActionRoute } from './modules/ai/action-routes.js';
import { URL } from 'node:url';
import http from 'node:http';
import { applyCorsHeaders, handleCorsPreflight } from './http/cors.ts';
import { sendError, sendJson } from './http/response.ts';
import { handleStorageRoute } from './http/storage-routes.ts';
import { handleKnowledgeRoute } from './modules/knowledge/http/knowledge-routes.js';
import { AppError } from './errors/app-error.js';
import { handleSyncRoute } from './modules/sync/routes.ts';
import { handleModelSettingsRoute } from './modules/ai/model-settings-routes.ts';
import { handleAiFeatureRoute } from './modules/ai/feature-settings-routes.ts';
import { handleBudgetRoute } from './modules/ai/budget-routes.js';
import { createAiAssistantService } from './modules/ai/assistant-service.js';
import { handleAssistantRoute } from './modules/ai/assistant-routes.js';
import { handleAiAccessRoute } from './modules/ai/access-routes.js';
import { handleConversationRoute } from './modules/ai/conversation-routes.js';
import { handleConversationAttachmentRoute } from './modules/ai/conversation-attachment-routes.js';
import { handleAiJobRoute } from './modules/ai/job-routes.ts';
import { createKnowledgeExtractionHttpService } from './modules/ai/knowledge-extraction-http-service.ts';
import { aiRuntimeLifecycle } from './modules/ai/runtime-lifecycle.ts';
import { isWriteMethod, writeOriginDecision } from '@study-accelerator/shared/http-origin';

export function createServer({ appContext, cors = /** @type {{allowedOrigins?: string[]}} */ ({}), logger = console }) {
  const taskWorkspaces = appContext.taskWorkspaces ?? createTaskWorkspaceService({ store: null });
  const taskWorkspaceContext =
    appContext.taskWorkspaceContext ?? (() => ({ actor: { kind: 'user', id: 'unavailable' } }));
  const allowedOrigins = cors.allowedOrigins ?? [];
  const extraction = createKnowledgeExtractionHttpService({
    tasks: appContext.knowledgeExtractionTasks,
    location: appContext.aiLocation ?? 'server',
    logger
  });
  const assistant =
    appContext.ai && appContext.aiOwnerId
      ? createAiAssistantService({
          getRuntime: () => appContext.ai,
          ownerId: appContext.aiOwnerId,
          location: appContext.aiLocation ?? 'server',
          logger
        })
      : null;
  const aiLifecycle = aiRuntimeLifecycle(appContext.ai);
  const aiRecovery =
    appContext.aiLocation === 'local'
      ? Promise.resolve()
      : aiLifecycle
          .recover()
          .catch(error => logger.warn?.('AI task recovery failed', { code: error.code ?? 'AI_RECOVERY_FAILED' }));

  /** @type {http.Server & {closeAi?: typeof aiLifecycle.close}} */
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const { knowledge, storage } = appContext.http;

      applyCorsHeaders(response, request, allowedOrigins);
      if (handleCorsPreflight({ request, response, allowedOrigins })) {
        return;
      }
      if (isWriteMethod(request.method) && !writeOriginDecision(request, { allowedOrigins }).allowed) {
        sendError(response, 403, 'REQUEST_ORIGIN_FORBIDDEN', '写入请求来源不被允许');
        return;
      }

      if (request.method === 'GET' && url.pathname === '/') {
        sendJson(response, 200, {
          data: {
            name: '知境·Knowra API',
            health: '/api/health'
          }
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/health') {
        sendJson(response, 200, {
          data: {
            status: 'ok'
          }
        });
        return;
      }

      if (
        await handleTaskWorkspaceRoute({
          request,
          response,
          url,
          service: taskWorkspaces,
          context: taskWorkspaceContext
        })
      )
        return;

      if (await handleStorageRoute({ request, response, url, storage })) {
        return;
      }

      if (await handleSyncRoute({ request, response, url, sync: appContext.http.sync })) return;

      if (await handleModelSettingsRoute({ request, response, url, modelSettings: appContext.http.modelSettings }))
        return;
      if (await handleAiFeatureRoute({ request, response, url, features: appContext.http.aiFeatures })) return;
      if (
        await handleBudgetRoute({
          request,
          response,
          url,
          authority: appContext.http.aiBudget,
          policy: appContext.ai?.budgetPolicy ?? null
        })
      )
        return;
      if (await handleAiJobRoute({ request, response, url, extraction })) return;
      if (await handleAiAccessRoute({ request, response, url, access: appContext.ai?.access })) return;
      if (await handleActionRoute({ request, response, url, actions: appContext.ai?.actions })) return;
      if (url.pathname.startsWith('/api/ai/conversations/') && url.pathname.split('/')[5] === 'attachments')
        await aiRecovery;
      if (await handleConversationAttachmentRoute({ request, response, url, attachments: appContext.ai?.attachments }))
        return;
      if (await handleConversationRoute({ request, response, url, conversation: appContext.ai?.conversation })) return;
      if (url.pathname.startsWith('/api/ai/assistant')) await aiRecovery;
      if (url.pathname.startsWith('/api/ai/conversations')) await aiRecovery;
      if (await handleAssistantRoute({ request, response, url, assistant })) return;

      if (await handleKnowledgeRoute({ request, response, url, knowledge })) {
        return;
      }

      sendJson(response, 404, {
        error: {
          code: 'ROUTE_NOT_FOUND',
          message: 'Route not found'
        }
      });
    } catch (error) {
      if (error instanceof AppError) {
        sendError(response, error.statusCode, error.code, error.message);
        return;
      }

      if (request.url?.startsWith('/api/sync/'))
        logger.error?.('Sync request failed', { code: error.code ?? 'INTERNAL_SERVER_ERROR' });
      else logger.error?.('Unhandled request error', error);
      sendError(response, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
    }
  });
  // 原生 close/close 事件仍只表示网络关闭；持库宿主另等 closeAi 或 context.close。
  server.closeAi = aiLifecycle.close;
  return server;
}

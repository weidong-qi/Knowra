import { toQueryObject } from '../../../http/request.ts';
import { sendJson } from '../../../http/response.ts';
import type { ResponseWriter } from '../../../http/response.ts';
import type { QuerySource } from '../../../http/request.ts';
import type { WorkspaceQueryInput } from '../application/workspace-query-utils.ts';

/** 查询对象由 HTTP URL 的 searchParams.entries 创建。 */
export type WorkspaceRouteQuery = WorkspaceQueryInput &
  Record<PropertyKey, unknown> & {
    [Member in keyof typeof Object.prototype]: unknown;
  };

/** unknown 同时容纳同步值、Promise 与自定义 thenable，不承诺未验证响应 DTO。 */
export interface WorkspaceRouteKnowledge {
  getKnowledgeOverview: () => unknown;
  getTrainingOverview: () => unknown;
  listReviewQueue: (query: WorkspaceRouteQuery) => unknown;
}

export interface WorkspaceRouteContext {
  request: { method?: unknown };
  response: ResponseWriter;
  url: QuerySource & { pathname?: unknown };
  knowledge: WorkspaceRouteKnowledge;
}

export async function handleWorkspaceRoute({
  request,
  response,
  url,
  knowledge
}: WorkspaceRouteContext): Promise<boolean> {
  if (request.method !== 'GET') return false;

  if (url.pathname === '/api/knowledge/overview') {
    sendJson(response, 200, { data: await knowledge.getKnowledgeOverview() });
    return true;
  }

  if (url.pathname === '/api/knowledge/training-overview') {
    sendJson(response, 200, { data: await knowledge.getTrainingOverview() });
    return true;
  }

  if (url.pathname === '/api/knowledge/review-queue') {
    sendJson(response, 200, { data: await knowledge.listReviewQueue(toQueryObject(url)) });
    return true;
  }

  return false;
}

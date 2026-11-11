import { toQueryObject } from '../../../http/request.ts';
import { sendJson } from '../../../http/response.ts';
import { createAppError } from '../../../errors/app-error.ts';
import type { ResponseWriter } from '../../../http/response.ts';
import type { QuerySource } from '../../../http/request.ts';

export interface NoteVersionRouteParams {
  id: string;
}
export interface NoteVersionDetailRouteParams extends NoteVersionRouteParams {
  versionId: string;
}
export type NoteVersionRouteQuery = Record<PropertyKey, unknown> & {
  limit?: unknown;
  cursor?: unknown;
} & {
  [Member in keyof typeof Object.prototype]: unknown;
};

/** 函数属性保留严格参数逆变；同步、异步与历史响应均保持 unknown。 */
export interface NoteVersionRouteKnowledge {
  previewNoteVersionPrune: (params: NoteVersionRouteParams) => unknown;
  listNoteVersions: (params: NoteVersionRouteParams, query: NoteVersionRouteQuery) => unknown;
  getNoteVersion: (params: NoteVersionDetailRouteParams) => unknown;
}
export interface NoteVersionRouteContext {
  request: { method?: unknown };
  response: ResponseWriter;
  url: QuerySource & { pathname: { match: (pattern: RegExp) => unknown } };
  knowledge: NoteVersionRouteKnowledge;
}

// 只描述原生操作点：自定义 match 的捕获值未经验证，decodeURIComponent 原生负责转换。
type RouteCaptures = { [index: number]: unknown };
type NativeDecode = (value: unknown) => string;

function decode(value: unknown): string {
  try {
    return (decodeURIComponent as NativeDecode)(value);
  } catch {
    throw createAppError('ROUTE_PARAMETER_INVALID', 'Route parameter is invalid', 400);
  }
}

export async function handleNoteVersionRoute({
  request,
  response,
  url,
  knowledge
}: NoteVersionRouteContext): Promise<boolean> {
  const previewMatch = url.pathname.match(/^\/api\/knowledge\/notes\/([^/]+)\/versions\/prune-preview$/);
  if (request.method === 'GET' && previewMatch) {
    sendJson(response, 200, {
      data: await knowledge.previewNoteVersionPrune({ id: decode((previewMatch as RouteCaptures)[1]) })
    });
    return true;
  }
  const listMatch = url.pathname.match(/^\/api\/knowledge\/notes\/([^/]+)\/versions$/);
  if (request.method === 'GET' && listMatch) {
    sendJson(response, 200, {
      data: await knowledge.listNoteVersions({ id: decode((listMatch as RouteCaptures)[1]) }, toQueryObject(url))
    });
    return true;
  }
  const detailMatch = url.pathname.match(/^\/api\/knowledge\/notes\/([^/]+)\/versions\/([^/]+)$/);
  if (request.method === 'GET' && detailMatch) {
    sendJson(response, 200, {
      data: await knowledge.getNoteVersion({
        id: decode((detailMatch as RouteCaptures)[1]),
        versionId: decode((detailMatch as RouteCaptures)[2])
      })
    });
    return true;
  }
  return false;
}

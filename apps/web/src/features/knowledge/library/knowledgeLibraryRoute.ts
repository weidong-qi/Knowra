export const KNOWLEDGE_SCOPES = [
  ['all', '全部未归档'],
  ['candidate', '待确认'],
  ['confirmed', '已确认'],
  ['ungrouped', '未归入概念'],
  ['archived', '已归档'],
  ['trash', '回收站']
] as const;
export const CONCEPT_SCOPES = [
  ['all', '全部概念'],
  ['active', '关注'],
  ['muted', '不关注'],
  ['archived', '已归档']
] as const;
export type KnowledgeScope = (typeof KNOWLEDGE_SCOPES)[number][0];
export type ConceptScope = (typeof CONCEPT_SCOPES)[number][0];
export interface KnowledgeLibraryRoute {
  page: 'items' | 'concepts' | 'graph';
  scope: string;
  query: string;
  id: string | null;
  edgeId?: string | null;
  definitionDraftId?: string | null;
  includeMuted?: boolean;
  includeProjections?: boolean;
}
export function parseKnowledgeLibraryRoute(pathname: string): KnowledgeLibraryRoute {
  const [path, search] = pathname.split('?');
  const page = path?.startsWith('/knowledge/graph') ? 'graph' : path === '/knowledge/concepts' ? 'concepts' : 'items';
  const params = new URLSearchParams(search);
  const options = page === 'concepts' ? CONCEPT_SCOPES : KNOWLEDGE_SCOPES;
  const requestedScope =
    page === 'items' && params.get('scope') === 'needsRevision' ? 'candidate' : params.get('scope');
  const scope = options.find(([key]) => key === requestedScope)?.[0] ?? 'all';
  return {
    page,
    scope,
    query: params.get('q') ?? '',
    id: params.get(page === 'items' ? 'item' : 'concept'),
    ...(page === 'concepts' && params.get('draft') ? { definitionDraftId: params.get('draft') } : {}),
    ...(page === 'graph'
      ? {
          edgeId: params.get('edge'),
          includeMuted: params.get('muted') === '1',
          includeProjections: params.get('projections') !== '0'
        }
      : {})
  };
}
export function knowledgeLibraryPath(route: KnowledgeLibraryRoute): string {
  const path =
    route.page === 'concepts' ? '/knowledge/concepts' : route.page === 'graph' ? '/knowledge/graph' : '/knowledge';
  const params = new URLSearchParams();
  if (route.scope !== 'all') params.set('scope', route.scope);
  if (route.query) params.set('q', route.query);
  if (route.id) params.set(route.page === 'items' ? 'item' : 'concept', route.id);
  if (route.page === 'concepts' && route.definitionDraftId) params.set('draft', route.definitionDraftId);
  if (route.page === 'graph') {
    if (route.edgeId) params.set('edge', route.edgeId);
    if (route.includeMuted) params.set('muted', '1');
    if (route.includeProjections === false) params.set('projections', '0');
  }
  return `${path}${params.size ? `?${params}` : ''}`;
}

/** 搜索和列表选择不离开当前工作区，避免外壳夺走输入框或条目焦点。 */
export function knowledgeLibraryNavigationKey(pathname: string) {
  if (!pathname.startsWith('/knowledge')) return pathname;
  const [path, query] = pathname.split('?');
  const params = new URLSearchParams(query);
  for (const key of ['q', 'item', 'concept', 'edge', 'draft']) params.delete(key);
  if (path?.startsWith('/knowledge/graph')) {
    params.delete('muted');
    params.delete('projections');
  }
  return `${path}${params.size ? `?${params}` : ''}`;
}

export const KNOWLEDGE_SCOPES = [
  ['all', '全部未归档'],
  ['candidate', '候选'],
  ['needsRevision', '待修订'],
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
}
export function parseKnowledgeLibraryRoute(pathname: string): KnowledgeLibraryRoute {
  const [path, search] = pathname.split('?');
  const page = path === '/knowledge/graph' ? 'graph' : path === '/knowledge/concepts' ? 'concepts' : 'items';
  const params = new URLSearchParams(search);
  const options = page === 'concepts' ? CONCEPT_SCOPES : KNOWLEDGE_SCOPES;
  const scope = options.find(([key]) => key === params.get('scope'))?.[0] ?? 'all';
  return { page, scope, query: params.get('q') ?? '', id: params.get(page === 'concepts' ? 'concept' : 'item') };
}
export function knowledgeLibraryPath(route: KnowledgeLibraryRoute): string {
  const path =
    route.page === 'concepts' ? '/knowledge/concepts' : route.page === 'graph' ? '/knowledge/graph' : '/knowledge';
  const params = new URLSearchParams();
  if (route.scope !== 'all') params.set('scope', route.scope);
  if (route.query) params.set('q', route.query);
  if (route.id) params.set(route.page === 'concepts' ? 'concept' : 'item', route.id);
  return `${path}${params.size ? `?${params}` : ''}`;
}

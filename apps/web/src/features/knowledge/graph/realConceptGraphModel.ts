import {
  conceptVisibleRelations,
  conceptRelationProjections,
  normalizeConceptName,
  type ConceptItem,
  type ConceptState,
  type ConceptRelationType
} from '@study-accelerator/web-core';

export const relationLabels: Record<ConceptRelationType, string> = {
  isA: '是一种',
  partOf: '组成部分',
  prerequisiteOf: '前置于',
  contrastsWith: '对比',
  causes: '导致',
  appliesTo: '适用于',
  relatedTo: '相关'
};
export interface GraphNode {
  id: string;
  label: string;
  sense: string;
  mastery: 'notAssessed';
  muted: boolean;
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  kind: 'relation' | 'projection';
  directed: boolean;
  basisItemId: string | null;
}
export interface RealConceptGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
/** 纯领域投影；不保存位置、不推断掌握度，不把候选写回关系集合。 */
export function realConceptGraph(
  state: ConceptState,
  items: readonly ConceptItem[],
  options: { query?: string; includeMuted?: boolean; includeProjections?: boolean } = {}
): RealConceptGraph {
  const query = normalizeConceptName(options.query ?? '');
  const nodes = state.concepts
    .filter(
      row =>
        !row.deletedAt &&
        !row.mergedInto &&
        row.reviewStatus !== 'archived' &&
        (options.includeMuted || row.focus !== 'muted') &&
        normalizeConceptName([row.name, row.sense, ...row.aliases].join(' ')).includes(query)
    )
    .map(row => ({
      id: row.id,
      label: row.name,
      sense: row.sense,
      mastery: 'notAssessed' as const,
      muted: row.focus === 'muted'
    }));
  const ids = new Set(nodes.map(row => row.id));
  const edges: GraphEdge[] = conceptVisibleRelations(state, items)
    .filter(row => row.reviewStatus === 'confirmed')
    .map(row => ({
      id: `relation:${row.id}`,
      source: row.fromConceptId,
      target: row.toConceptId,
      label: relationLabels[row.type],
      kind: 'relation',
      directed: !['relatedTo', 'contrastsWith'].includes(row.type),
      basisItemId: row.basisItemId
    }));
  if (options.includeProjections)
    edges.push(
      ...conceptRelationProjections(state, items).map(row => ({
        id: `projection:${row.id}`,
        source: row.fromConceptId,
        target: row.toConceptId,
        label: '条目投影（待确认）',
        kind: 'projection' as const,
        directed: true,
        basisItemId: row.basisItemId
      }))
    );
  return { nodes, edges: edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)) };
}

import type { ConceptItem, ConceptState, KnowledgeConcept } from './types.ts';
import { normalizeConceptName } from './validation.ts';
/** 合并后的有效关联已迁移，视图无需解析隐藏身份或合并链。 */
export const resolveConceptId = (state: ConceptState, id: string) =>
  state.concepts.some(row => row.id === id && !row.deletedAt) ? id : null;
export function conceptItemLinks(state: ConceptState, items: readonly ConceptItem[]) {
  const concepts = new Set(state.concepts.filter(row => !row.deletedAt).map(row => row.id));
  const liveItems = new Set(items.filter(row => !row.deletedAt).map(row => row.id));
  return state.links.filter(row => !row.deletedAt && concepts.has(row.conceptId) && liveItems.has(row.knowledgeItemId));
}
export function conceptCounts(state: ConceptState, items: readonly ConceptItem[], id: string) {
  const links = conceptItemLinks(state, items).filter(row => row.conceptId === id);
  return {
    subject: links.filter(row => row.role === 'subject').length,
    mentions: links.filter(row => row.role === 'mentions').length
  };
}
export function groupItemsByConcept<Item extends ConceptItem>(
  state: ConceptState,
  items: readonly Item[]
): { concept: KnowledgeConcept | null; items: Item[] }[] {
  const links = conceptItemLinks(state, items);
  const result = state.concepts
    .filter(row => !row.deletedAt)
    .map(concept => ({
      concept,
      items: items.filter(item => links.some(link => link.conceptId === concept.id && link.knowledgeItemId === item.id))
    }))
    .filter(group => group.items.length);
  const visible = new Set(result.flatMap(group => group.items.map(item => item.id)));
  return [...result, { concept: null, items: items.filter(item => !item.deletedAt && !visible.has(item.id)) }].filter(
    group => group.items.length
  );
}
export const searchConcepts = (state: ConceptState, query: string) =>
  state.concepts.filter(
    row =>
      !row.deletedAt &&
      normalizeConceptName([row.name, row.sense, ...row.aliases].join(' ')).includes(normalizeConceptName(query))
  );

/** 关系视图不把回收站中的依据或失效挂靠展示为有效事实。 */
export function conceptVisibleRelations(state: ConceptState, items: readonly ConceptItem[]) {
  const concepts = new Set(state.concepts.filter(row => !row.deletedAt && !row.mergedInto).map(row => row.id));
  const links = conceptItemLinks(state, items);
  const attached = new Set(links.map(row => JSON.stringify([row.knowledgeItemId, row.conceptId])));
  return state.relations.filter(
    row =>
      !row.deletedAt &&
      concepts.has(row.fromConceptId) &&
      concepts.has(row.toConceptId) &&
      (row.basisItemId === null ||
        (attached.has(JSON.stringify([row.basisItemId, row.fromConceptId])) &&
          attached.has(JSON.stringify([row.basisItemId, row.toConceptId]))))
  );
}

export interface ConceptRelationProjection {
  id: string;
  fromConceptId: string;
  toConceptId: string;
  basisItemId: string;
}

/** 仅由已确认的主体→提及挂靠派生，未定类型的提示不写入关系集合。 */
export function conceptRelationProjections(
  state: ConceptState,
  items: readonly ConceptItem[]
): ConceptRelationProjection[] {
  const linksByItem = new Map<string, ReturnType<typeof conceptItemLinks>>();
  for (const link of conceptItemLinks(state, items)) {
    if (link.reviewStatus !== 'confirmed') continue;
    const group = linksByItem.get(link.knowledgeItemId) ?? [];
    group.push(link);
    linksByItem.set(link.knowledgeItemId, group);
  }
  const represented = new Set<string>();
  for (const row of conceptVisibleRelations(state, items)) {
    if (!row.basisItemId || row.reviewStatus !== 'confirmed') continue;
    represented.add(JSON.stringify([row.fromConceptId, row.toConceptId, row.basisItemId]));
    if (row.type === 'relatedTo' || row.type === 'contrastsWith')
      represented.add(JSON.stringify([row.toConceptId, row.fromConceptId, row.basisItemId]));
  }
  const projections = new Map<string, ConceptRelationProjection>();
  for (const [basisItemId, links] of linksByItem) {
    for (const from of links.filter(row => row.role === 'subject')) {
      for (const to of links.filter(row => row.role === 'mentions')) {
        if (from.conceptId === to.conceptId) continue;
        const key = JSON.stringify([from.conceptId, to.conceptId, basisItemId]);
        if (represented.has(key)) continue;
        projections.set(key, {
          id: `projection:${key}`,
          fromConceptId: from.conceptId,
          toConceptId: to.conceptId,
          basisItemId
        });
      }
    }
  }
  return [...projections.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** 定义仍是知识点，不创建正文副本；同时间使用 ID 保证跨端稳定。 */
export function conceptDefinitions<Item extends ConceptItem & { knowledgeType: string; createdAt: string }>(
  conceptId: string,
  links: ConceptState['links'],
  items: readonly Item[]
): { primary: Item | null; others: Item[] } {
  const ids = new Set(
    links
      .filter(
        row =>
          !row.deletedAt && row.conceptId === conceptId && row.role === 'subject' && row.reviewStatus === 'confirmed'
      )
      .map(row => row.knowledgeItemId)
  );
  const definitions = items
    .filter(item => !item.deletedAt && item.knowledgeType === 'concept' && ids.has(item.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return { primary: definitions[0] ?? null, others: definitions.slice(1) };
}

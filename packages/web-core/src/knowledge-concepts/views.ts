import type { ConceptItem, ConceptState, KnowledgeConcept } from './types.ts';
import { normalizeConceptName } from './validation.ts';
/** 合并后的有效关联已迁移，视图无需解析隐藏身份或合并链。 */
export const resolveConceptId = (state: ConceptState, id: string) => state.concepts.some(row => row.id === id && !row.deletedAt) ? id : null;
export function conceptItemLinks(state: ConceptState, items: readonly ConceptItem[]) {
  const concepts = new Set(state.concepts.filter(row => !row.deletedAt).map(row => row.id));
  const liveItems = new Set(items.filter(row => !row.deletedAt).map(row => row.id));
  return state.links.filter(row => !row.deletedAt && concepts.has(row.conceptId) && liveItems.has(row.knowledgeItemId));
}
export function conceptCounts(state: ConceptState, items: readonly ConceptItem[], id: string) {
  const links = conceptItemLinks(state, items).filter(row => row.conceptId === id);
  return { subject: links.filter(row => row.role === 'subject').length, mentions: links.filter(row => row.role === 'mentions').length };
}
export function groupItemsByConcept<Item extends ConceptItem>(state: ConceptState, items: readonly Item[]): { concept: KnowledgeConcept | null; items: Item[] }[] {
  const links = conceptItemLinks(state, items);
  const result = state.concepts.filter(row => !row.deletedAt && row.reviewStatus !== 'archived').map(concept => ({ concept, items: items.filter(item => links.some(link => link.conceptId === concept.id && link.knowledgeItemId === item.id)) })).filter(group => group.items.length);
  const visible = new Set(result.flatMap(group => group.items.map(item => item.id)));
  return [...result, { concept: null, items: items.filter(item => !item.deletedAt && !visible.has(item.id)) }].filter(group => group.items.length);
}
export const searchConcepts = (state: ConceptState, query: string) => state.concepts.filter(row => !row.deletedAt && normalizeConceptName([row.name, row.sense, ...row.aliases].join(' ')).includes(normalizeConceptName(query)));

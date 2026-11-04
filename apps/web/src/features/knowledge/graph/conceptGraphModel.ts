import type { ConceptGraphData, GraphConcept, GraphItem, GraphRelation, ItemKind, MasteryLevel, RelationType, VerificationStatus } from './conceptGraphData';

export const MASTERY_LABELS: Record<MasteryLevel, string> = { notAssessed: '未评估', weak: '薄弱', basic: '基本掌握', mastered: '已掌握' };
export const VERIFICATION_LABELS: Record<VerificationStatus, string> = { confirmed: '已确认', candidate: '候选', disputed: '待核查' };
export const KIND_LABELS: Record<ItemKind, string> = { definition: '定义', fact: '性质 / 事实', process: '方法 / 步骤', application: '用法' };
export const RELATION_LABELS: Record<RelationType, string> = {
  isA: '是一种', partOf: '组成部分', prerequisiteOf: '前置', appliesTo: '应用', contrastsWith: '易混', relatedTo: '相关',
  retrievedNotReused: '检索到未复用', possibleDuplicate: '疑似重复', suggestDemote: '建议降级到', suggestMerge: '建议合并到'
};

export type RelationLayer = 'relation' | 'retrieval' | 'suggestion';
export const RELATION_LAYER_LABELS: Record<RelationLayer, string> = { relation: '概念关系', retrieval: '检索到但未复用', suggestion: '整理建议与疑似重复' };
export function relationLayer(type: RelationType): RelationLayer {
  if (type === 'retrievedNotReused') return 'retrieval';
  if (type === 'possibleDuplicate' || type === 'suggestDemote' || type === 'suggestMerge') return 'suggestion';
  return 'relation';
}

const SCORE: Record<Exclude<MasteryLevel, 'notAssessed'>, number> = { weak: 1, basic: 2, mastered: 3 };

export interface ConceptStatus {
  /** 只由已评估的条目聚合；没有证据时为 notAssessed，不当作薄弱。 */
  level: MasteryLevel;
  assessed: number;
  total: number;
}

export function itemsOf(data: ConceptGraphData, conceptId: string): GraphItem[] {
  return data.items.filter(item => item.conceptIds.includes(conceptId));
}

/**
 * 概念状态是对关联条目的有条件聚合：只计入已确认、已评估的条目，取平均后四舍五入；
 * 候选和待核查条目不参与，避免未确认内容影响颜色。
 */
export function conceptStatus(data: ConceptGraphData, conceptId: string): ConceptStatus {
  const items = itemsOf(data, conceptId).filter(item => item.verification === 'confirmed');
  const assessed = items.filter(item => item.mastery !== 'notAssessed');
  if (assessed.length === 0) return { level: 'notAssessed', assessed: 0, total: items.length };
  const mean = assessed.reduce((sum, item) => sum + SCORE[item.mastery as keyof typeof SCORE], 0) / assessed.length;
  const level: MasteryLevel = mean < 1.5 ? 'weak' : mean < 2.5 ? 'basic' : 'mastered';
  return { level, assessed: assessed.length, total: items.length };
}

export function relationsOf(data: ConceptGraphData, conceptId: string): GraphRelation[] {
  return data.relations.filter(relation => relation.from === conceptId || relation.to === conceptId);
}

export function neighborIds(data: ConceptGraphData, conceptId: string): Set<string> {
  return new Set(relationsOf(data, conceptId).map(relation => relation.from === conceptId ? relation.to : relation.from));
}

export function relationLabel(relation: GraphRelation): string {
  return relation.label ?? RELATION_LABELS[relation.type];
}

/** 选中概念后，条目方块沿圆周均匀展开；条目越多半径越大，避免标签互相压住。 */
export function itemPositions(concept: GraphConcept, items: GraphItem[], radius?: number): Array<{ item: GraphItem; x: number; y: number; angle: number }> {
  const count = items.length;
  const r = radius ?? Math.max(92, 34 + count * 12);
  return items.map((item, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / Math.max(count, 1);
    return { item, angle, x: concept.x + Math.cos(angle) * r, y: concept.y + Math.sin(angle) * r };
  });
}

/** 条目标签朝外放：右侧左对齐、左侧右对齐、正上下居中。 */
export function itemLabelPlacement(angle: number, size: number): { dx: number; dy: number; anchor: 'start' | 'middle' | 'end' } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  if (cos > 0.35) return { dx: size / 2 + 6, dy: 4, anchor: 'start' };
  if (cos < -0.35) return { dx: -(size / 2 + 6), dy: 4, anchor: 'end' };
  return sin < 0 ? { dx: 0, dy: -(size / 2 + 6), anchor: 'middle' } : { dx: 0, dy: size / 2 + 15, anchor: 'middle' };
}

/** 连线标签沿法线方向偏移，避免压在线或概念名称上。 */
export function edgeLabelOffset(from: { x: number; y: number }, to: { x: number; y: number }, distance: number): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  let nx = -dy / length;
  let ny = dx / length;
  if (ny > 0 || (ny === 0 && nx < 0)) { nx = -nx; ny = -ny; }
  return { x: nx * distance, y: ny * distance };
}

export function relationMidpoint(data: ConceptGraphData, relation: GraphRelation): { x: number; y: number } | null {
  const from = data.concepts.find(concept => concept.id === relation.from);
  const to = data.concepts.find(concept => concept.id === relation.to);
  if (!from || !to) return null;
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

export type GraphFocus = { kind: 'none' } | { kind: 'concept'; id: string } | { kind: 'item'; id: string; conceptId: string | null };

/** 聚焦时：选中概念最清楚，相邻概念半清晰，其余淡出。 */
export function conceptEmphasis(data: ConceptGraphData, focusConceptId: string | null, conceptId: string): 'normal' | 'focus' | 'neighbor' | 'faded' {
  if (!focusConceptId) return 'normal';
  if (focusConceptId === conceptId) return 'focus';
  return neighborIds(data, focusConceptId).has(conceptId) ? 'neighbor' : 'faded';
}

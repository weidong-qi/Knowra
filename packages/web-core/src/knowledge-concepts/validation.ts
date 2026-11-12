import { CONCEPT_RELATION_TYPES, ConceptRuleError } from './types.ts';
import type { ConceptItem, ConceptRecord, ConceptState, KnowledgeConcept, KnowledgeConceptRelation } from './types.ts';
export const normalizeConceptName = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
export function conceptFail(code: ConceptRuleError['code'], message: string): never {
  throw new ConceptRuleError(code, message);
}
export function conceptId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value))
    return conceptFail('CONCEPT_INVALID_INPUT', '记录 ID 无效');
  return value;
}
export function conceptText(value: unknown, label: string, required = false): string {
  if (typeof value !== 'string') return conceptFail('CONCEPT_INVALID_INPUT', `${label}必须是文本`);
  const text = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if ((required && !text) || [...text].length > 80)
    return conceptFail('CONCEPT_INVALID_INPUT', `${label}须为${required ? '1' : '0'}–80 字`);
  return text;
}
export function conceptAliases(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length > 20) return conceptFail('CONCEPT_INVALID_INPUT', '别名最多 20 个');
  const aliases = value.map(alias => conceptText(alias, '别名', true));
  const keys = aliases.map(normalizeConceptName);
  if (new Set(keys).size !== keys.length || keys.includes(normalizeConceptName(name)))
    return conceptFail('CONCEPT_INVALID_INPUT', '别名不能重复或与名称相同');
  return aliases;
}
export const relationKey = (relation: Pick<KnowledgeConceptRelation, 'fromConceptId' | 'toConceptId' | 'type'>) => {
  const ids = [relation.fromConceptId, relation.toConceptId];
  if (['contrastsWith', 'relatedTo'].includes(relation.type)) ids.sort();
  return JSON.stringify([...ids, relation.type]);
};
const instant = (value: unknown) =>
  typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
export function conceptRecordError(value: unknown, kind: 'concepts' | 'links' | 'relations'): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '记录必须是对象';
  const row = value as Record<string, unknown>;
  try {
    conceptId(row.id);
    conceptId(row.operationId);
    if ((row.deletedAt === null) !== (row.deletedBy === null)) return '删除来源标记无效';
    if (
      !Number.isSafeInteger(row.revision) ||
      Number(row.revision) < 1 ||
      !instant(row.createdAt) ||
      !instant(row.updatedAt) ||
      (row.deletedAt !== null && !instant(row.deletedAt)) ||
      (row.deletedBy !== null && typeof row.deletedBy !== 'string')
    )
      return '版本或时间无效';
    if (!['manual', 'ai'].includes(String(row.sourceMode))) return '来源无效';
    if (
      !(kind === 'concepts' ? ['candidate', 'confirmed', 'archived'] : ['candidate', 'confirmed']).includes(
        String(row.reviewStatus)
      )
    )
      return '审核状态无效';
    if (kind === 'concepts') {
      const name = conceptText(row.name, '名称', true);
      conceptText(row.sense, '区分标签');
      conceptAliases(row.aliases, name);
      if (
        !['active', 'muted'].includes(String(row.focus)) ||
        (row.mergedInto !== null && typeof row.mergedInto !== 'string') ||
        (!row.deletedAt && row.mergedInto !== null)
      )
        return '概念状态无效';
      if (
        !Array.isArray(row.operations) ||
        row.operations.some(
          receipt =>
            !receipt ||
            typeof receipt !== 'object' ||
            typeof receipt.id !== 'string' ||
            !/^[a-f0-9]{64}$/.test(receipt.hash)
        ) ||
        new Set(row.operations.map(receipt => receipt.id)).size !== row.operations.length
      )
        return '操作回执无效';
    } else if (kind === 'links') {
      if (typeof row.knowledgeItemId !== 'string' || !row.knowledgeItemId) return '知识点引用无效';
      conceptId(row.conceptId);
      if (!['subject', 'mentions'].includes(String(row.role))) return '关联角色无效';
    } else {
      conceptId(row.fromConceptId);
      conceptId(row.toConceptId);
      if (
        !CONCEPT_RELATION_TYPES.includes(row.type as (typeof CONCEPT_RELATION_TYPES)[number]) ||
        (row.basisItemId !== null && typeof row.basisItemId !== 'string')
      )
        return '关系无效';
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : '记录无效';
  }
}
/** 持久化校验允许回收站中的知识点；新建挂靠另行禁止。墓碑不再要求旧引用存在。 */
export function assertConceptState(state: ConceptState, items: readonly ConceptItem[]): void {
  for (const kind of ['concepts', 'links', 'relations'] as const) {
    const ids = new Set<string>();
    for (const row of state[kind]) {
      const error = conceptRecordError(row, kind);
      if (error || ids.has(row.id)) conceptFail('CONCEPT_INVALID_INPUT', error ?? '记录 ID 重复');
      ids.add(row.id);
    }
  }
  const live = state.concepts.filter(row => !row.deletedAt);
  for (let i = 0; i < live.length; i++) {
    const a = live[i]!;
    for (const b of live.slice(i + 1)) {
      const namesA = [a.name, ...a.aliases].map(normalizeConceptName);
      const namesB = [b.name, ...b.aliases].map(normalizeConceptName);
      if (
        namesA.some(name => namesB.includes(name)) &&
        (normalizeConceptName(a.sense) === normalizeConceptName(b.sense) ||
          !normalizeConceptName(a.sense) ||
          !normalizeConceptName(b.sense))
      )
        conceptFail('CONCEPT_NAME_AMBIGUOUS', '名称或别名已存在，请为两个概念填写不同的区分标签');
    }
  }
  const concepts = new Set(live.map(row => row.id));
  const itemIds = new Set(items.map(row => row.id));
  const linkKeys = new Set<string>();
  for (const link of state.links.filter(row => !row.deletedAt)) {
    if (!concepts.has(link.conceptId)) conceptFail('CONCEPT_NOT_FOUND', '关联的概念不存在');
    if (!itemIds.has(link.knowledgeItemId)) conceptFail('CONCEPT_ITEM_NOT_FOUND', '关联的知识点不存在');
    const key = JSON.stringify([link.knowledgeItemId, link.conceptId]);
    if (linkKeys.has(key)) conceptFail('CONCEPT_LINK_EXISTS', '知识点已挂入该概念');
    linkKeys.add(key);
  }
  const relations = new Set<string>();
  for (const relation of state.relations.filter(row => !row.deletedAt)) {
    if (
      !concepts.has(relation.fromConceptId) ||
      !concepts.has(relation.toConceptId) ||
      relation.fromConceptId === relation.toConceptId
    )
      conceptFail('CONCEPT_INVALID_INPUT', '关系须连接两个不同的有效概念');
    if (
      relation.basisItemId === null
        ? relation.sourceMode !== 'manual'
        : !itemIds.has(relation.basisItemId) ||
          ![relation.fromConceptId, relation.toConceptId].every(id =>
            linkKeys.has(JSON.stringify([relation.basisItemId, id]))
          )
    )
      conceptFail('CONCEPT_RELATION_BASIS_INVALID', '关系依据必须同时挂靠两端概念');
    const key = relationKey(relation);
    if (relations.has(key)) conceptFail('CONCEPT_RELATION_EXISTS', '同类型关系已存在');
    relations.add(key);
  }
}
export function assertConceptRevision(row: ConceptRecord, expected: number): void {
  if (row.revision !== expected) conceptFail('CONCEPT_REVISION_CONFLICT', '记录已在别处修改，请刷新后重试');
}
export function requireLiveConcept(state: ConceptState, id: string): KnowledgeConcept {
  const row = state.concepts.find(row => row.id === id);
  if (row?.mergedInto) return conceptFail('CONCEPT_MERGED', '概念已合并，请刷新后使用目标概念');
  if (!row || row.deletedAt) return conceptFail('CONCEPT_NOT_FOUND', '概念不存在或已删除');
  return row;
}

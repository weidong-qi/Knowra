import { describe, expect, it } from 'vitest';
import { applyConceptCommand, assertConceptState, conceptCounts, conceptRemovalRelations, emptyConceptState, groupItemsByConcept, mergeConceptChanges } from '../src/knowledge-concepts/index.ts';
import type { ConceptCommand, ConceptState } from '../src/knowledge-concepts/types.ts';
const now = '2026-11-12T08:00:00.000Z';
const items = [{ id: 'k1' }, { id: 'k2' }];
function fixture() {
  let state = emptyConceptState(); let seq = 0;
  const execute = (input: Omit<ConceptCommand, 'operationId'>, operationId = `op${++seq}`) => {
    const command = { ...input, operationId } as ConceptCommand;
    const changed = applyConceptCommand(state, items, command, { now, requestHash: (seq.toString(16).padStart(64, '0')) });
    state = mergeConceptChanges(state, changed); return changed;
  };
  return { execute, get state() { return state; } };
}
describe('概念规则与直接合并', () => {
  it('同名和别名冲突要求双方具有不同的区分标签', () => {
    const f = fixture();
    f.execute({ type: 'createConcept', id: 'a', expectedRevision: 0, name: 'Ａ  B' });
    expect(() => f.execute({ type: 'createConcept', id: 'b', expectedRevision: 0, name: 'a b', sense: '另一个语境' })).toThrow('区分标签');
    f.execute({ type: 'updateConcept', id: 'a', expectedRevision: 1, patch: { sense: '原语境' } });
    f.execute({ type: 'createConcept', id: 'b', expectedRevision: 0, name: 'a b', sense: '另一个语境' });
    expect(f.state.concepts).toHaveLength(2);
  });
  it('直接合并迁移关联、主体优先、保留别名，删除内部边并禁止撤销合并', () => {
    const f = fixture();
    f.execute({ type: 'createConcept', id: 'a', expectedRevision: 0, name: 'CNN', itemIds: ['k1'] });
    f.execute({ type: 'createConcept', id: 'b', expectedRevision: 0, name: '卷积神经网络', itemIds: ['k1', 'k2'], role: 'mentions' });
    f.execute({ type: 'createRelation', id: 'a', expectedRevision: 1, relationId: 'r1', toConceptId: 'b', relationType: 'relatedTo', basisItemId: 'k1' });
    f.execute({ type: 'mergeConcept', id: 'a', expectedRevision: 2, targetId: 'b', expectedTargetRevision: 1 });
    expect(f.state.concepts.find(row => row.id === 'b')?.aliases).toEqual(['CNN']);
    expect(f.state.links.filter(row => !row.deletedAt)).toEqual(expect.arrayContaining([expect.objectContaining({ conceptId: 'b', knowledgeItemId: 'k1', role: 'subject' })]));
    expect(f.state.links.filter(row => !row.deletedAt)).toHaveLength(2);
    expect(f.state.relations[0]?.deletedAt).toBe(now);
    expect(() => f.execute({ type: 'undeleteConcept', id: 'a', expectedRevision: 3 })).toThrow('合并');
    expect(conceptCounts(f.state, items, 'b')).toEqual({ subject: 1, mentions: 1 });
  });
  it('一键解除关联与删除关系；未确认或过时的关系清单拒绝整个命令', () => {
    const f = fixture();
    for (const id of ['a', 'b']) f.execute({ type: 'createConcept', id, expectedRevision: 0, name: id, itemIds: ['k1'] });
    f.execute({ type: 'createRelation', id: 'a', expectedRevision: 1, relationId: 'r', toConceptId: 'b', relationType: 'partOf', basisItemId: 'k1' });
    const link = f.state.links.find(row => row.conceptId === 'a')!;
    expect(conceptRemovalRelations(f.state, [link.id]).map(row => row.id)).toEqual(['r']);
    expect(() => f.execute({ type: 'unlinkItems', id: 'a', expectedRevision: 2, linkIds: [link.id] })).toThrow('重新确认');
    expect(f.state.links.find(row => row.id === link.id)?.deletedAt).toBeNull();
    f.execute({ type: 'unlinkItems', id: 'a', expectedRevision: 2, linkIds: [link.id], deleteRelationIds: ['r'] });
    expect(f.state.relations[0]?.deletedAt).toBe(now);
  });
  it('删除与撤销只恢复本次连带记录，知识点回收站仅影响展示', () => {
    const f = fixture();
    f.execute({ type: 'createConcept', id: 'a', expectedRevision: 0, name: 'A', itemIds: ['k1'] });
    f.execute({ type: 'deleteConcept', id: 'a', expectedRevision: 1 });
    f.execute({ type: 'undeleteConcept', id: 'a', expectedRevision: 2 });
    const trashed = [{ id: 'k1', deletedAt: now }, { id: 'k2' }];
    expect(() => assertConceptState(f.state, trashed)).not.toThrow();
    expect(conceptCounts(f.state, trashed, 'a').subject).toBe(0);
    expect(groupItemsByConcept(f.state, items).at(-1)?.items).toEqual([{ id: 'k2' }]);
  });
  it('幂等重试不增加版本，操作 ID 不允许用于不同请求', () => {
    const before = emptyConceptState();
    const command: ConceptCommand = { type: 'createConcept', id: 'a', expectedRevision: 0, operationId: 'op', name: 'A' };
    const context = { now, requestHash: 'a'.repeat(64) };
    const state: ConceptState = mergeConceptChanges(before, applyConceptCommand(before, items, command, context));
    expect(applyConceptCommand(state, items, command, context)).toEqual(state);
    expect(() => applyConceptCommand(state, items, command, { ...context, requestHash: 'b'.repeat(64) })).toThrow('操作 ID');
    expect(() => applyConceptCommand(state, items, { ...command, operationId: 'new', type: 'deleteConcept', expectedRevision: 0 }, context)).toThrow('别处修改');
  });
});

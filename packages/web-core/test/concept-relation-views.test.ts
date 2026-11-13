import { describe, expect, it } from 'vitest';
import {
  applyConceptCommand,
  conceptDefinitions,
  conceptRelationProjections,
  conceptVisibleRelations,
  emptyConceptState,
  mergeConceptChanges,
  type ConceptCommand
} from '../src/knowledge-concepts/index.ts';

function fixture() {
  let state = emptyConceptState();
  const items = [
    { id: 'k', knowledgeType: 'concept', createdAt: '2026-01-02' },
    { id: 'k2', knowledgeType: 'concept', createdAt: '2026-01-01' }
  ];
  let seq = 0;
  const run = (command: Record<string, unknown>) => {
    const current = state.concepts.find(row => row.id === command.id);
    state = mergeConceptChanges(
      state,
      applyConceptCommand(
        state,
        items,
        { expectedRevision: current?.revision ?? 0, operationId: `op${++seq}`, ...command } as ConceptCommand,
        { now: '2026-11-13T00:00:00.000Z', requestHash: String(seq).padStart(64, '0') }
      )
    );
  };
  run({ type: 'createConcept', id: 'a', name: 'A', itemIds: ['k', 'k2'] });
  run({ type: 'createConcept', id: 'b', name: 'B', itemIds: ['k'], role: 'mentions' });
  return {
    run,
    items,
    get state() {
      return state;
    }
  };
}
describe('真实概念关系视图', () => {
  it('主体到提及投影不写库，确认后成为正式关系，删除后提示重新出现', () => {
    const f = fixture();
    const before = JSON.stringify(f.state);
    expect(conceptRelationProjections(f.state, f.items)).toMatchObject([
      { fromConceptId: 'a', toConceptId: 'b', basisItemId: 'k' }
    ]);
    expect(JSON.stringify(f.state)).toBe(before);
    f.run({
      type: 'createRelation',
      id: 'a',
      relationId: 'r',
      toConceptId: 'b',
      relationType: 'partOf',
      basisItemId: 'k'
    });
    expect(conceptRelationProjections(f.state, f.items)).toEqual([]);
    expect(conceptVisibleRelations(f.state, f.items)).toHaveLength(1);
    f.run({ type: 'deleteRelation', id: 'a', relationId: 'r', expectedRelationRevision: 1 });
    expect(conceptVisibleRelations(f.state, f.items)).toEqual([]);
    expect(conceptRelationProjections(f.state, f.items)).toHaveLength(1);
  });
  it('逆向对称关系也消除相同依据的投影，不消除另一条依据', () => {
    const f = fixture();
    f.run({ type: 'linkItems', id: 'b', itemIds: ['k2'], role: 'mentions' });
    f.run({
      type: 'createRelation',
      id: 'b',
      relationId: 'r',
      toConceptId: 'a',
      relationType: 'relatedTo',
      basisItemId: 'k'
    });
    expect(conceptRelationProjections(f.state, f.items).map(row => row.basisItemId)).toEqual(['k2']);
  });
  it('回收站、失效依据和候选挂靠不产生投影或有效边', () => {
    const f = fixture();
    f.run({
      type: 'createRelation',
      id: 'a',
      relationId: 'r',
      toConceptId: 'b',
      relationType: 'partOf',
      basisItemId: 'k'
    });
    const trashed = f.items.map(row => ({ ...row, deletedAt: row.id === 'k' ? '2026-11-13' : null }));
    expect(conceptVisibleRelations(f.state, trashed)).toEqual([]);
    expect(conceptRelationProjections(f.state, trashed)).toEqual([]);
    const state = structuredClone(f.state);
    state.links[0].deletedAt = '2026-11-13';
    expect(conceptVisibleRelations(state, f.items)).toEqual([]);
    const fresh = fixture();
    fresh.state.links.find(row => row.conceptId === 'b')!.reviewStatus = 'candidate';
    expect(conceptRelationProjections(fresh.state, fresh.items)).toEqual([]);
  });
  it('候选关系不会把尚未确认的条目投影隐藏', () => {
    const f = fixture();
    f.run({
      type: 'createRelation',
      id: 'a',
      relationId: 'r',
      toConceptId: 'b',
      relationType: 'partOf',
      basisItemId: 'k'
    });
    f.state.relations[0].reviewStatus = 'candidate';
    expect(conceptRelationProjections(f.state, f.items)).toHaveLength(1);
  });
  it('多主体多提及按条目独立投影，不生成自环', () => {
    const f = fixture();
    f.run({ type: 'createConcept', id: 'c', name: 'C', itemIds: ['k'] });
    expect(conceptRelationProjections(f.state, f.items).map(row => [row.fromConceptId, row.toConceptId])).toEqual([
      ['a', 'b'],
      ['c', 'b']
    ]);
  });
  it('定义按最早创建和稳定ID选取，提及与回收站不当作定义', () => {
    const f = fixture();
    expect(conceptDefinitions('a', f.state.links, f.items)).toEqual({ primary: f.items[1], others: [f.items[0]] });
    expect(conceptDefinitions('b', f.state.links, f.items)).toEqual({ primary: null, others: [] });
    expect(conceptDefinitions('a', f.state.links, [{ ...f.items[0], deletedAt: 'x' }]).primary).toBeNull();
  });
});

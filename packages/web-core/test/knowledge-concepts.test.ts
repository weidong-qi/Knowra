import { describe, expect, it } from 'vitest';
import {
  applyConceptCommand,
  assertConceptState,
  conceptCounts,
  conceptRemovalRelations,
  emptyConceptState,
  groupItemsByConcept,
  mergeConceptChanges
} from '../src/knowledge-concepts/index.ts';
import type { ConceptCommand, ConceptState } from '../src/knowledge-concepts/types.ts';
const now = '2026-11-12T08:00:00.000Z';
const items = [{ id: 'k1' }, { id: 'k2' }];
function fixture(currentItems = [...items]) {
  let state = emptyConceptState();
  let seq = 0;
  const execute = (input: Omit<ConceptCommand, 'operationId'>, operationId = `op${++seq}`) => {
    const command = { ...input, operationId } as ConceptCommand;
    const changed = applyConceptCommand(state, currentItems, command, {
      now,
      requestHash: seq.toString(16).padStart(64, '0')
    });
    state = mergeConceptChanges(state, changed);
    return changed;
  };
  return {
    execute,
    get state() {
      return state;
    }
  };
}
describe('概念规则与直接合并', () => {
  it('同名和别名冲突要求双方具有不同的区分标签', () => {
    const f = fixture();
    f.execute({ type: 'createConcept', id: 'a', expectedRevision: 0, name: 'Ａ  B' });
    expect(() =>
      f.execute({ type: 'createConcept', id: 'b', expectedRevision: 0, name: 'a b', sense: '另一个语境' })
    ).toThrow('区分标签');
    f.execute({ type: 'updateConcept', id: 'a', expectedRevision: 1, patch: { sense: '原语境' } });
    f.execute({ type: 'createConcept', id: 'b', expectedRevision: 0, name: 'a b', sense: '另一个语境' });
    expect(f.state.concepts).toHaveLength(2);
  });
  it('直接合并迁移关联、主体优先、保留别名，删除内部边并禁止撤销合并', () => {
    const f = fixture();
    f.execute({ type: 'createConcept', id: 'a', expectedRevision: 0, name: 'CNN', itemIds: ['k1'] });
    f.execute({
      type: 'createConcept',
      id: 'b',
      expectedRevision: 0,
      name: '卷积神经网络',
      itemIds: ['k1', 'k2'],
      role: 'mentions'
    });
    f.execute({
      type: 'createRelation',
      id: 'a',
      expectedRevision: 1,
      relationId: 'r1',
      toConceptId: 'b',
      relationType: 'relatedTo',
      basisItemId: 'k1'
    });
    f.execute({ type: 'mergeConcept', id: 'a', expectedRevision: 2, targetId: 'b', expectedTargetRevision: 2 });
    expect(f.state.concepts.find(row => row.id === 'b')?.aliases).toEqual(['CNN']);
    expect(f.state.links.filter(row => !row.deletedAt)).toEqual(
      expect.arrayContaining([expect.objectContaining({ conceptId: 'b', knowledgeItemId: 'k1', role: 'subject' })])
    );
    expect(f.state.links.filter(row => !row.deletedAt)).toHaveLength(2);
    expect(f.state.relations[0]?.deletedAt).toBe(now);
    expect(() => f.execute({ type: 'undeleteConcept', id: 'a', expectedRevision: 3 })).toThrow('合并');
    expect(conceptCounts(f.state, items, 'b')).toEqual({ subject: 1, mentions: 1 });
  });
  it('一键解除关联与删除关系；未确认或过时的关系清单拒绝整个命令', () => {
    const f = fixture();
    for (const id of ['a', 'b'])
      f.execute({ type: 'createConcept', id, expectedRevision: 0, name: id, itemIds: ['k1'] });
    f.execute({
      type: 'createRelation',
      id: 'a',
      expectedRevision: 1,
      relationId: 'r',
      toConceptId: 'b',
      relationType: 'partOf',
      basisItemId: 'k1'
    });
    const link = f.state.links.find(row => row.conceptId === 'a')!;
    expect(conceptRemovalRelations(f.state, [link.id]).map(row => row.id)).toEqual(['r']);
    expect(() => f.execute({ type: 'unlinkItems', id: 'a', expectedRevision: 2, linkIds: [link.id] })).toThrow(
      '重新确认'
    );
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
    const command: ConceptCommand = {
      type: 'createConcept',
      id: 'a',
      expectedRevision: 0,
      operationId: 'op',
      name: 'A'
    };
    const context = { now, requestHash: 'a'.repeat(64) };
    const state: ConceptState = mergeConceptChanges(before, applyConceptCommand(before, items, command, context));
    expect(applyConceptCommand(state, items, command, context)).toEqual(state);
    expect(() => applyConceptCommand(state, items, command, { ...context, requestHash: 'b'.repeat(64) })).toThrow(
      '操作 ID'
    );
    expect(() =>
      applyConceptCommand(
        state,
        items,
        { ...command, operationId: 'new', type: 'deleteConcept', expectedRevision: 0 },
        context
      )
    ).toThrow('别处修改');
  });
});

it('无向关系去重、关系依据和别名约束在同一校验器执行', () => {
  const f = fixture();
  for (const id of ['a', 'b']) f.execute({ type: 'createConcept', id, expectedRevision: 0, name: id, itemIds: ['k1'] });
  f.execute({
    type: 'createRelation',
    id: 'a',
    expectedRevision: 1,
    relationId: 'r',
    toConceptId: 'b',
    relationType: 'relatedTo',
    basisItemId: 'k1'
  });
  expect(() =>
    f.execute({
      type: 'createRelation',
      id: 'b',
      expectedRevision: 2,
      relationId: 'reverse',
      toConceptId: 'a',
      relationType: 'relatedTo',
      basisItemId: null
    })
  ).toThrow('同类型关系');
  expect(() =>
    f.execute({
      type: 'createRelation',
      id: 'b',
      expectedRevision: 2,
      relationId: 'missing',
      toConceptId: 'a',
      relationType: 'partOf',
      basisItemId: 'k2'
    })
  ).toThrow('同时挂靠');
  expect(() => f.execute({ type: 'updateConcept', id: 'a', expectedRevision: 2, patch: { aliases: ['a'] } })).toThrow(
    '与名称相同'
  );
  f.execute({ type: 'archiveConcept', id: 'a', expectedRevision: 2 });
  f.execute({ type: 'restoreConcept', id: 'a', expectedRevision: 3 });
  expect(f.state.concepts.find(row => row.id === 'a')?.reviewStatus).toBe('confirmed');
});

it('整批移动实际迁移关联，目标已有挂靠时去重并一次删除失效依据边', () => {
  const f = fixture();
  f.execute({ type: 'createConcept', id: 'a', expectedRevision: 0, name: 'A', itemIds: ['k1', 'k2'] });
  f.execute({ type: 'createConcept', id: 'b', expectedRevision: 0, name: 'B', itemIds: ['k1'], role: 'mentions' });
  f.execute({
    type: 'createRelation',
    id: 'a',
    expectedRevision: 1,
    relationId: 'r',
    toConceptId: 'b',
    relationType: 'relatedTo',
    basisItemId: 'k1'
  });
  const link = f.state.links.find(row => row.conceptId === 'a' && row.knowledgeItemId === 'k1')!;
  f.execute({
    type: 'moveLinks',
    id: 'a',
    expectedRevision: 2,
    targetId: 'b',
    expectedTargetRevision: 2,
    linkIds: [link.id],
    deleteRelationIds: ['r']
  });
  expect(f.state.links.filter(row => !row.deletedAt && row.conceptId === 'a').map(row => row.knowledgeItemId)).toEqual([
    'k2'
  ]);
  expect(f.state.links.filter(row => !row.deletedAt && row.conceptId === 'b')).toEqual([
    expect.objectContaining({ knowledgeItemId: 'k1', role: 'subject' })
  ]);
  expect(f.state.relations[0]?.deletedAt).toBe(now);
  expect(() =>
    f.execute({ type: 'linkItems', id: 'b', expectedRevision: 3, itemIds: ['k1'], role: 'subject' })
  ).toThrow('已挂入');
});

it('已有知识点的历史 Unicode ID 可直接挂靠，不改变旧资产身份', () => {
  const id = 'knowledge-中文';
  const changed = applyConceptCommand(
    emptyConceptState(),
    [{ id }],
    { type: 'createConcept', id: 'a', operationId: 'create', expectedRevision: 0, name: 'A', itemIds: [id] },
    { now, requestHash: 'a'.repeat(64) }
  );
  expect(changed.links[0]?.knowledgeItemId).toBe(id);
});

it('新入边使旧删除确认失效；改端点与删边各推进所有新旧端点一次', () => {
  const f = fixture();
  for (const id of ['a', 'b', 'c']) f.execute({ type: 'createConcept', id, expectedRevision: 0, name: id });
  f.execute({
    type: 'createRelation',
    id: 'b',
    expectedRevision: 1,
    relationId: 'r',
    toConceptId: 'a',
    relationType: 'partOf',
    basisItemId: null
  });
  expect(() => f.execute({ type: 'deleteConcept', id: 'a', expectedRevision: 1 })).toThrow('别处修改');
  expect(f.state.concepts.map(row => row.revision)).toEqual([2, 2, 1]);
  const changed = f.execute({
    type: 'updateRelation',
    id: 'b',
    expectedRevision: 2,
    relationId: 'r',
    expectedRelationRevision: 1,
    toConceptId: 'c',
    relationType: 'partOf',
    basisItemId: null
  });
  expect(changed.concepts.map(row => row.id)).toEqual(['a', 'b', 'c']);
  expect(f.state.concepts.map(row => row.revision)).toEqual([3, 3, 2]);
  f.execute({ type: 'deleteRelation', id: 'b', expectedRevision: 3, relationId: 'r', expectedRelationRevision: 2 });
  expect(f.state.concepts.map(row => row.revision)).toEqual([3, 4, 3]);
});

it('删除与撤销多条边时，每端点只推进一次；过时的对端删除也被拒绝', () => {
  const f = fixture();
  for (const id of ['a', 'b']) f.execute({ type: 'createConcept', id, expectedRevision: 0, name: id });
  for (const [index, relationType] of ['partOf', 'relatedTo'].entries())
    f.execute({
      type: 'createRelation',
      id: 'a',
      expectedRevision: index + 1,
      relationId: `r${index}`,
      toConceptId: 'b',
      relationType,
      basisItemId: null
    });
  f.execute({ type: 'deleteConcept', id: 'a', expectedRevision: 3 });
  expect(f.state.concepts.map(row => row.revision)).toEqual([4, 4]);
  expect(() => f.execute({ type: 'deleteConcept', id: 'b', expectedRevision: 3 })).toThrow('别处修改');
  f.execute({ type: 'undeleteConcept', id: 'a', expectedRevision: 4 });
  expect(f.state.concepts.map(row => row.revision)).toEqual([5, 5]);
  expect(f.state.relations.every(row => !row.deletedAt)).toBe(true);
});

it('概念删除后知识点永久删除，撤销恢复概念但不复活失效挂靠与依据边', () => {
  const currentItems = [...items];
  const f = fixture(currentItems);
  for (const id of ['a', 'b']) f.execute({ type: 'createConcept', id, expectedRevision: 0, name: id, itemIds: ['k1'] });
  f.execute({
    type: 'createRelation',
    id: 'a',
    expectedRevision: 1,
    relationId: 'r',
    toConceptId: 'b',
    relationType: 'partOf',
    basisItemId: 'k1'
  });
  f.execute({ type: 'deleteConcept', id: 'a', expectedRevision: 2 });
  // 永久删除协调器已经移除了仍有效的挂靠；旧墓碑可以继续保存历史引用。
  f.state.links = f.state.links.filter(row => row.deletedAt);
  currentItems.splice(0, 1);
  f.execute({ type: 'undeleteConcept', id: 'a', expectedRevision: 3 });
  expect(f.state.concepts.find(row => row.id === 'a')?.deletedAt).toBeNull();
  expect(f.state.links.every(row => row.deletedAt)).toBe(true);
  expect(f.state.relations[0]?.deletedAt).toBe(now);
  expect(() => assertConceptState(f.state, currentItems)).not.toThrow();
});

it('撤销沿另一端的合并链重定向关系，并保留独立删除事实', () => {
  const f = fixture();
  for (const id of ['a', 'b', 'c', 'd'])
    f.execute({ type: 'createConcept', id, expectedRevision: 0, name: id, itemIds: ['k1'] });
  f.execute({
    type: 'createRelation',
    id: 'a',
    expectedRevision: 1,
    relationId: 'r',
    toConceptId: 'b',
    relationType: 'partOf',
    basisItemId: 'k1'
  });
  f.execute({ type: 'deleteConcept', id: 'a', expectedRevision: 2 });
  f.execute({ type: 'mergeConcept', id: 'b', expectedRevision: 3, targetId: 'c', expectedTargetRevision: 1 });
  f.execute({ type: 'mergeConcept', id: 'c', expectedRevision: 2, targetId: 'd', expectedTargetRevision: 1 });
  f.execute({ type: 'undeleteConcept', id: 'a', expectedRevision: 3 });
  expect(f.state.relations[0]).toMatchObject({ fromConceptId: 'a', toConceptId: 'd', deletedAt: null });
  expect(f.state.concepts.filter(row => !row.deletedAt).map(row => row.id)).toEqual(['a', 'd']);
  expect(() => assertConceptState(f.state, items)).not.toThrow();
});

it('撤销不恢复另一端已独立删除的边，移除依据边也推进对端版本', () => {
  const f = fixture();
  for (const id of ['a', 'b']) f.execute({ type: 'createConcept', id, expectedRevision: 0, name: id, itemIds: ['k1'] });
  f.execute({
    type: 'createRelation',
    id: 'a',
    expectedRevision: 1,
    relationId: 'r',
    toConceptId: 'b',
    relationType: 'partOf',
    basisItemId: 'k1'
  });
  const link = f.state.links.find(row => row.conceptId === 'a')!;
  f.execute({ type: 'unlinkItems', id: 'a', expectedRevision: 2, linkIds: [link.id], deleteRelationIds: ['r'] });
  expect(f.state.concepts.map(row => row.revision)).toEqual([3, 3]);
  f.execute({
    type: 'createRelation',
    id: 'a',
    expectedRevision: 3,
    relationId: 'manual',
    toConceptId: 'b',
    relationType: 'partOf',
    basisItemId: null
  });
  f.execute({ type: 'deleteConcept', id: 'a', expectedRevision: 4 });
  f.execute({ type: 'deleteConcept', id: 'b', expectedRevision: 5 });
  f.execute({ type: 'undeleteConcept', id: 'a', expectedRevision: 5 });
  expect(f.state.relations.every(row => row.deletedAt)).toBe(true);
});

it('合并对外边推进旧新端点版本；撤销重定向撞边只恢复一条有效关系', () => {
  const f = fixture();
  for (const id of ['a', 'b', 'c']) f.execute({ type: 'createConcept', id, expectedRevision: 0, name: id });
  f.execute({
    type: 'createRelation',
    id: 'a',
    expectedRevision: 1,
    relationId: 'ab',
    toConceptId: 'b',
    relationType: 'partOf',
    basisItemId: null
  });
  f.execute({
    type: 'createRelation',
    id: 'a',
    expectedRevision: 2,
    relationId: 'ac',
    toConceptId: 'c',
    relationType: 'partOf',
    basisItemId: null
  });
  f.execute({ type: 'deleteConcept', id: 'a', expectedRevision: 3 });
  f.execute({ type: 'mergeConcept', id: 'b', expectedRevision: 3, targetId: 'c', expectedTargetRevision: 3 });
  f.execute({ type: 'undeleteConcept', id: 'a', expectedRevision: 4 });
  expect(f.state.relations.filter(row => !row.deletedAt)).toHaveLength(1);
  expect(f.state.relations.find(row => !row.deletedAt)).toMatchObject({ fromConceptId: 'a', toConceptId: 'c' });
  // 此时从 a 合并到新的 d，a/c/d 各推进一次，哪怕 a 同时是命令主体。
  f.execute({ type: 'createConcept', id: 'd', expectedRevision: 0, name: 'd' });
  const prior = new Map(f.state.concepts.map(row => [row.id, row.revision]));
  const changed = f.execute({
    type: 'mergeConcept',
    id: 'a',
    expectedRevision: prior.get('a')!,
    targetId: 'd',
    expectedTargetRevision: 1
  });
  expect(changed.concepts.map(row => row.id)).toEqual(['a', 'c', 'd']);
  for (const row of changed.concepts) expect(row.revision).toBe(prior.get(row.id)! + 1);
});

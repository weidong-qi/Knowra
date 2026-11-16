import { describe, expect, it } from 'vitest';
import {
  emptyConceptState,
  type KnowledgeConcept,
  type KnowledgeConceptLink,
  type KnowledgeConceptRelation
} from '@study-accelerator/web-core';
import { realConceptGraph } from './realConceptGraphModel';
const base = {
  revision: 1,
  createdAt: '2026-11-12',
  updatedAt: '2026-11-12',
  deletedAt: null,
  deletedBy: null,
  operationId: 'test'
};
const concept = (id: string, patch: Partial<KnowledgeConcept> = {}): KnowledgeConcept => ({
  ...base,
  id,
  name: id,
  sense: '',
  aliases: [],
  reviewStatus: 'confirmed',
  sourceMode: 'manual',
  focus: 'active',
  mergedInto: null,
  operations: [],
  ...patch
});
const link = (id: string, conceptId: string, role: 'subject' | 'mentions'): KnowledgeConceptLink => ({
  ...base,
  id,
  conceptId,
  knowledgeItemId: 'item',
  role,
  reviewStatus: 'confirmed',
  sourceMode: 'manual'
});
const relation = (patch: Partial<KnowledgeConceptRelation> = {}): KnowledgeConceptRelation => ({
  ...base,
  id: 'edge',
  fromConceptId: 'a',
  toConceptId: 'b',
  type: 'relatedTo',
  basisItemId: null,
  reviewStatus: 'confirmed',
  sourceMode: 'manual',
  ...patch
});
describe('真实概念图投影', () => {
  it('排除已删除、归档、合并和默认不关注；无学习证据一律未评估', () => {
    const state = {
      ...emptyConceptState(),
      concepts: [
        concept('a'),
        concept('muted', { focus: 'muted' }),
        concept('archived', { reviewStatus: 'archived' }),
        concept('deleted', { deletedAt: 'now' }),
        concept('merged', { mergedInto: 'a' })
      ]
    };
    expect(realConceptGraph(state, []).nodes.map(row => row.id)).toEqual(['a']);
    expect(realConceptGraph(state, [], { includeMuted: true }).nodes.map(row => row.mastery)).toEqual([
      'notAssessed',
      'notAssessed'
    ]);
  });
  it('保留有向类型和多边，排除失效依据、隐藏端点和已删除关系', () => {
    const state = {
      ...emptyConceptState(),
      concepts: [concept('a'), concept('b')],
      relations: [
        relation(),
        relation({ id: 'cause', type: 'causes' }),
        relation({ id: 'missing', basisItemId: 'missing' }),
        relation({ id: 'deleted', deletedAt: 'now' })
      ]
    };
    const graph = realConceptGraph(state, []);
    expect(graph.edges.map(row => [row.id, row.directed])).toEqual([
      ['relation:edge', false],
      ['relation:cause', true]
    ]);
    expect(realConceptGraph(state, [], { query: 'a' }).edges).toEqual([]);
  });
  it('投影只在显式开启后显示，来源主体→提及，且不写回正式关系', () => {
    const state = {
      ...emptyConceptState(),
      concepts: [concept('a'), concept('b')],
      links: [link('a-link', 'a', 'subject'), link('b-link', 'b', 'mentions')]
    };
    expect(realConceptGraph(state, [{ id: 'item' }]).edges).toEqual([]);
    expect(realConceptGraph(state, [{ id: 'item' }], { includeProjections: true }).edges).toMatchObject([
      { source: 'a', target: 'b', kind: 'projection', basisItemId: 'item' }
    ]);
    expect(state.relations).toEqual([]);
    expect(realConceptGraph(state, [{ id: 'item', deletedAt: 'now' }], { includeProjections: true }).edges).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { REUSED_ITEM_RESULT } from './experimentGraph.fixture';
import { ExperimentResultError, GRAPH_HEIGHT, GRAPH_WIDTH, graphFromExperimentResult } from './experimentGraph';

// 合成的最小 result.json：结构与 concept-linking-r2 的 run-local 输出一致，内容是虚构的。
const RESULT = {
  state: {
    concepts: [
      { id: 'N1', name: '梯度', sense: '数学：偏导数组成的向量', origin: 'created', noteId: 'L01' },
      { id: 'N2', name: '自动微分', sense: 'PyTorch 自动求梯度', origin: 'created', noteId: 'L02' },
      { id: 'N3', name: '查阅文档', sense: '查 API', origin: 'created', noteId: 'L02' },
      { id: 'N4', name: '矩阵与向量的积', sense: '矩阵运算', origin: 'created', noteId: 'L03' }
    ],
    items: [
      { id: 'K1', conceptId: 'N1', title: '梯度的定义', kind: 'definition', statement: '偏导数组成的向量', sources: [{ noteId: 'L01', quote: '偏导数' }] },
      { id: 'K2', conceptId: 'N2', title: 'x.grad 清零', kind: 'procedure', statement: '梯度会累积', sources: [{ noteId: 'L02', quote: '累积' }, { noteId: 'L03', quote: '清零' }] },
      { id: 'K3', conceptId: 'N3', title: 'dir 函数', kind: 'application', statement: 'dir(torch.ones)', sources: [{ noteId: 'L02', quote: 'dir' }] }
    ]
  },
  results: [
    { noteId: 'L01', candidates: [], response: { accepted: true, links: [{ accepted: true, conceptAction: 'create', conceptId: 'N1', itemId: 'K1', possibleDuplicateOf: null, sourceIssue: null }] } },
    { noteId: 'L02', candidates: [{ id: 'N1', name: '梯度' }], response: { accepted: true, links: [
      { accepted: true, conceptAction: 'create', conceptId: 'N2', itemId: 'K2', possibleDuplicateOf: null, sourceIssue: null },
      { accepted: true, conceptAction: 'create', conceptId: 'N3', itemId: 'K3', possibleDuplicateOf: 'N2', sourceIssue: '可能应为 dir(torch)' },
      { accepted: false, conceptAction: 'create', conceptId: 'N9', itemId: 'K9', sourceIssue: '被拒的不应出现' }
    ] } },
    { noteId: 'L03', candidates: [{ id: 'N2', name: '自动微分' }], response: { accepted: true, links: [{ accepted: true, conceptAction: 'reuse', conceptId: 'N2', itemId: 'K2', possibleDuplicateOf: null, sourceIssue: null }] } },
    { noteId: 'L04', candidates: [], error: '调用失败' }
  ],
  review: { suggestions: [
    { conceptId: 'N3', accepted: true, action: 'demote', targetId: 'N2', newName: null, split: null, reason: '只是用法' },
    { conceptId: 'N4', accepted: true, action: 'rename', targetId: null, newName: '矩阵乘法', split: null, reason: '照抄标题' },
    { conceptId: 'N1', accepted: false, errors: ['x'] }
  ], errors: [] },
  relations: { proposals: [
    { accepted: true, from: 'N2', to: 'N1', type: 'prerequisiteOf', basisItemId: null, reason: '自动微分计算梯度' },
    { accepted: true, from: 'N2', to: 'N1', type: 'notAType', basisItemId: null, reason: '' },
    { accepted: false, from: 'N3', to: 'N4', type: 'relatedTo', basisItemId: null, reason: '' }
  ] }
};

describe('graphFromExperimentResult', () => {
  const graph = graphFromExperimentResult(RESULT, 'result.json');
  const types = (type: string) => graph.relations.filter(relation => relation.type === type);

  it('条目一律是候选、未评估；sourceIssue 作为 AI 存疑意见单独显示，不改陈述', () => {
    expect(graph.items.map(item => item.verification)).toEqual(['candidate', 'candidate', 'disputed']);
    expect(graph.items.every(item => item.mastery === 'notAssessed')).toBe(true);
    const disputed = graph.items.find(item => item.id === 'K3')!;
    expect(disputed.statement).toBe('dir(torch.ones)');
    expect(disputed.sourceIssues).toEqual([{ note: 'L02', quote: '', issue: '可能应为 dir(torch)' }]);
    expect(disputed.kind).toBe('application');
    expect(graph.items.find(item => item.id === 'K2')).toMatchObject({ kind: 'process', sourceCount: 2, source: { note: 'L02', quote: '累积' } });
  });

  it('保留复用条目的全部来源与每条意见的笔记和原文，不覆盖早期意见', () => {
    const item = graphFromExperimentResult(REUSED_ITEM_RESULT).items[0];
    expect(item.statement).toBe('模型复述的梯度定义');
    expect(item.verification).toBe('disputed');
    expect(item.sources).toEqual([
      { note: 'L1', quote: 'L1 的正确原文' }, { note: 'L2', quote: 'L2 的偏导树原文' }, { note: 'L3', quote: 'L3 的 gard 原文' }
    ]);
    expect(item.sourceIssues).toEqual([
      { note: 'L2', quote: 'L2 的偏导树原文', issue: '偏导树可能是笔误' },
      { note: 'L3', quote: 'L3 的 gard 原文', issue: 'gard 可能是笔误' }
    ]);
    expect(item.source).toEqual(item.sources?.[0]);
    expect(item.sourceCount).toBe(3);
  });

  it('检索到但未复用：只为新建概念画，复用了的候选不算', () => {
    expect(types('retrievedNotReused').map(relation => [relation.from, relation.to])).toEqual([['N2', 'N1'], ['N3', 'N1']]);
  });

  it('疑似重复、降级建议成边；改名作为概念上的建议；被拒建议忽略', () => {
    expect(types('possibleDuplicate').map(relation => [relation.from, relation.to])).toEqual([['N3', 'N2']]);
    expect(types('suggestDemote')).toMatchObject([{ from: 'N3', to: 'N2', reason: '只是用法', verification: 'candidate' }]);
    expect(graph.concepts.find(concept => concept.id === 'N4')?.suggestion).toEqual({ action: 'rename', summary: '改名为 矩阵乘法', reason: '照抄标题' });
    expect(graph.concepts.find(concept => concept.id === 'N1')?.suggestion).toBeUndefined();
  });

  it('关系提议只接受合法类型，一律候选', () => {
    expect(types('prerequisiteOf')).toMatchObject([{ from: 'N2', to: 'N1', verification: 'candidate' }]);
    expect(graph.relations.some(relation => relation.from === 'N3' && relation.to === 'N4')).toBe(false);
    expect(graph.notice).not.toContain('没有概念之间的关系提议');
  });

  it('布局把所有概念放进画布，位置互不重合，结果可重复', () => {
    for (const concept of graph.concepts) {
      expect(concept.x).toBeGreaterThan(0); expect(concept.x).toBeLessThan(GRAPH_WIDTH);
      expect(concept.y).toBeGreaterThan(0); expect(concept.y).toBeLessThan(GRAPH_HEIGHT);
    }
    expect(new Set(graph.concepts.map(concept => `${Math.round(concept.x)},${Math.round(concept.y)}`)).size).toBe(graph.concepts.length);
    expect(graphFromExperimentResult(RESULT).concepts).toEqual(graph.concepts);
  });

  it('没有关系提议时在说明里点明；结构不对时报错', () => {
    expect(graphFromExperimentResult({ ...RESULT, relations: undefined }).notice).toContain('没有概念之间的关系提议');
    expect(() => graphFromExperimentResult({ foo: 1 })).toThrow(ExperimentResultError);
  });
});

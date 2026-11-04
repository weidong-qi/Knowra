// 合成结果：L1 新建条目，L2/L3 复用条目，各自保留原文和存疑意见。
export const REUSED_ITEM_RESULT = {
  state: {
    concepts: [{ id: 'N1', name: '梯度', sense: '数学', noteId: 'L1' }, { id: 'N2', name: '微分', sense: '数学', noteId: 'L1' }],
    items: [{ id: 'K1', conceptId: 'N1', title: '梯度定义', kind: 'definition', statement: '模型复述的梯度定义', sources: [
      { noteId: 'L1', quote: 'L1 的正确原文' }, { noteId: 'L2', quote: 'L2 的偏导树原文' }, { noteId: 'L3', quote: 'L3 的 gard 原文' }
    ] }]
  },
  results: [
    { noteId: 'L1', response: { links: [{ accepted: true, itemAction: 'new', itemId: 'K1', quote: 'L1 的正确原文', sourceIssue: null }] } },
    { noteId: 'L2', response: { links: [{ accepted: true, itemAction: 'reuse', itemId: 'K1', quote: 'L2 的偏导树原文', sourceIssue: '偏导树可能是笔误' }] } },
    { noteId: 'L3', response: { links: [
      { accepted: true, itemAction: 'reuse', itemId: 'K1', quote: 'L3 的 gard 原文', sourceIssue: 'gard 可能是笔误' },
      { accepted: false, itemId: 'K1', quote: '拒绝的原文', sourceIssue: '拒绝的意见' }
    ] } }
  ],
  relations: { proposals: [{ accepted: true, from: 'N1', to: 'N2', type: 'relatedTo' }] }
};

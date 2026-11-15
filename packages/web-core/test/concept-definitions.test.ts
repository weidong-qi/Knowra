import { describe, expect, it } from 'vitest';
import {
  applyConceptCommand,
  conceptDefinitions,
  emptyConceptState,
  mergeConceptChanges
} from '../src/knowledge-concepts/index.ts';

describe('概念定义视图', () => {
  it('只提取有效主体定义，忽略提及、其他类型、已删除知识、已移出挂靠和其他概念', () => {
    const items = [
      { id: 'late', knowledgeType: 'concept', createdAt: '2026-11-02T00:00:00Z' },
      { id: 'early', knowledgeType: 'concept', createdAt: '2026-11-01T00:00:00Z' },
      { id: 'mention', knowledgeType: 'concept', createdAt: '2026-10-01T00:00:00Z' },
      { id: 'fact', knowledgeType: 'fact', createdAt: '2026-10-01T00:00:00Z' },
      { id: 'deleted', knowledgeType: 'concept', createdAt: '2026-10-01T00:00:00Z', deletedAt: '2026-11-02T00:00:00Z' },
      { id: 'removed', knowledgeType: 'concept', createdAt: '2026-10-01T00:00:00Z' },
      { id: 'other', knowledgeType: 'concept', createdAt: '2026-10-01T00:00:00Z' }
    ];
    const liveItems = items.filter(item => !item.deletedAt);
    const options = { now: '2026-11-03T00:00:00Z', requestHash: 'a'.repeat(64) };
    let state = applyConceptCommand(
      emptyConceptState(),
      liveItems,
      {
        type: 'createConcept',
        id: 'a',
        name: '数学',
        itemIds: ['late', 'early', 'fact', 'removed'],
        operationId: 'create-a',
        expectedRevision: 0
      },
      options
    );
    state = mergeConceptChanges(
      state,
      applyConceptCommand(
        state,
        liveItems,
        {
          type: 'linkItems',
          id: 'a',
          itemIds: ['mention'],
          role: 'mentions',
          operationId: 'mention',
          expectedRevision: 1
        },
        options
      )
    );
    state = mergeConceptChanges(
      state,
      applyConceptCommand(
        state,
        liveItems,
        {
          type: 'unlinkItems',
          id: 'a',
          linkIds: [state.links.find(row => row.knowledgeItemId === 'removed')!.id],
          operationId: 'remove',
          expectedRevision: 2
        },
        options
      )
    );
    state = mergeConceptChanges(
      state,
      applyConceptCommand(
        state,
        liveItems,
        {
          type: 'createConcept',
          id: 'b',
          name: '其他',
          itemIds: ['other'],
          operationId: 'create-b',
          expectedRevision: 0
        },
        options
      )
    );
    // 已删除知识可能仍有历史挂靠，视图不会把它选为定义。
    state.links.push({ ...state.links[0]!, id: 'old-deleted-link', knowledgeItemId: 'deleted' });
    expect(conceptDefinitions(state, items, 'a').map(item => item.id)).toEqual(['early', 'late']);
    expect(items.map(item => item.id)).toEqual(['late', 'early', 'mention', 'fact', 'deleted', 'removed', 'other']);
    state.concepts[0]!.deletedAt = options.now;
    expect(conceptDefinitions(state, items, 'a')).toEqual([]);
  });

  it('同一创建时刻使用稳定顺序，候选及归档状态不改变定义身份', () => {
    const items = ['b', 'a'].map(id => ({
      id,
      knowledgeType: 'concept',
      createdAt: '2026-11-01T00:00:00Z',
      reviewStatus: id === 'a' ? 'archived' : 'candidate'
    }));
    const state = applyConceptCommand(
      emptyConceptState(),
      items,
      {
        type: 'createConcept',
        id: 'a',
        name: '数学',
        itemIds: ['b', 'a'],
        operationId: 'create',
        expectedRevision: 0
      },
      { now: '2026-11-03T00:00:00Z', requestHash: 'a'.repeat(64) }
    );
    expect(conceptDefinitions(state, items, 'a').map(item => item.id)).toEqual(['a', 'b']);
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConceptGraphCanvas } from './RealConceptGraphView';
import { createGraphRenderer } from './cytoscapeAdapter';
vi.mock('./cytoscapeAdapter', () => ({
  createGraphRenderer: vi.fn(() => ({
    update: vi.fn(),
    select: vi.fn(),
    fit: vi.fn(),
    zoom: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn()
  }))
}));
describe('真实图容器', () => {
  it('数据更新复用渲染实例，选择/缩放受控，卸载销毁', async () => {
    const graph = {
      nodes: [{ id: 'a', label: '概念 A', sense: '', mastery: 'notAssessed' as const, muted: false }],
      edges: []
    };
    const props = { graph, selectedId: null, onSelect: vi.fn(), onEdge: vi.fn() };
    const view = render(<ConceptGraphCanvas {...props} />);
    const instance = vi.mocked(createGraphRenderer).mock.results.at(-1)!.value;
    expect(instance.update).toHaveBeenCalledWith(graph);
    view.rerender(<ConceptGraphCanvas {...props} selectedId="a" />);
    expect(instance.select).toHaveBeenLastCalledWith('a');
    await userEvent.click(screen.getByRole('button', { name: '放大' }));
    expect(instance.zoom).toHaveBeenCalledWith(1.25);
    await userEvent.click(screen.getByRole('button', { name: '适应画布' }));
    expect(instance.fit).toHaveBeenCalled();
    view.unmount();
    expect(instance.destroy).toHaveBeenCalledOnce();
  });
});

// 使用真实共享缓存，防止仅验证 refresh state 而漏掉 ready 缓存命中。
import { cleanup, waitFor } from '@testing-library/react';
import { afterEach } from 'vitest';
import { emptyConceptState, type KnowledgeConcept, type KnowledgeItem } from '@study-accelerator/web-core';
import { createConceptStore, setSharedConceptStore } from '../concepts/conceptStore';
import { createKnowledgeLibraryCache } from '../library/knowledgeLibraryCache';
import { KnowledgeLibraryContext } from '../library/KnowledgeLibraryProvider';
import { RealConceptGraphView } from './RealConceptGraphView';
afterEach(() => {
  cleanup();
  setSharedConceptStore(null);
});
const record = {
  revision: 1,
  createdAt: '2026-11-13',
  updatedAt: '2026-11-13',
  deletedAt: null,
  deletedBy: null,
  operationId: 'test'
};
const concept = (id: string): KnowledgeConcept => ({
  ...record,
  id,
  name: id,
  sense: '',
  aliases: [],
  reviewStatus: 'confirmed',
  sourceMode: 'manual',
  focus: 'active',
  mergedInto: null,
  operations: []
});
it('刷新使共享缓存失效，重新读取知识点并移除失效依据投影', async () => {
  const state = {
    ...emptyConceptState(),
    concepts: [concept('主体'), concept('提及')],
    links: [
      {
        ...record,
        id: 'a',
        conceptId: '主体',
        knowledgeItemId: 'item',
        role: 'subject' as const,
        reviewStatus: 'confirmed' as const,
        sourceMode: 'manual' as const
      },
      {
        ...record,
        id: 'b',
        conceptId: '提及',
        knowledgeItemId: 'item',
        role: 'mentions' as const,
        reviewStatus: 'confirmed' as const,
        sourceMode: 'manual' as const
      }
    ]
  };
  const request = vi.fn(async () => ({ data: state }));
  setSharedConceptStore(createConceptStore(request as never));
  let items = [{ id: 'item', deletedAt: null }] as KnowledgeItem[];
  const loader = vi.fn(async () => items);
  const cache = createKnowledgeLibraryCache(loader);
  await cache.list();
  render(
    <KnowledgeLibraryContext.Provider value={cache}>
      <RealConceptGraphView
        query=""
        selectedId={null}
        onQueryChange={vi.fn()}
        onSelect={vi.fn()}
        onOpenConcept={vi.fn()}
        onOpenItem={vi.fn()}
        onOpenExperiment={vi.fn()}
        onListItems={cache.list}
      />
    </KnowledgeLibraryContext.Provider>
  );
  await screen.findByText('2 个概念 · 0 条正式关系 · 1 条投影候选');
  expect(loader).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('checkbox', { name: '显示条目投影候选' })).toBeChecked();
  items = [{ id: 'item', deletedAt: 'now' }] as KnowledgeItem[];
  await userEvent.click(screen.getByRole('button', { name: '刷新' }));
  await screen.findByText('2 个概念 · 0 条正式关系 · 0 条投影候选');
  expect(loader).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenCalledTimes(2);
});
it('加载失败后刷新重试，仍可在渲染不可用时通过列表打开概念', async () => {
  const state = { ...emptyConceptState(), concepts: [concept('可访问概念')] };
  setSharedConceptStore(createConceptStore(vi.fn(async () => ({ data: state })) as never));
  const onListItems = vi
    .fn<() => Promise<KnowledgeItem[]>>()
    .mockRejectedValueOnce(new Error('列表加载失败'))
    .mockResolvedValue([]);
  const onSelect = vi.fn();
  const onOpenConcept = vi.fn();
  vi.mocked(createGraphRenderer).mockImplementationOnce(() => {
    throw new Error('canvas unavailable');
  });
  render(
    <RealConceptGraphView
      query=""
      selectedId="可访问概念"
      onQueryChange={vi.fn()}
      onSelect={onSelect}
      onOpenConcept={onOpenConcept}
      onOpenItem={vi.fn()}
      onOpenExperiment={vi.fn()}
      onListItems={onListItems}
    />
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('列表加载失败');
  await userEvent.click(screen.getByRole('button', { name: '刷新' }));
  await waitFor(() => expect(onListItems).toHaveBeenCalledTimes(2));
  await userEvent.click(await screen.findByRole('button', { name: '可访问概念 · 未评估' }));
  expect(onSelect).toHaveBeenCalledWith('可访问概念');
  await userEvent.click(screen.getByRole('button', { name: '打开概念详情与关系' }));
  expect(onOpenConcept).toHaveBeenCalledWith('可访问概念');
  expect(screen.getByRole('alert')).toHaveTextContent('图形渲染暂不可用');
});

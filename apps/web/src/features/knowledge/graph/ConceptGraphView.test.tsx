import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ConceptGraphView } from './ConceptGraphView';
import { CONCEPT_GRAPH_SAMPLE, type ConceptGraphData } from './conceptGraphData';
import { conceptEmphasis, conceptStatus, itemPositions, itemsOf } from './conceptGraphModel';

import { REUSED_ITEM_RESULT } from './experimentGraph.fixture';

const data = CONCEPT_GRAPH_SAMPLE;

async function importExperiment() {
  const file = new File([JSON.stringify(REUSED_ITEM_RESULT)], 'result.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => JSON.stringify(REUSED_ITEM_RESULT) });
  fireEvent.change(screen.getByLabelText('选择实验结果文件'), { target: { files: [file] } });
  await screen.findByRole('button', { name: '回到示例' });
}

describe('conceptGraphModel', () => {
  it('概念状态只聚合已确认、已评估的条目；没有证据时是未评估而不是薄弱', () => {
    expect(conceptStatus(data, 'chain')).toEqual({ level: 'notAssessed', assessed: 0, total: 0 });
    expect(conceptStatus(data, 'tensor')).toEqual({ level: 'basic', assessed: 5, total: 5 });
    expect(conceptStatus(data, 'grad-attr')).toMatchObject({ level: 'basic', assessed: 3, total: 3 });
    const weakOnly: ConceptGraphData = { ...data, items: [
      { ...data.items[0], id: 'w', conceptIds: ['x'], mastery: 'weak' },
      { ...data.items[0], id: 'c', conceptIds: ['x'], mastery: 'mastered', verification: 'candidate' }
    ] };
    expect(conceptStatus(weakOnly, 'x')).toEqual({ level: 'weak', assessed: 1, total: 1 });
  });

  it('聚焦时选中概念最清楚，相邻概念半清晰，其余淡出', () => {
    expect(conceptEmphasis(data, null, 'tensor')).toBe('normal');
    expect(conceptEmphasis(data, 'tensor', 'tensor')).toBe('focus');
    expect(conceptEmphasis(data, 'tensor', 'vector')).toBe('neighbor');
    expect(conceptEmphasis(data, 'tensor', 'chain')).toBe('faded');
  });

  it('条目方块围绕概念均匀展开', () => {
    const concept = data.concepts[0];
    const positions = itemPositions(concept, itemsOf(data, concept.id), 100);
    expect(positions[0]).toMatchObject({ x: concept.x, y: concept.y - 100 });
    for (const position of positions) expect(Math.hypot(position.x - concept.x, position.y - concept.y)).toBeCloseTo(100);
  });

  it('示例数据引用完整：条目、关系都指向存在的概念与条目', () => {
    const conceptIds = new Set(data.concepts.map(concept => concept.id));
    const itemIds = new Set(data.items.map(item => item.id));
    for (const item of data.items) for (const id of item.conceptIds) expect(conceptIds.has(id)).toBe(true);
    for (const relation of data.relations) {
      expect(conceptIds.has(relation.from) && conceptIds.has(relation.to)).toBe(true);
      if (relation.basisItemId) expect(itemIds.has(relation.basisItemId)).toBe(true);
    }
  });
});

describe('ConceptGraphView', () => {
  it('关闭研究关系层后回到示例，所有示例连线仍可见，重复导入也不污染示例', async () => {
    const user = userEvent.setup();
    render(<ConceptGraphView />);
    const edges = () => screen.getByRole('group', { name: '概念图' }).querySelectorAll('[data-relation]');
    expect(edges()).toHaveLength(data.relations.length);
    await importExperiment();
    expect(edges()).toHaveLength(1);
    await user.click(screen.getByRole('checkbox', { name: /概念关系/ }));
    expect(edges()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: '回到示例' }));
    expect(screen.queryByRole('group', { name: '显示哪些连线' })).not.toBeInTheDocument();
    expect(edges()).toHaveLength(data.relations.length);
    await importExperiment();
    expect(screen.getByRole('checkbox', { name: /概念关系/ })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: '回到示例' }));
    expect(edges()).toHaveLength(data.relations.length);
  });

  it('导入后可查看全部来源，每条存疑意见明确对应自己的笔记与原文', async () => {
    const user = userEvent.setup();
    render(<ConceptGraphView />);
    await importExperiment();
    await user.click(screen.getByRole('button', { name: /^梯度，/ }));
    await user.click(within(screen.getByRole('region', { name: '详情' })).getByRole('button', { name: /梯度定义/ }));
    const panel = screen.getByRole('region', { name: '详情' });
    expect(within(panel).getByText('条目陈述（模型复述）')).toBeInTheDocument();
    expect(within(panel).getByText('模型复述的梯度定义')).toBeInTheDocument();
    for (const note of ['L1', 'L2', 'L3']) expect(within(panel).getByText(note)).toBeInTheDocument();
    const issues = within(panel).getByRole('region', { name: 'AI 存疑意见' });
    for (const [note, quote, issue] of [
      ['L2', 'L2 的偏导树原文', '偏导树可能是笔误'], ['L3', 'L3 的 gard 原文', 'gard 可能是笔误']
    ]) {
      const entry = within(issues).getByText(issue).parentElement!;
      expect(within(entry).getByText(`对应笔记：${note}`)).toBeInTheDocument();
      expect(within(entry).getByText(quote)).toBeInTheDocument();
      expect(within(entry).queryByText('L1 的正确原文')).not.toBeInTheDocument();
    }
    expect(within(panel).queryByText('拒绝的意见')).not.toBeInTheDocument();
  });

  it('点击概念展开其条目，再点条目查看来源；Esc 收起', async () => {
    const user = userEvent.setup();
    render(<ConceptGraphView />);
    expect(screen.getByRole('heading', { name: '怎么看这张图' })).toBeInTheDocument();
    const dot = screen.getByRole('button', { name: /^点积，/ });
    await user.click(dot);
    expect(dot).toHaveAttribute('aria-pressed', 'true');
    const panel = screen.getByRole('region', { name: '详情' });
    expect(within(panel).getByRole('heading', { name: '点积' })).toBeInTheDocument();
    const disputed = screen.getByRole('button', { name: /点积与内积的说法，性质 \/ 事实，待核查/ });
    await user.click(disputed);
    expect(within(panel).getByText(/内积是点积在一般向量空间上的推广/)).toBeInTheDocument();
    expect(within(panel).getByText('注意：点积是两个等长向量之间的概念，张量之间叫内积')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('heading', { name: '怎么看这张图' })).toBeInTheDocument();
  });

  it('键盘可以选中概念；没有内容的概念给出骨架说明', async () => {
    const user = userEvent.setup();
    render(<ConceptGraphView />);
    screen.getByRole('button', { name: /^链式法则，未评估/ }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('还没有内容。概念可以先于笔记存在，之后再补。')).toBeInTheDocument();
  });

  it('连线上的关系方块与概念下的条目是同一份数据', async () => {
    const user = userEvent.setup();
    render(<ConceptGraphView />);
    await user.click(screen.getByRole('button', { name: '关系说明：向量是一维张量' }));
    const panel = screen.getByRole('region', { name: '详情' });
    expect(within(panel).getByText('定义 · 关系说明')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: '向量' }));
    expect(within(panel).getByRole('button', { name: /向量是一维张量/ })).toBeInTheDocument();
  });
});

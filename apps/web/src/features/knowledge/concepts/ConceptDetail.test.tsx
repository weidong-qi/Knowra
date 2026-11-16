import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import {
  applyConceptCommand,
  conceptDefinitions,
  emptyConceptState,
  type KnowledgeItem
} from '@study-accelerator/web-core';
import { ConceptDetail } from './ConceptDetail';

afterEach(cleanup);
const item = (id: string, text: string, createdAt = '2026-11-01T00:00:00Z'): KnowledgeItem => ({
  id,
  title: id,
  canonicalStatement: text,
  userExplanation: '',
  knowledgeType: 'concept',
  importance: null,
  reviewStatus: 'candidate',
  sourceMode: 'manual',
  createdAt,
  updatedAt: createdAt,
  deletedAt: null
});
function setup(items: KnowledgeItem[], mentions: boolean, write = true) {
  const state = applyConceptCommand(
    emptyConceptState(),
    items,
    {
      type: 'createConcept',
      id: 'math',
      name: '数学',
      sense: '基础学科',
      itemIds: items.map(row => row.id),
      role: mentions ? 'mentions' : 'subject',
      operationId: 'create',
      expectedRevision: 0
    },
    { now: '2026-11-03T00:00:00Z', requestHash: 'a'.repeat(64) }
  );
  const onOpenItem = vi.fn();
  const onRole = vi.fn();
  render(
    <ConceptDetail
      concept={state.concepts[0]!}
      items={new Map(items.map(row => [row.id, row]))}
      links={state.links}
      definitions={conceptDefinitions(state, items, 'math')}
      write={write}
      pending={false}
      onEdit={vi.fn()}
      onAttach={vi.fn()}
      onWriteDefinition={vi.fn()}
      onAction={vi.fn()}
      onOpenItem={onOpenItem}
      onRole={onRole}
      onRemove={vi.fn()}
    />
  );
  return { onOpenItem, onRole };
}

it('提及的两条知识明确显示为知识点，不显示为两个概念', () => {
  setup([item('测试知识', '测试正文'), item('勾股定理', '直角三角形关系')], true);
  expect(screen.getByRole('heading', { name: '关联知识点' })).toBeVisible();
  const group = screen.getByRole('region', { name: '概念类知识点' });
  expect(within(group).getByRole('button', { name: /^概念类知识点\s*2$/ })).toBeVisible();
  expect(within(group).getByRole('button', { name: '测试知识' })).toBeVisible();
  expect(within(group).getByRole('button', { name: '勾股定理' })).toBeVisible();
  expect(screen.getByRole('region', { name: '定义' })).toHaveTextContent('基础学科');
  expect(screen.getByRole('button', { name: '写定义' })).toBeVisible();
});

it('最早主体定义直接展示，其他定义默认收起，保留打开和改角色操作', async () => {
  const user = userEvent.setup();
  const { onOpenItem, onRole } = setup(
    [item('后写的定义', '另一种数学解释', '2026-11-02T00:00:00Z'), item('最早定义', '研究数量与结构的学科。')],
    false
  );
  const definition = screen.getByRole('region', { name: '定义' });
  expect(definition).toHaveTextContent('研究数量与结构的学科。');
  expect(within(definition).queryByText('另一种数学解释')).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '概念类知识点' })).not.toBeInTheDocument();
  const openDefinition = within(definition).getByRole('button', { name: '查看定义知识：最早定义' });
  expect(openDefinition).toHaveAccessibleDescription('研究数量与结构的学科。');
  await user.click(openDefinition);
  expect(onOpenItem).toHaveBeenCalledWith('最早定义');
  await user.click(within(definition).getByRole('button', { name: /^其他定义\s*1$/ }));
  expect(within(definition).getByText('另一种数学解释')).toBeVisible();
  await user.click(within(definition).getByRole('button', { name: '挂靠操作：最早定义' }));
  await user.click(screen.getByRole('menuitem', { name: '改为提及' }));
  expect(onRole).toHaveBeenCalledWith(expect.objectContaining({ knowledgeItemId: '最早定义' }));
});

it('只读模式不提供写定义和挂靠操作', () => {
  setup([], false, false);
  expect(screen.getByRole('region', { name: '定义' })).toHaveTextContent('基础学科');
  expect(screen.queryByRole('button', { name: '写定义' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '挂入知识点' })).not.toBeInTheDocument();
});

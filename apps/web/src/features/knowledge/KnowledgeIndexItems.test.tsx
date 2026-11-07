import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeItem } from '@study-accelerator/web-core';
import { KnowledgeIndexSections, handleKnowledgeListKeys } from './KnowledgeIndexItems';
import type { KnowledgeView } from './knowledgeIndexModel';

const first: KnowledgeItem = {
  id: 'first',
  title: '知识甲',
  canonicalStatement: '合成甲',
  userExplanation: '',
  knowledgeType: 'concept',
  importance: null,
  reviewStatus: 'candidate',
  sourceMode: 'manual',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  deletedAt: null
};
const second: KnowledgeItem = { ...first, id: 'second', title: '知识乙' };

function Harness({
  view = 'list',
  disabled = false,
  onSelect = vi.fn(),
  onOpenMenu = vi.fn(),
  onEscape = vi.fn()
}: {
  view?: KnowledgeView;
  disabled?: boolean;
  onSelect?(id: string): void;
  onOpenMenu?(item: KnowledgeItem, point: { x: number; y: number }): void;
  onEscape?(): void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div
      onKeyDown={event => {
        handleKnowledgeListKeys(event);
        if (event.key === 'Escape') onEscape();
      }}
    >
      <KnowledgeIndexSections
        sections={[{ id: 'candidate', label: '候选分组', items: [first, second] }]}
        view={view}
        showHeadings
        collapsed={new Set(collapsed ? ['candidate'] : [])}
        onToggle={() => setCollapsed(value => !value)}
        disabled={disabled}
        properties={{ statement: false, status: false, type: false, updated: false }}
        selectedItemId={first.id}
        onSelect={onSelect}
        onOpenMenu={onOpenMenu}
      />
    </div>
  );
}

describe('KnowledgeIndexItems 原生交互兼容', () => {
  for (const view of ['list', 'card'] as const) {
    it.each(['{Enter}', ' '])(`${view} Tab后%s仅选择一次并保留当前段语义`, async key => {
      const user = userEvent.setup();
      const select = vi.fn();
      render(<Harness view={view} onSelect={select} />);
      await user.tab();
      expect(screen.getByRole('button', { name: '候选分组2' })).toHaveFocus();
      await user.tab();
      const entry = screen.getByRole('button', { name: '知识甲' });
      expect(entry).toHaveFocus();
      expect(entry).toHaveAttribute('aria-current', 'true');
      await user.keyboard(key);
      expect(select).toHaveBeenCalledExactlyOnceWith('first');
    });

    it(`${view} 保留父层J/K、Escape及键盘上下文菜单`, async () => {
      const user = userEvent.setup();
      const menu = vi.fn();
      const escape = vi.fn();
      render(<Harness view={view} onOpenMenu={menu} onEscape={escape} />);
      const a = screen.getByRole('button', { name: '知识甲' });
      const b = screen.getByRole('button', { name: '知识乙' });
      a.focus();
      await user.keyboard('j');
      expect(b).toHaveFocus();
      await user.keyboard('k');
      expect(a).toHaveFocus();
      await user.keyboard('{Shift>}{F10}{/Shift}');
      expect(menu).toHaveBeenCalledExactlyOnceWith(first, { x: 24, y: -8 });
      await user.keyboard('{Escape}');
      expect(escape).toHaveBeenCalledOnce();
    });

    it(`${view} 禁用条目不能选择且Tab跳过`, async () => {
      const user = userEvent.setup();
      const select = vi.fn();
      render(<Harness view={view} disabled onSelect={select} />);
      const entry = screen.getByRole('button', { name: '知识甲' });
      expect(entry).toBeDisabled();
      await user.click(entry);
      expect(select).not.toHaveBeenCalled();
      await user.tab();
      expect(entry).not.toHaveFocus();
    });
  }

  it.each(['{Enter}', ' '])('分组%s可反复折叠展开且焦点不丢', async key => {
    const user = userEvent.setup();
    render(<Harness />);
    const group = screen.getByRole('button', { name: '候选分组2' });
    await user.tab();
    expect(group).toHaveFocus();
    await user.keyboard(key);
    expect(group).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    await user.keyboard(key);
    expect(group).toHaveAttribute('aria-expanded', 'true');
    expect(within(screen.getByRole('list')).getAllByRole('button')).toHaveLength(2);
    expect(group).toHaveFocus();
  });
});

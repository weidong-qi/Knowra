import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OutlinePanel } from './InspectorReadPanels';

const headings = [
  { id: 'root', level: 1, text: '总览' },
  { id: 'deep', level: 4, text: '重复标题' },
  { id: 'branch', level: 2, text: '重复标题' },
  { id: 'leaf', level: 3, text: '子标题' }
];

describe('OutlinePanel 共享按压契约', () => {
  it('保留实际嵌套层级、标题文本及回调原始索引', async () => {
    const navigate = vi.fn();
    render(<OutlinePanel outline={headings} onNavigate={navigate} />);
    const rows = screen.getAllByRole('button');
    expect(rows.map(row => row.dataset.depth)).toEqual(['0', '1', '1', '2']);
    expect(rows.map(row => row.dataset.level)).toEqual(['1', '4', '2', '3']);
    expect(rows[1].style.getPropertyValue('--outline-depth')).toBe('1');
    await userEvent.click(screen.getByRole('button', { name: '跳转到「重复标题」，H2' }));
    expect(navigate).toHaveBeenCalledExactlyOnceWith(headings[2], 2);
  });

  it.each(['{Enter}', ' '])('Tab 保留顺序及焦点状态，%s 激活准确重复标题', async key => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(<OutlinePanel outline={headings} onNavigate={navigate} />);
    const rows = screen.getAllByRole('button');
    for (const row of rows.slice(0, 3)) {
      await user.tab();
      expect(row).toHaveFocus();
    }
    expect(rows[2]).toHaveAttribute('data-focus-visible', 'true');
    await user.keyboard(key);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(headings[2], 2);
    await user.keyboard(key);
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('同级同名标题仍按实际索引导航到第二项', async () => {
    const outline = [
      { id: 'first', level: 2, text: '重复' },
      { id: 'second', level: 2, text: '重复' }
    ];
    const navigate = vi.fn();
    render(<OutlinePanel outline={outline} onNavigate={navigate} />);
    await userEvent.click(screen.getAllByRole('button', { name: '跳转到「重复」，H2' })[1]);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(outline[1], 1);
  });

  it('空大纲仅保留提示，不生成可按条目', () => {
    render(<OutlinePanel outline={[]} onNavigate={vi.fn()} />);
    expect(screen.getByText('添加一至四级标题后，大纲会自动生成。')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});

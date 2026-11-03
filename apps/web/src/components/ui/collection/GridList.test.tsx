import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Badge } from '../status/Badge';
import { GridList, type GridListColumn } from './index';

interface Row {
  id: string;
  title: string;
  tone: 'accent' | 'success';
}

const rows: Row[] = [
  { id: '1', title: '一', tone: 'accent' },
  { id: '2', title: '二', tone: 'success' }
];

const columns: GridListColumn<Row>[] = [
  { id: 'title', template: '2fr', title: true, cell: (r) => r.title },
  { id: 'status', template: '1fr', cell: (r) => <Badge tone={r.tone}>{r.tone}</Badge> }
];

describe('V4-04 GridList', () => {
  it('renders the grid list with rows and selectable cells', () => {
    render(<GridList items={rows} columns={columns} getKey={(r) => r.id} ariaLabel="资料" />);
    // 按 V4-04 验收 P1-6：GridList 是选择列表，不暴露伪 columnheader；列内容由 cell 渲染。
    expect(screen.getByRole('grid', { name: '资料' })).toBeInTheDocument();
    expect(screen.getByText('一')).toBeInTheDocument();
    expect(screen.getByText('二')).toBeInTheDocument();
    expect(screen.getAllByRole('row').length).toBeGreaterThanOrEqual(rows.length);
  });

  it('selects a single row on click in single selection mode', async () => {
    const user = userEvent.setup();
    render(
      <GridList
        items={rows}
        columns={columns}
        getKey={(r) => r.id}
        ariaLabel="资料"
        selectionMode="single"
      />
    );
    const row = screen.getByRole('row', { name: /一/ });
    await user.click(row);
    expect(row).toHaveAttribute('aria-selected', 'true');
  });

  it('toggles rows in multiple selection mode', async () => {
    const user = userEvent.setup();
    render(
      <GridList
        items={rows}
        columns={columns}
        getKey={(r) => r.id}
        ariaLabel="资料"
        selectionMode="multiple"
      />
    );
    const r1 = screen.getByRole('row', { name: /一/ });
    const r2 = screen.getByRole('row', { name: /二/ });
    await user.click(r1);
    await user.click(r2);
    expect(r1).toHaveAttribute('aria-selected', 'true');
    expect(r2).toHaveAttribute('aria-selected', 'true');
  });

  it('renders the empty state when there are no items', () => {
    render(
      <GridList
        items={[]}
        columns={columns}
        getKey={(r) => r.id}
        ariaLabel="资料"
        emptyState={<div data-testid="empty">暂无数据</div>}
      />
    );
    expect(screen.getByTestId('empty')).toBeInTheDocument();
  });
});

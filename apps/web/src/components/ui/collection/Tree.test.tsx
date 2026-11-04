import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tree, type TreeItemData } from './index';

const items: TreeItemData[] = [
  {
    id: 'root',
    label: '工作区',
    children: [
      { id: 'design', label: '设计' },
      { id: 'refactor', label: '重构' }
    ]
  }
];

describe('V4-04 Tree', () => {
  it('renders the treegrid role and the first level rows', () => {
    render(<Tree items={items} ariaLabel="目录" />);
    // React Aria 1.20 把 Tree 渲染为 treegrid + row + gridcell 三件套。
    expect(screen.getByRole('treegrid', { name: '目录' })).toBeInTheDocument();
    expect(screen.getByText('工作区')).toBeInTheDocument();
  });

  it('expands a row with ArrowRight and collapses with ArrowLeft', async () => {
    const user = userEvent.setup();
    render(<Tree items={items} ariaLabel="目录" />);

    expect(screen.queryByText('设计')).not.toBeInTheDocument();
    const root = screen.getByRole('row', { name: '工作区' });
    root.focus();
    expect(root).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(await screen.findByText('设计')).toBeInTheDocument();
    expect(screen.getByText('重构')).toBeInTheDocument();

    await user.keyboard('{ArrowLeft}');
    expect(screen.queryByText('设计')).not.toBeInTheDocument();
  });

  it('marks disabled rows with disabled state', () => {
    render(
      <Tree
        ariaLabel="目录"
        items={[{ id: 'trash', label: '回收站', isDisabled: true }]}
      />
    );
    const row = screen.getByRole('row', { name: '回收站' });
    expect(row).toHaveAttribute('data-disabled', 'true');
  });
});

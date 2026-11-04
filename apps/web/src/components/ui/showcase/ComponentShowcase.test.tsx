import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComponentShowcase } from './index';

describe('V4-04 ComponentShowcase', () => {
  it('renders the hero, all section titles, and key widgets', () => {
    render(<ComponentShowcase />);

    expect(screen.getByRole('heading', { level: 1, name: /Knowra V4 组件展台/ })).toBeInTheDocument();
    expect(screen.getByText(/Canonical Tokens/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Button" })).toBeInTheDocument();
    expect(screen.getByText(/Input \/ SearchBox \/ Checkbox \/ Select/)).toBeInTheDocument();
    expect(screen.getByText(/Dialog \/ Menu \/ Popover \/ Tooltip \/ Tabs/)).toBeInTheDocument();
    expect(screen.getByText(/Tree \/ GridList \/ TagGroup/)).toBeInTheDocument();
    expect(screen.getByText(/Badge \/ EmptyState \/ LoadingState \/ Panel/)).toBeInTheDocument();
  });

  it('lists every canonical color token', () => {
    render(<ComponentShowcase />);
    for (const token of [
      'ink-bg',
      'ink-surface',
      'ink',
      'ink-accent',
      'ink-success',
      'ink-warning',
      'ink-danger'
    ]) {
      expect(screen.getAllByText(`--${token}`).length).toBeGreaterThan(0);
    }
  });

  it('opens the new-resource dialog and exposes its title and fields', async () => {
    const user = userEvent.setup();
    render(<ComponentShowcase />);
    const trigger = screen.getByTestId('trigger-new');
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', {}, { timeout: 3000 });
    expect(dialog).toHaveAccessibleName('新建资料');
    expect(within(dialog).getByLabelText(/^标题/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^位置/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^标签/)).toBeInTheDocument();
  });

  it('opens the delete confirmation dialog and shows the danger button', async () => {
    const user = userEvent.setup();
    render(<ComponentShowcase />);
    const trigger = screen.getByTestId('trigger-delete');
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: '确认删除？' }, { timeout: 3000 });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '确认删除' })).toBeInTheDocument();
  });

  it('opens the menu popover and exposes menu items', async () => {
    const user = userEvent.setup();
    render(<ComponentShowcase />);
    const trigger = screen.getByTestId('trigger-more');
    await user.click(trigger);
    expect(await screen.findByRole('menu', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /复制为 Markdown/ })).toBeInTheDocument();
  });

  it('renders the grid list with 5 sample rows', () => {
    render(<ComponentShowcase />);
    const grid = screen.getByRole('grid', { name: '资料' });
    expect(grid).toBeInTheDocument();
    // 5 行 + 1 容器 = 至少 5 个 row 角色
    expect(screen.getAllByRole('row').length).toBeGreaterThanOrEqual(5);
  });
});

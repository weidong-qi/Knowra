import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs } from './index';

describe('V4-04 Tabs', () => {
  it('renders a tablist with tabs and panels', () => {
    render(
      <Tabs
        aria-label="视图"
        items={[
          { id: 'overview', label: '概览' },
          { id: 'activity', label: '活动' }
        ]}
      >
        {(item) => <div>面板：{item.label}</div>}
      </Tabs>
    );

    expect(screen.getByRole('tablist', { name: '视图' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('面板：概览');
  });

  it('switches panels on ArrowRight / ArrowLeft', async () => {
    const user = userEvent.setup();
    render(
      <Tabs
        aria-label="视图"
        items={[
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' }
        ]}
      >
        {(item) => <div>面板 {item.label}</div>}
      </Tabs>
    );

    const a = screen.getByRole('tab', { name: 'A' });
    a.focus();
    expect(a).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'B' })).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'A' })).toHaveFocus();
  });

  it('renders disabled tabs with disabled state', () => {
    render(
      <Tabs
        aria-label="视图"
        items={[
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B', isDisabled: true }
        ]}
      >
        {(item) => <div>面板 {item.label}</div>}
      </Tabs>
    );
    const disabledTab = screen.getByRole('tab', { name: 'B' });
    expect(disabledTab).toHaveAttribute('data-disabled', 'true');
  });
});

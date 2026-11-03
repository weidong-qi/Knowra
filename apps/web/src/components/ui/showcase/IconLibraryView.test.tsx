import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IconLibraryView, iconGroups } from './IconLibraryView';

describe('IconLibraryView', () => {
  it('lists every exported icon once and filters by component name', async () => {
    const names = iconGroups.flatMap((group) => group.names);
    expect(names).toHaveLength(77);
    expect(new Set(names).size).toBe(77);

    render(<IconLibraryView />);
    expect(screen.getByRole('heading', { name: 'Knowra' })).toBeInTheDocument();
    expect(screen.getAllByRole('figure')).toHaveLength(77);
    expect(screen.getByText('77 / 77')).toBeInTheDocument();

    await userEvent.type(screen.getByRole('searchbox', { name: /搜索图标/ }), 'Backup');
    expect(screen.getAllByRole('figure')).toHaveLength(1);
    expect(screen.getByText('BackupIcon')).toBeInTheDocument();
    expect(screen.getByText('1 / 77')).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../button/Button';
import { Select } from '../input/Select';
import { Dialog, DialogBody, DialogTrigger } from './Dialog';
import { Menu, MenuItem, MenuPopover, MenuTrigger } from './Menu';
import { ScopedAppearanceProvider, useScopedAppearance } from './ScopedAppearance';
import styles from './Overlay.module.css';

function AppearanceProbe({ label }: { label: string }) {
  const appearance = useScopedAppearance();
  return <div data-testid={label} {...appearance}>{appearance ? 'scoped' : 'default'}</div>;
}

describe('ScopedAppearance', () => {
  it('defaults to null and lets nested providers replace or reset the scope', () => {
    render(<>
      <AppearanceProbe label="outside" />
      <ScopedAppearanceProvider value={{ className: 'outer', 'data-theme': 'dark' }}>
        <AppearanceProbe label="outer" />
        <ScopedAppearanceProvider value={{ className: 'inner', 'data-theme': 'light' }}>
          <AppearanceProbe label="inner" />
        </ScopedAppearanceProvider>
        <ScopedAppearanceProvider value={null}><AppearanceProbe label="reset" /></ScopedAppearanceProvider>
      </ScopedAppearanceProvider>
    </>);
    expect(screen.getByTestId('outside')).toHaveTextContent('default');
    expect(screen.getByTestId('outer')).toHaveAttribute('data-theme', 'dark');
    expect(screen.getByTestId('inner')).toHaveClass('inner');
    expect(screen.getByTestId('inner')).not.toHaveClass('outer');
    expect(screen.getByTestId('inner')).toHaveAttribute('data-theme', 'light');
    expect(screen.getByTestId('reset')).toHaveTextContent('default');
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });

  it('preserves base, scope, and explicit menu classes while explicit attributes win', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ScopedAppearanceProvider value={{ className: 'local-theme', 'data-theme': 'dark' }}>
        <MenuTrigger>
          <Button>菜单</Button>
          <MenuPopover className="custom-menu" data-theme="light">
            <Menu ariaLabel="作用域菜单"><MenuItem id="one">选项</MenuItem></Menu>
          </MenuPopover>
        </MenuTrigger>
      </ScopedAppearanceProvider>
    );
    await user.click(screen.getByRole('button', { name: '菜单' }));
    const menu = await screen.findByRole('menu');
    const popover = menu.closest(`.${styles.menuPopover}`);
    expect(popover).toHaveClass(styles.menuPopover, 'local-theme', 'custom-menu');
    expect(popover).toHaveAttribute('data-theme', 'light');
    expect(container).not.toContainElement(menu);
  });

  it('passes appearance through the dialog portal and a nested Select portal', async () => {
    const user = userEvent.setup();
    const { container, unmount } = render(
      <ScopedAppearanceProvider value={{ className: 'local-theme', 'data-theme': 'dark' }}>
        <DialogTrigger>
          <Button>新建</Button>
          <Dialog title="新建项目">
            <DialogBody><Select label="类型" options={[{ id: 'note', label: '笔记' }]} /></DialogBody>
          </Dialog>
        </DialogTrigger>
      </ScopedAppearanceProvider>
    );
    await user.click(screen.getByRole('button', { name: '新建' }));
    const dialog = await screen.findByRole('dialog');
    const underlay = dialog.closest(`.${styles.underlay}`);
    expect(underlay).toHaveClass(styles.underlay, 'local-theme');
    expect(underlay).toHaveAttribute('data-theme', 'dark');
    expect(container).not.toContainElement(dialog);
    await user.click(screen.getByRole('button', { name: /类型/ }));
    const listbox = await screen.findByRole('listbox');
    expect(listbox.closest(`.${styles.popover}`)).toHaveClass(styles.popover, 'local-theme');
    expect(listbox.closest(`.${styles.popover}`)).toHaveAttribute('data-theme', 'dark');
    expect(dialog).not.toContainElement(listbox);
    unmount();
    expect(document.querySelector('.local-theme')).toBeNull();
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });
});

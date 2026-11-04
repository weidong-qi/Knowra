import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScopedAppearanceProvider } from '../../components/ui/overlay/ScopedAppearance';
import { notesIndexAppearanceProps } from '../notes/NotesIndexAppearance';
import { DEFAULT_NOTES_INDEX_APPEARANCE, NOTES_INDEX_APPEARANCE_KEY, setNotesIndexAppearance, useNotesIndexAppearance } from '../notes/notesIndexAppearanceModel';
import { OverlayMaterialSettings } from './OverlayMaterialSettings';

function SettingsSurface() {
  const appearance = useNotesIndexAppearance();
  return <ScopedAppearanceProvider value={notesIndexAppearanceProps(appearance)}><OverlayMaterialSettings /></ScopedAppearanceProvider>;
}

beforeEach(() => { localStorage.clear(); act(() => setNotesIndexAppearance(DEFAULT_NOTES_INDEX_APPEARANCE)); });
afterEach(cleanup);

describe('浮层材质设置', () => {
  it('切换后保存，并让菜单及子菜单 portal 复用当前材质与明暗模式', async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsSurface />);
    expect(screen.getByRole('button', { name: '通透玻璃' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: '磨砂亚克力' }));
    expect(screen.getByRole('button', { name: '磨砂亚克力' })).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(localStorage.getItem(NOTES_INDEX_APPEARANCE_KEY)!)).toMatchObject({ overlayMaterial: 'acrylic' });
    act(() => setNotesIndexAppearance({ mode: 'dark' }));
    const trigger = screen.getByRole('button', { name: '预览菜单' });
    await user.click(trigger);
    const menu = await screen.findByRole('menu', { name: '预览菜单' });
    expect(container).not.toContainElement(menu);
    expect(menu.closest('[data-overlay-material]')).toHaveAttribute('data-overlay-material', 'acrylic');
    expect(menu.closest('[data-ni-mode]')).toHaveAttribute('data-ni-mode', 'dark');
    await user.click(screen.getByRole('menuitem', { name: '状态' }));
    const submenu = await screen.findByRole('menu', { name: '状态' });
    expect(submenu.closest('[data-overlay-material]')).toHaveAttribute('data-overlay-material', 'acrylic');
    expect(submenu.closest('[data-ni-mode]')).toHaveAttribute('data-ni-mode', 'dark');
    expect(screen.getByRole('menuitem', { name: '不可用选项' })).toHaveAttribute('aria-disabled', 'true');
    const status = screen.getByRole('menuitem', { name: '状态' });
    expect(status).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.keyboard(' ');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: '状态' })).toHaveFocus());
    for (const key of ['{ArrowLeft}', '{Escape}']) {
      await user.keyboard('{ArrowRight}');
      await waitFor(() => expect(screen.getByRole('menuitem', { name: '草稿' })).toHaveFocus());
      await user.keyboard(key);
      await waitFor(() => expect(screen.queryByRole('menu', { name: '状态' })).not.toBeInTheDocument());
      expect(screen.getByRole('menu', { name: '预览菜单' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: '状态' })).toHaveFocus();
    }
    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.click(screen.getByRole('button', { name: '通透玻璃' }));
    await user.click(screen.getByRole('button', { name: '预览菜单' }));
    expect(screen.getByRole('menu').closest('[data-overlay-material]')).toHaveAttribute('data-overlay-material', 'glass');
  });
});

it('按钮和对话框偏好持久化，弹窗继承深色模式并在关闭后恢复焦点', async () => {
  const user = userEvent.setup();
  render(<SettingsSurface />);
  for (const name of ['白玻璃', '乳白玻璃', '内嵌托盘']) {
    await user.click(screen.getByRole('button', { name }));
    expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
  }
  expect(JSON.parse(localStorage.getItem(NOTES_INDEX_APPEARANCE_KEY)!)).toMatchObject({
    buttonStyle: 'frost', defaultButtonStyle: 'glass', dialogStyle: 'tray'
  });
  act(() => setNotesIndexAppearance({ mode: 'dark' }));
  const trigger = screen.getByRole('button', { name: '预览对话框' });
  await user.click(trigger);
  const scope = screen.getByRole('dialog', { name: '新建文件夹' }).closest('[data-dialog-style]');
  expect(scope).toHaveAttribute('data-dialog-style', 'tray');
  expect(scope).toHaveAttribute('data-button-style', 'frost');
  expect(scope).toHaveAttribute('data-default-button-style', 'glass');
  expect(scope).toHaveAttribute('data-ni-mode', 'dark');
  await user.keyboard('{Escape}');
  await waitFor(() => expect(trigger).toHaveFocus());
  cleanup();
  render(<SettingsSurface />);
  for (const name of ['白玻璃', '乳白玻璃', '内嵌托盘']) {
    expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
  }
});

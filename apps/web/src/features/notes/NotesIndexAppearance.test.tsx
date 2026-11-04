import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotesIndexAppearanceControls, notesIndexAppearanceProps } from './NotesIndexAppearance';
import { DEFAULT_NOTES_INDEX_APPEARANCE, NOTES_INDEX_APPEARANCE_KEY, parseNotesIndexAppearance, setNotesIndexAppearance, useNotesIndexAppearance } from './notesIndexAppearanceModel';

function Surface() { const appearance = useNotesIndexAppearance(); return <div data-testid="surface" {...notesIndexAppearanceProps(appearance)} />; }
beforeEach(() => { localStorage.clear(); act(() => setNotesIndexAppearance(DEFAULT_NOTES_INDEX_APPEARANCE)); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('全局定稿外观', () => {
  it('校验持久化数据，不接纳未知值', () => {
    expect(parseNotesIndexAppearance({ mode: 'dark', theme: 'invalid', shape: 1, deco: null })).toEqual({ mode: 'dark', theme: 'orange', shape: 'pill', overlayMaterial: 'glass', buttonStyle: 'paper', defaultButtonStyle: 'soft', dialogStyle: 'float' });
  });
  it('旧数据默认通透玻璃，只接受已支持的浮层材质', () => {
    expect(parseNotesIndexAppearance(null).overlayMaterial).toBe('glass');
    expect(parseNotesIndexAppearance({ overlayMaterial: 'unknown' }).overlayMaterial).toBe('glass');
    expect(parseNotesIndexAppearance({ overlayMaterial: 'acrylic' }).overlayMaterial).toBe('acrylic');
    expect(parseNotesIndexAppearance(null).buttonStyle).toBe('paper');
    expect(parseNotesIndexAppearance({ buttonStyle: 'unknown' }).buttonStyle).toBe('paper');
    expect(parseNotesIndexAppearance({ buttonStyle: 'flow' }).buttonStyle).toBe('paper');
    expect(parseNotesIndexAppearance({ buttonStyle: 'frost' }).buttonStyle).toBe('frost');
    expect(parseNotesIndexAppearance(null).defaultButtonStyle).toBe('soft');
    expect(parseNotesIndexAppearance({ defaultButtonStyle: 'unknown' }).defaultButtonStyle).toBe('soft');
    expect(parseNotesIndexAppearance({ defaultButtonStyle: 'glass' }).defaultButtonStyle).toBe('glass');
    expect(parseNotesIndexAppearance(null).dialogStyle).toBe('float');
    expect(parseNotesIndexAppearance({ dialogStyle: 'unknown' }).dialogStyle).toBe('float');
    expect(parseNotesIndexAppearance({ dialogStyle: 'glass' }).dialogStyle).toBe('float');
    expect(parseNotesIndexAppearance({ dialogStyle: 'tray' }).dialogStyle).toBe('tray');
  });
  it('保存材质并在明暗切换与重新挂载时保留', async () => {
    render(<><NotesIndexAppearanceControls /><Surface /></>);
    act(() => setNotesIndexAppearance({ overlayMaterial: 'acrylic' }));
    await userEvent.click(screen.getByRole('button', { name: '切换深色模式' }));
    expect(JSON.parse(localStorage.getItem(NOTES_INDEX_APPEARANCE_KEY)!)).toMatchObject({ mode: 'dark', overlayMaterial: 'acrylic' });
    cleanup();
    render(<Surface />);
    expect(screen.getByTestId('surface')).toHaveAttribute('data-overlay-material', 'acrylic');
    expect(screen.getByTestId('surface')).toHaveAttribute('data-ni-mode', 'dark');
  });
  it('只保留明暗切换，统一完整装饰、胶囊与橙色并持久化', async () => {
    render(<><NotesIndexAppearanceControls /><Surface /></>);
    for (const name of ['素', '完整', '圆角', '胶囊', '黑白配色', '橙色配色']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole('button', { name: '切换深色模式' }));
    const surface = screen.getByTestId('surface');
    expect(surface).toHaveAttribute('data-ni-mode', 'dark');
    expect(surface).toHaveAttribute('data-ni-theme', 'orange');
    expect(surface).toHaveAttribute('data-ni-shape', 'pill');
    expect(surface).not.toHaveAttribute('data-ni-deco');
    expect(JSON.parse(localStorage.getItem(NOTES_INDEX_APPEARANCE_KEY)!)).toEqual({ mode: 'dark', theme: 'orange', shape: 'pill', overlayMaterial: 'glass', buttonStyle: 'paper', defaultButtonStyle: 'soft', dialogStyle: 'float' });
    await userEvent.click(screen.getByRole('button', { name: '切换浅色模式' }));
    expect(surface).toHaveAttribute('data-ni-mode', 'light');
  });
  it('旧原型选项收敛到定稿外观，同时保留明暗偏好', () => {
    expect(parseNotesIndexAppearance({ mode: 'dark', theme: 'mono', shape: 'rounded', deco: 'off' })).toEqual({ mode: 'dark', theme: 'orange', shape: 'pill', overlayMaterial: 'glass', buttonStyle: 'paper', defaultButtonStyle: 'soft', dialogStyle: 'float' });
  });
  it('存储不可用时依然允许切换并在重新挂载后保留会话设置', async () => {
    render(<><NotesIndexAppearanceControls /><Surface /></>);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage denied'); });
    act(() => setNotesIndexAppearance({ overlayMaterial: 'acrylic' }));
    await userEvent.click(screen.getByRole('button', { name: '切换深色模式' }));
    expect(screen.getByTestId('surface')).toHaveAttribute('data-ni-mode', 'dark');
    cleanup();
    render(<Surface />);
    expect(screen.getByTestId('surface')).toHaveAttribute('data-ni-mode', 'dark');
    expect(screen.getByTestId('surface')).toHaveAttribute('data-overlay-material', 'acrylic');
  });
  it('接收其它标签页的持久化外观更新', () => {
    render(<Surface />);
    localStorage.setItem(NOTES_INDEX_APPEARANCE_KEY, JSON.stringify({ mode: 'dark', deco: 'off', overlayMaterial: 'acrylic' }));
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: NOTES_INDEX_APPEARANCE_KEY })));
    expect(screen.getByTestId('surface')).toHaveAttribute('data-ni-mode', 'dark');
    expect(screen.getByTestId('surface')).not.toHaveAttribute('data-ni-deco');
    expect(screen.getByTestId('surface')).toHaveAttribute('data-overlay-material', 'acrylic');
  });
});

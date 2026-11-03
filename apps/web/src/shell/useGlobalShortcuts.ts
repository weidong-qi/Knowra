// V4-05 useGlobalShortcuts
//
// 安装全局键盘监听：⌘/Ctrl+K 唤起搜索，⌘/Ctrl+/ 切回主页，Mod+Shift+↑/↓ 切换工作域。
// 1. 只在 useEffect 注册一次；卸载时清理。
// 2. 输入框 / textarea / contentEditable 焦点时不抢键。
// 3. 拦截 ⌘/Ctrl+K 默认浏览器行为（聚焦地址栏）。

import { useEffect } from 'react';

export interface GlobalShortcuts {
  onOpenSearch?(): void;
  onOpenCreate?(): void;
  onReturnHome?(): void;
  onCycleDomain?(direction: 1 | -1): void;
}

export function useGlobalShortcuts(shortcuts: GlobalShortcuts): void {
  useEffect(() => {
    function isEditingTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (target.isContentEditable) return true;
      return false;
    }

    function handler(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const isMod = event.metaKey || event.ctrlKey;
      if (!isMod || event.altKey) return;
      const key = event.key.toLowerCase();

      if (key === 'k' && shortcuts.onOpenSearch) {
        event.preventDefault();
        shortcuts.onOpenSearch();
        return;
      }

      if (key === 'n' && shortcuts.onOpenCreate) {
        event.preventDefault();
        shortcuts.onOpenCreate();
        return;
      }

      if (key === '/' && shortcuts.onReturnHome) {
        event.preventDefault();
        shortcuts.onReturnHome();
        return;
      }

      if (event.shiftKey && (key === 'arrowup' || key === 'arrowdown') && shortcuts.onCycleDomain) {
        if (isEditingTarget(event.target)) return;
        event.preventDefault();
        shortcuts.onCycleDomain(key === 'arrowdown' ? 1 : -1);
        return;
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [shortcuts.onOpenSearch, shortcuts.onOpenCreate, shortcuts.onReturnHome, shortcuts.onCycleDomain]);
}

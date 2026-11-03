import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canNavigate } from './navigationGuard';

const HISTORY_KEY = 'knowraNavigation';
const MAXIMUM_KEY = 'knowraNavigationMaximum';
function savedMaximum(fallback: number) {
  try { return readPosition() === null ? fallback : Math.max(fallback, Number(sessionStorage.getItem(MAXIMUM_KEY)) || fallback); } catch { return fallback; }
}
function saveMaximum(value: number) {
  try { sessionStorage.setItem(MAXIMUM_KEY, String(value)); } catch { /* 存储被禁用时仍可使用本次会话历史。 */ }
}
function readPath() { return globalThis.location?.hash.slice(1) || '/'; }
function readPosition(): number | null {
  const value = globalThis.history?.state?.[HISTORY_KEY];
  return Number.isInteger(value) ? value : null;
}

/** 自有历史边界防止后退离开应用；hashchange 也兼容地址栏和原生浏览器导航。 */
export function useHashNavigation() {
  const [pathname, setPathname] = useState(readPath);
  const [position, setPosition] = useState(() => readPosition() ?? 0);
  const maximum = useRef(savedMaximum(position));
  const current = useRef(position);
  const currentPath = useRef(pathname);
  useEffect(() => {
    if (readPosition() === null) {
      history.replaceState({ ...history.state, [HISTORY_KEY]: 0 }, '');
      saveMaximum(0);
    }
    function onChange() {
      let next = readPosition();
      if (readPath() !== currentPath.current && !canNavigate()) {
        if (next !== null && next !== current.current) history.go(current.current - next);
        else history.replaceState({ ...history.state, [HISTORY_KEY]: current.current }, '', `#${currentPath.current}`);
        return;
      }
      if (next === null) {
        next = current.current + 1;
        maximum.current = next;
        saveMaximum(next);
        history.replaceState({ ...history.state, [HISTORY_KEY]: next }, '');
      }
      current.current = next;
      setPosition(next);
      setPathname(readPath());
      currentPath.current = readPath();
    }
    globalThis.addEventListener('popstate', onChange);
    globalThis.addEventListener('hashchange', onChange);
    // 首次渲染到订阅事件之间可能已改变地址；补读快照，避免页面仍停留在旧路由。
    if (readPath() !== currentPath.current) onChange();
    return () => {
      globalThis.removeEventListener('popstate', onChange);
      globalThis.removeEventListener('hashchange', onChange);
    };
  }, []);
  const navigate = useCallback((to: string) => {
    if (readPath() === to) return;
    if (!canNavigate()) return;
    const next = current.current + 1;
    history.pushState({ [HISTORY_KEY]: next }, '', `#${to}`);
    current.current = next;
    maximum.current = next;
    saveMaximum(next);
    setPosition(next);
    setPathname(to);
    currentPath.current = to;
  }, []);
  const back = useCallback(() => { if (current.current > 0 && canNavigate()) history.back(); }, []);
  const forward = useCallback(() => { if (current.current < maximum.current && canNavigate()) history.forward(); }, []);
  return useMemo(() => ({ pathname, navigate, back, forward, canGoBack: position > 0, canGoForward: position < maximum.current }), [pathname, navigate, back, forward, position]);
}

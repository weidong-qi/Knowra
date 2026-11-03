import { closestFromEventTarget } from '../../dom/event-target.js';

// aside-events/tabs.js
// 侧栏顶部 tab 切换。1 个监听器（click）。
// 派发 [data-aside-tab]，仅当 dataset.asideTab 存在且目标 tab 与当前
// state.asideTab 不同时才切换并 renderSidebar。

export function bindAsideTabsEvents({ state, elements, deps }) {
  const { getCurrentNote, renderSidebar } = deps;

  function activateTab(tabKey, { focus = false } = {}) {
    if (!tabKey) return;
    if (state.asideTab !== tabKey) {
      state.asideTab = tabKey;
      renderSidebar(getCurrentNote());
    }
    if (focus) {
      elements.asideTabs?.querySelector?.(`[data-aside-tab="${escapeTabSelector(tabKey)}"]`)?.focus?.();
    }
  }

  elements.asideTabs?.addEventListener('click', (event) => {
    const button = closestFromEventTarget(event.target, '[data-aside-tab]');
    if (!button?.dataset.asideTab) {
      return;
    }
    activateTab(button.dataset.asideTab, { focus: true });
  });

  elements.asideTabs?.addEventListener('keydown', (event) => {
    const button = closestFromEventTarget(event.target, '[data-aside-tab]');
    if (!button?.dataset.asideTab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = Array.from(elements.asideTabs.querySelectorAll?.('[data-aside-tab]') ?? []);
    const currentIndex = tabs.indexOf(button);
    if (currentIndex < 0 || !tabs.length) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    activateTab(tabs[nextIndex]?.dataset?.asideTab, { focus: true });
  });
}

function escapeTabSelector(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return String(value).replace(/"/g, '\\"');
}

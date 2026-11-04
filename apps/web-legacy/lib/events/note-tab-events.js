import { closestFromEventTarget } from '../dom/event-target.js';

// note-tab-events.js
// 顶部笔记标签栏（elements.noteTabs / elements.noteTabMenu）相关的事件
// 绑定，10 个监听器覆盖：
//   noteTabs:
//     1. click         - 关闭按钮 [data-tab-close] / 选中 tab [data-tab-note-id]
//     2. contextmenu   - 在 tab 上右键打开标签菜单
//     3. dragstart     - 启动 tab 拖拽
//     4. dragover      - 拖拽中更新 overId
//     5. drop          - 提交 tab 重排
//     6. dragend       - 重置 tab 拖拽态
//   noteTabMenu:
//     7. click         - 派发 [data-tab-menu-action] 到 handleTabMenuAction
//   noteTabOverflowMenu / document:
//     8. click         - 选择隐藏标签并交接焦点
//   noteTabs:
//     9. keydown       - 方向键/Home/End 导航 Tab
//   window:
//    10. resize        - 重新计算可见/溢出标签
//
// 由 client.js 的 bindEvents() 在初始化时一次性注册。

export function bindNoteTabEvents({ state, elements, deps }) {
  const {
    handleTabClose,
    selectNote,
    selectTabNote,
    openTabMenu,
    syncTabDragIndicators,
    reorderTabs,
    resetTabDragState,
    handleTabMenuAction,
    toggleTabOverflowMenu,
    selectOverflowTab,
    renderTabs
  } = deps;
  const selectTab = selectTabNote ?? selectNote;

  elements.noteTabs?.addEventListener('click', (event) => {
    const overflowButton = closestFromEventTarget(event.target, '[data-tab-overflow-toggle]');
    if (overflowButton) {
      event.stopPropagation();
      toggleTabOverflowMenu();
      return;
    }

    const closeButton = closestFromEventTarget(event.target, '[data-tab-close]');
    if (closeButton?.dataset.tabClose) {
      event.stopPropagation();
      void handleTabClose(closeButton.dataset.tabClose);
      return;
    }

    const tabButton = closestFromEventTarget(event.target, '[data-tab-note-id]');
    if (tabButton?.dataset.tabNoteId) {
      void selectTab(tabButton.dataset.tabNoteId, { syncFolder: true, ensureTab: true });
    }
  });

  elements.noteTabOverflowToggleHost?.addEventListener('click', (event) => {
    const overflowButton = closestFromEventTarget(event.target, '[data-tab-overflow-toggle]');
    if (!overflowButton) {
      return;
    }
    event.stopPropagation();
    toggleTabOverflowMenu();
  });

  elements.noteTabs?.addEventListener('contextmenu', (event) => {
    const tabButton = closestFromEventTarget(event.target, '[data-tab-note-id]');
    if (!tabButton?.dataset.tabNoteId) {
      return;
    }

    event.preventDefault();
    openTabMenu({
      x: event.clientX,
      y: event.clientY,
      noteId: tabButton.dataset.tabNoteId
    });
  });

  elements.noteTabs?.addEventListener('dragstart', (event) => {
    const tabButton = closestFromEventTarget(event.target, '[data-tab-note-id]');
    if (!tabButton?.dataset.tabNoteId) {
      return;
    }

    state.tabDragState.activeId = tabButton.dataset.tabNoteId;
    state.tabDragState.overId = null;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', tabButton.dataset.tabNoteId);
    syncTabDragIndicators();
  });

  elements.noteTabs?.addEventListener('dragover', (event) => {
    const tabButton = closestFromEventTarget(event.target, '[data-tab-note-id]');
    if (!tabButton?.dataset.tabNoteId || !state.tabDragState.activeId) {
      return;
    }

    event.preventDefault();
    state.tabDragState.overId = tabButton.dataset.tabNoteId;
    syncTabDragIndicators();
  });

  elements.noteTabs?.addEventListener('drop', (event) => {
    const tabButton = closestFromEventTarget(event.target, '[data-tab-note-id]');
    if (!tabButton?.dataset.tabNoteId || !state.tabDragState.activeId) {
      return;
    }

    event.preventDefault();
    state.openNoteTabs = reorderTabs(
      state.openNoteTabs,
      state.tabDragState.activeId,
      tabButton.dataset.tabNoteId
    );
    resetTabDragState();
  });

  elements.noteTabs?.addEventListener('dragend', () => {
    resetTabDragState();
  });

  elements.noteTabMenu?.addEventListener('click', (event) => {
    const actionButton = closestFromEventTarget(event.target, '[data-tab-menu-action]');
    if (!actionButton) {
      return;
    }
    void handleTabMenuAction(actionButton.dataset.tabMenuAction);
  });

  function handleOverflowMenuClick(event) {
    const noteButton = closestFromEventTarget(event.target, '[data-tab-overflow-note-id]');
    if (!noteButton?.dataset.tabOverflowNoteId) {
      return;
    }
    event.stopPropagation?.();
    void selectOverflowTab(noteButton.dataset.tabOverflowNoteId);
  }

  elements.noteTabOverflowMenu?.addEventListener('click', handleOverflowMenuClick);

  elements.noteTabs?.addEventListener('keydown', (event) => {
    const currentTab = closestFromEventTarget(event.target, '[role="tab"]');
    if (!currentTab) {
      return;
    }

    const tabs = Array.from(elements.noteTabs?.querySelectorAll?.('[role="tab"]') ?? []);
    const currentIndex = tabs.indexOf(currentTab);
    if (currentIndex === -1) {
      return;
    }

    let nextIndex = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex === null || nextIndex === currentIndex) {
      return;
    }

    const nextTab = tabs[nextIndex];
    const noteId = nextTab.closest?.('[data-tab-note-id]')?.dataset.tabNoteId;
    if (!noteId) {
      return;
    }

    event.preventDefault();
    nextTab.focus?.({ preventScroll: true });
    void selectTab(noteId, { syncFolder: true, ensureTab: true });
  });

  globalThis.window?.addEventListener?.('resize', renderTabs);
}

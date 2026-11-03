import { closestFromEventTarget } from '../dom/event-target.js';

// document-click-events.js
// document 级 click 事件绑定：格式化按钮 + 外部点击关闭已打开菜单。
// 由 client.js 的 bindEvents() 在初始化时一次性注册。
// 注意：共有两个独立 document.click 监听器，顺序敏感（先格式按钮，
// 再外部点击关闭菜单），拆出去时保持两个 addEventListener 调用。
//
// 显式使用 globalThis.document 而非裸标识符 `document`，避免在 Node
// 测试时被 ESM 模块级 binding 缓存影响 mock 替换；浏览器中两者等价。

export function bindDocumentClickEvents({ state, elements, deps }) {
  const {
    handleFormat,
    renderSearchShell,
    closeContextMenu,
    closeSectionMenu,
    closeTabMenu,
    closeTabOverflowMenu,
    closeEditorMenuBar,
    closeEditorContextMenu
  } = deps;

  const documentRef = globalThis.document;

  documentRef.addEventListener('click', (event) => {
    const formatButton = closestFromEventTarget(event.target, '[data-format]');
    if (!formatButton) {
      return;
    }
    void handleFormat(formatButton.dataset.format);
  });

  documentRef.addEventListener('click', (event) => {
    if (!closestFromEventTarget(event.target, '#global-search-shell') && state.search.isOpen) {
      state.search.isOpen = false;
      renderSearchShell();
    }
    if (closestFromEventTarget(event.target, '#library-context-menu')) return;
    if (closestFromEventTarget(event.target, '#library-section-menu')) return;
    if (closestFromEventTarget(event.target, '#note-tab-menu')) return;
    if (closestFromEventTarget(event.target, '#note-tab-overflow-menu')) return;
    if (closestFromEventTarget(event.target, '[data-tab-overflow-note-id]')) return;
    if (closestFromEventTarget(event.target, '[data-tab-overflow-toggle]')) return;
    if (closestFromEventTarget(event.target, '#editor-menu-bar')) return;
    if (closestFromEventTarget(event.target, '#editor-context-menu')) return;
    if (closestFromEventTarget(event.target, '#editor-table-dialog')) return;
    if (closestFromEventTarget(event.target, '#secondary-nav-toggle')) return;
    closeContextMenu();
    closeSectionMenu();
    closeTabMenu();
    closeTabOverflowMenu();
    closeEditorMenuBar();
    closeEditorContextMenu();
  });
}

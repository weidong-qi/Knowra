// menu-events.js
// 顶部菜单相关元素的 click 事件绑定：
//   - contextMenu:   派发 [data-context-action] 到 handleContextMenuAction
//   - sectionMenu:   切换 [data-section-toggle]，更新 state.secondarySections
//                    并触发 renderFolders()
//   - editorMenuBar: 切换 [data-editor-menu-toggle]（打开/折叠子菜单），
//                    派发 [data-{file,edit,paragraph,format,view}-menu-action]
//                    到对应的 handleXxxMenuAction
//
// 由 client.js 的 bindEvents() 在初始化时一次性注册。菜单行为在 deps
// 指向的 command / state 模块；本 binder 只做"派发 → 调 deps"。
// 注意 editorMenuBar handler 顶部 event.stopPropagation() 保留，
// 防止 document.click 外部关闭链立刻把刚打开的菜单关掉。

import { closestFromEventTarget } from '../dom/event-target.js';

export function bindMenuEvents({ state, elements, deps }) {
  const {
    handleContextMenuAction,
    renderFolders,
    renderEditorMenuBar,
    handleFileMenuAction,
    handleEditMenuAction,
    handleParagraphMenuAction,
    handleFormatMenuAction,
    handleViewMenuAction,
    handleFormat
  } = deps;

  elements.contextMenu?.addEventListener('click', (event) => {
    const menuItem = closestFromEventTarget(event.target, '[data-context-action]');
    if (!menuItem) {
      return;
    }
    void handleContextMenuAction(menuItem.dataset.contextAction);
  });

  elements.sectionMenu?.addEventListener('click', (event) => {
    const menuItem = closestFromEventTarget(event.target, '[data-section-toggle]');
    if (!menuItem) {
      return;
    }

    const key = menuItem.dataset.sectionToggle;
    state.secondarySections[key] = !state.secondarySections[key];
    renderFolders();
  });

  elements.editorMenuBar?.addEventListener('click', (event) => {
    event.stopPropagation();

    const menuToggle = closestFromEventTarget(event.target, '[data-editor-menu-toggle]');
    if (menuToggle?.dataset.editorMenuToggle) {
      const menuKey = menuToggle.dataset.editorMenuToggle;
      const isOpening = state.editorMenuOpen !== menuKey;
      state.editorMenuOpen = isOpening ? menuKey : null;
      renderEditorMenuBar({
        focusMenuKey: menuKey,
        focusTarget: isOpening ? 'first-item' : 'trigger'
      });
      return;
    }

    const fileAction = closestFromEventTarget(event.target, '[data-file-menu-action]');
    if (fileAction?.dataset.fileMenuAction) {
      void handleFileMenuAction(fileAction.dataset.fileMenuAction);
      return;
    }

    const quickFormat = closestFromEventTarget(event.target, '[data-format]');
    if (quickFormat?.dataset.format) {
      void handleFormat(quickFormat.dataset.format);
      return;
    }

    const editAction = closestFromEventTarget(event.target, '[data-edit-menu-action]');
    if (editAction?.dataset.editMenuAction) {
      void handleEditMenuAction(editAction.dataset.editMenuAction);
    }

    const paragraphAction = closestFromEventTarget(event.target, '[data-paragraph-menu-action]');
    if (paragraphAction?.dataset.paragraphMenuAction) {
      void handleParagraphMenuAction(paragraphAction.dataset.paragraphMenuAction);
    }

    const formatAction = closestFromEventTarget(event.target, '[data-format-menu-action]');
    if (formatAction?.dataset.formatMenuAction) {
      void handleFormatMenuAction(formatAction.dataset.formatMenuAction);
      return;
    }

    const viewAction = closestFromEventTarget(event.target, '[data-view-menu-action]');
    if (viewAction?.dataset.viewMenuAction) {
      void handleViewMenuAction(viewAction.dataset.viewMenuAction);
    }
  });
}

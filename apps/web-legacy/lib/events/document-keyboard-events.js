import { isComposingEvent } from '../dom/composition.js';
import { closestFromEventTarget } from '../dom/event-target.js';

// document-keyboard-events.js
// document 级 keydown 事件绑定：全局 Escape/⌘K + 捕获阶段编辑
// 器快捷键/表格对话框/查找面板。
// 由 client.js 的 bindEvents() 在初始化时一次性注册。
//
// 共有两个独立 document.keydown 监听器，顺序敏感：
//   1. 冒泡阶段：Escape 关闭所有已打开菜单/面板（最后调用 closeTableInsertDialog）。
//   2. 捕获阶段 (true)：表格对话框 Enter/Esc → 查找面板 Enter → 编辑器
//      快捷键 → Escape 关闭查找面板；这条必须在冒泡前优先处理，避免被
//      外部 click 的 Escape 行为影响。
//
// 显式使用 globalThis.document 而非裸标识符 `document`，避免在 Node
// 测试时被 ESM 模块级 binding 缓存影响 mock 替换；浏览器中两者等价。

export function bindDocumentKeyboardEvents({ state, elements, deps }) {
  const {
    renderSearchShell,
    focusSearchInput,
    closeContextMenu,
    closeSectionMenu,
    closeTabMenu,
    closeTabOverflowMenu,
    closeEditorMenuBar,
    closeEditorContextMenu,
    closeTableInsertDialog,
    submitTableInsertDialog,
    resolveEditorPanelKeyboardAction,
    handleEditorPanelAction,
    resolveEditorShortcutAction,
    shouldHandleEditorShortcut,
    handleResolvedEditorShortcut,
    closeEditorPanel
  } = deps;

  const documentRef = globalThis.document;

  documentRef.addEventListener('keydown', (event) => {
    if (isComposingEvent(event)) {
      return;
    }

    if (event.key === 'Escape') {
      if (state.search.isOpen) {
        state.search.isOpen = false;
        renderSearchShell();
      }
      closeContextMenu();
      closeSectionMenu();
      closeTabMenu();
      closeTabOverflowMenu({ restoreFocus: true });
      closeEditorMenuBar({ restoreFocus: true });
      closeEditorContextMenu();
      closeTableInsertDialog();
    }
  });

  documentRef.addEventListener('keydown', (event) => {
    if (isComposingEvent(event)) {
      return;
    }

    const normalizedKey = String(event.key || '').toLowerCase();
    if ((event.metaKey || event.ctrlKey) && normalizedKey === 'k' && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      state.search.isOpen = true;
      renderSearchShell();
      focusSearchInput();
      return;
    }

    const tableDialog = closestFromEventTarget(event.target, '#editor-table-dialog');
    if (tableDialog && state.editorTableDialog.open) {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        void submitTableInsertDialog();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeTableInsertDialog();
        return;
      }
    }

    if (state.editorPanel.open && state.editorPanel.mode === 'find') {
      const action = resolveEditorPanelKeyboardAction(event);
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        void handleEditorPanelAction(action === 'previous' ? 'submit-previous' : 'submit');
        return;
      }
    }

    const shortcutAction = resolveEditorShortcutAction(event);
    if (shortcutAction && shouldHandleEditorShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
      void handleResolvedEditorShortcut(shortcutAction);
      return;
    }

    if (event.key === 'Escape') {
      closeEditorPanel();
    }
  }, true);
}

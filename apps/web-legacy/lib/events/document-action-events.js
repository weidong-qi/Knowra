import { closestFromEventTarget } from '../dom/event-target.js';

// document-action-events.js
// document 级 click 事件绑定：表格对话框动作 / 编辑器面板动作 / 全局保存。
// 由 client.js 的 bindEvents() 在初始化时一次性注册。
//
// 共有 1 个 document.click 监听器，按 closest 顺序短路：
//   1. [data-editor-table-dialog-action]：confirm → submitTableInsertDialog
//      其余 → closeTableInsertDialog
//   2. [data-editor-panel-action]：派发到 handleEditorPanelAction
//   3. [data-save-now]：派发到 persistDraft({ immediate: true })
//
// 显式使用 globalThis.document 而非裸标识符 `document`，避免在 Node
// 测试时被 ESM 模块级 binding 缓存影响 mock 替换；浏览器中两者等价。

export function bindDocumentActionEvents({ state, elements, deps }) {
  const {
    submitTableInsertDialog,
    closeTableInsertDialog,
    handleEditorPanelAction,
    persistDraft,
    handleViewMenuAction
  } = deps;

  const documentRef = globalThis.document;

  documentRef.addEventListener('click', (event) => {
    const statusAction = closestFromEventTarget(event.target, '[data-status-action]');
    if (statusAction?.dataset.statusAction) {
      void handleViewMenuAction(statusAction.dataset.statusAction);
      return;
    }

    const tableDialogAction = closestFromEventTarget(event.target, '[data-editor-table-dialog-action]');
    if (tableDialogAction?.dataset.editorTableDialogAction) {
      const action = tableDialogAction.dataset.editorTableDialogAction;
      if (action === 'confirm') {
        void submitTableInsertDialog();
      } else {
        closeTableInsertDialog();
      }
      return;
    }

    const panelAction = closestFromEventTarget(event.target, '[data-editor-panel-action]');
    if (panelAction?.dataset.editorPanelAction) {
      void handleEditorPanelAction(panelAction.dataset.editorPanelAction);
      return;
    }

    const saveButton = closestFromEventTarget(event.target, '[data-save-now]');
    if (!saveButton) {
      return;
    }
    void persistDraft({ immediate: true });
  });
}

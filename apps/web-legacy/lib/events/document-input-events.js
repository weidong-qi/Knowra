import { closestFromEventTarget, getEventTargetElement } from '../dom/event-target.js';

// document-input-events.js
// document 级 input 事件绑定：表格对话框字段 + 编辑器查找面板字段。
// 由 client.js 的 bindEvents() 在初始化时一次性注册。
//
// 共有 1 个 document.input 监听器，按 closest 顺序短路：
//   1. #editor-table-dialog：data-table-dialog-field ∈ {rows, cols} 写
//      state.editorTableDialog 对应字段。
//   2. #editor-utility-panel：data-panel-field ∈ {query, replacement}
//      写 state.editorPanel；query 分支还清空匹配索引并调用
//      currentEditorHost.clearSearchHighlights()。
// 两者都未命中则直接 return。
//
// currentEditorHost 是模块级 let（编辑器切换时被重新赋值），
// 因此 deps 通过 getter 函数传递，保证 input 触发时拿到的是最新实例。
//
// 显式使用 globalThis.document 而非裸标识符 `document`，避免在 Node
// 测试时被 ESM 模块级 binding 缓存影响 mock 替换；浏览器中两者等价。

export function bindDocumentInputEvents({ state, elements, deps }) {
  const { getCurrentEditorHost } = deps;

  const documentRef = globalThis.document;

  documentRef.addEventListener('input', (event) => {
    const tableDialog = closestFromEventTarget(event.target, '#editor-table-dialog');
    if (tableDialog) {
      const target = getEventTargetElement(event.target) ?? event.target;
      if (target?.dataset?.tableDialogField === 'rows') {
        state.editorTableDialog.rows = target.value;
      } else if (target?.dataset?.tableDialogField === 'cols') {
        state.editorTableDialog.cols = target.value;
      }
      return;
    }

    const panel = closestFromEventTarget(event.target, '#editor-utility-panel');
    if (!panel) {
      return;
    }

    const target = getEventTargetElement(event.target) ?? event.target;
    if (!target?.dataset?.panelField) {
      return;
    }

    if (target.dataset.panelField === 'query') {
      state.editorPanel.query = target.value;
      state.editorPanel.matchIndex = -1;
      state.editorPanel.matchCount = 0;
      void getCurrentEditorHost()?.clearSearchHighlights();
    } else if (target.dataset.panelField === 'replacement') {
      state.editorPanel.replacement = target.value;
    }
  });
}

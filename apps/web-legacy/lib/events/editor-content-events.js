import { closestFromEventTarget } from '../dom/event-target.js';

// editor-content-events.js
// 编辑器区域（elements.editorContent / elements.editorContextMenu）相关的
// 事件绑定，5 个监听器覆盖：
//   editorContent:
//     1. contextmenu              - 在 milkdown host / preview 上右键打开
//                                   编辑器上下文菜单
//     2. annotation-marker-click - Milkdown 内部派发的 CustomEvent，
//                                   跳到侧栏对应知识点
//     3. input                    - 源码模式编辑（[data-source-editor-input]）
//                                   触发自动保存 + 预览同步
//     4. click                    - 源码模式保存按钮（[data-source-save]）
//                                   立即持久化草稿
//   editorContextMenu:
//     5. click                    - 派发 [data-editor-context-action]
//
// currentEditorHost 是模块级 let，通过 deps 中的 getter 注入以保持
// live binding（编辑器切换时拿到新实例）。
// 显式使用 globalThis.Element 而非裸标识符，避免在 Node 测试环境
// 引用 DOM 类型时抛出 ReferenceError。
//
// 由 client.js 的 bindEvents() 在初始化时一次性注册。

export function bindEditorContentEvents({ state, elements, deps }) {
  const ElementRef = globalThis.Element;
  const {
    getCurrentEditorHost,
    getCurrentNote,
    openEditorContextMenu,
    focusAnnotationFromMarker,
    handleEditorContextMenuAction,
    scheduleAutosave,
    syncSourcePreview,
    persistDraft,
    renderSidebar
  } = deps;

  elements.editorContent?.addEventListener('contextmenu', (event) => {
    if (!getCurrentEditorHost() || !getCurrentNote() || state.view.showSourceEditor) {
      return;
    }

    const target = closestFromEventTarget(event.target, '.milkdown-host, .preview-rendered');
    if (!(target instanceof ElementRef)) {
      return;
    }

    event.preventDefault();
    openEditorContextMenu({
      x: event.clientX,
      y: event.clientY
    });
  });

  elements.editorContent?.addEventListener('annotation-marker-click', (event) => {
    const { annotationId } = event.detail ?? {};
    if (!annotationId) {
      return;
    }

    focusAnnotationFromMarker({ annotationId });
  });

  elements.editorContextMenu?.addEventListener('click', (event) => {
    const actionButton = closestFromEventTarget(event.target, '[data-editor-context-action]');
    if (!actionButton?.dataset.editorContextAction) {
      return;
    }

    event.stopPropagation();
    void handleEditorContextMenuAction(actionButton.dataset.editorContextAction);
  });

  elements.editorContent?.addEventListener('input', (event) => {
    const sourceInput = closestFromEventTarget(event.target, '[data-source-editor-input]');
    if (!sourceInput) {
      return;
    }

    state.draftMarkdown = sourceInput.value;
    scheduleAutosave();
    syncSourcePreview();
    renderSidebar(getCurrentNote());
  });

  elements.editorContent?.addEventListener('click', (event) => {
    const sourceSaveButton = closestFromEventTarget(event.target, '[data-source-save]');
    if (!sourceSaveButton) {
      return;
    }

    void persistDraft({ immediate: true });
  });
}

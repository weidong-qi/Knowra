// folder-tree-events.js
// 左侧文件树（elements.folderTree）相关的事件绑定，10 个监听器覆盖：
//   1. click           - 切换 section / 展开文件夹 / 选中文件夹 / 选中笔记
//                       + 内联编辑器取消 / 确认删除 / 取消删除
//   2. contextmenu     - 打开右键菜单
//   3. dragstart       - 启动拖拽
//   4. dragover        - 拖拽中更新 overKind/overId
//   5. drop            - 提交 drop
//   6. dragend         - 重置拖拽态
//   7. submit          - 内联编辑器表单提交
//   8. keydown         - 内联编辑器 Escape 取消
//   9. input           - 内联编辑器 input.value 双向同步到 state.treeEditor
//
// 由 client.js 的 bindEvents() 在初始化时一次性注册。所有判断逻辑（是否
// 可拖、哪个 target）保留在 deps 指向的 helper（resolveClickTarget 等）；
// 本 binder 只做"读取 dataset / 调用 deps"。

import { closestFromEventTarget } from '../dom/event-target.js';

export function bindFolderTreeEvents({ state, elements, deps }) {
  const {
    closeContextMenu,
    renderFolders,
    toggleFolderOpen,
    selectFolder,
    selectNote,
    renderStatus,
    openContextMenu,
    syncDragIndicators,
    canDropOnTarget,
    commitDrop,
    resetDragState,
    submitTreeEditor,
    cancelTreeEditor,
    commitDelete,
    clearDeleteIntent,
    resolveClickTarget,
    resolveContextMenuTarget,
    resolveDropTarget
  } = deps;

  // 第一个 click：处理 toggle-section / toggle-folder / select-folder /
  // select-note。注意 select-note 分支没有 return，会 fall-through 到
  // 下一个 click 监听器（处理内联编辑器按钮），与原行为一致。
  elements.folderTree?.addEventListener('click', (event) => {
    const clickTarget = resolveClickTarget(event.target);
    if (!clickTarget) {
      return;
    }

    if (clickTarget.type === 'toggle-section') {
      state.navSections[clickTarget.sectionKey] = !(state.navSections[clickTarget.sectionKey] ?? false);
      closeContextMenu();
      renderFolders();
      return;
    }

    if (clickTarget.type === 'toggle-folder') {
      event.stopPropagation();
      toggleFolderOpen(clickTarget.folderId);
      return;
    }

    if (clickTarget.type === 'select-folder') {
      void selectFolder(clickTarget.folderId);
      return;
    }

    if (clickTarget.type === 'select-note') {
      void selectNote(clickTarget.noteId, { syncFolder: true });
    }
  });

  // 第二个 click：内联编辑器取消 / 确认删除 / 取消删除按钮。
  // 顺序在 select-target click 之后，确保点击到树节点时不会误触发。
  elements.folderTree?.addEventListener('click', (event) => {
    const cancelButton = closestFromEventTarget(event.target, '[data-editor-cancel]');
    if (cancelButton) {
      cancelTreeEditor();
      return;
    }

    const confirmDelete = closestFromEventTarget(event.target, '[data-delete-confirm]');
    if (confirmDelete) {
      void commitDelete(confirmDelete.dataset.deleteConfirm, confirmDelete.dataset.targetId);
      return;
    }

    const cancelDelete = closestFromEventTarget(event.target, '[data-delete-cancel]');
    if (cancelDelete) {
      clearDeleteIntent();
    }
  });

  elements.folderTree?.addEventListener('contextmenu', (event) => {
    const contextTarget = resolveContextMenuTarget(event.target);
    if (!contextTarget) {
      return;
    }

    event.preventDefault();

    if (contextTarget.selectFolderId) {
      state.selectedFolderId = contextTarget.selectFolderId;
      renderStatus();
    }

    openContextMenu({
      x: event.clientX,
      y: event.clientY,
      targetKind: contextTarget.kind,
      targetId: contextTarget.id
    });
  });

  elements.folderTree?.addEventListener('dragstart', (event) => {
    const draggable = closestFromEventTarget(event.target, '[data-drag-kind][data-drag-id]');
    if (!draggable || state.treeEditor) {
      event.preventDefault();
      return;
    }

    const dragKind = draggable.dataset.dragKind;
    const dragId = draggable.dataset.dragId;
    state.dragState = {
      activeKind: dragKind,
      activeId: dragId,
      overKind: null,
      overId: null
    };

    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `${dragKind}:${dragId}`);
    syncDragIndicators();
  });

  elements.folderTree?.addEventListener('dragover', (event) => {
    const dropTarget = resolveDropTarget(event.target);
    if (!dropTarget || !canDropOnTarget(state.dragState, dropTarget)) {
      if (state.dragState.overKind || state.dragState.overId) {
        state.dragState.overKind = null;
        state.dragState.overId = null;
        syncDragIndicators();
      }
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    if (
      state.dragState.overKind !== dropTarget.kind
      || state.dragState.overId !== dropTarget.id
    ) {
      state.dragState.overKind = dropTarget.kind;
      state.dragState.overId = dropTarget.id;
      syncDragIndicators();
    }
  });

  elements.folderTree?.addEventListener('drop', (event) => {
    const dropTarget = resolveDropTarget(event.target);
    if (!dropTarget || !canDropOnTarget(state.dragState, dropTarget)) {
      return;
    }

    event.preventDefault();
    void commitDrop(dropTarget);
  });

  elements.folderTree?.addEventListener('dragend', () => {
    if (!state.dragState.activeKind) {
      return;
    }
    resetDragState();
  });

  elements.folderTree?.addEventListener('submit', (event) => {
    const form = closestFromEventTarget(event.target, '[data-inline-editor-form]');
    if (!form) {
      return;
    }

    event.preventDefault();
    void submitTreeEditor();
  });

  elements.folderTree?.addEventListener('keydown', (event) => {
    const input = closestFromEventTarget(event.target, '[data-inline-editor-input]');
    if (!input) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      cancelTreeEditor();
    }
  });

  elements.folderTree?.addEventListener('input', (event) => {
    const input = closestFromEventTarget(event.target, '[data-inline-editor-input]');
    if (!input || !state.treeEditor) {
      return;
    }

    state.treeEditor.value = input.value;
  });
}

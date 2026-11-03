import {
  renderDeleteIntentRow as renderDeleteIntentRowMarkup,
  renderEmptyTreeItem,
  renderFolderIcon,
  renderInlineEditorRow as renderInlineEditorRowMarkup,
  renderNoteNode as renderNoteNodeMarkup,
  renderRecycleNoteNode as renderRecycleNoteNodeMarkup
} from '../../../../lib/navigation/tree-renderers.js';
import { renderIcon } from '../../../../lib/icons/icon-map.js';
import { getDirectNotesForFolder as selectDirectNotesForFolder } from '../../../../lib/navigation/visibility.js';
import { resolveNoteVisualType } from '../../../../lib/tree-workspace.js';

export function createNavigationTreeRenderController(deps) {
  const {
    state,
    noteMatchesSelectedTags,
    matchesSearch,
    matchesFolderSearch,
    escapeHtml
  } = deps;

  function renderMaterialsTree(topFolders) {
    const parts = [];
    const rootNotes = getDirectNotesForFolder(null)
      .filter((note) => matchesSearch(note.title) && noteMatchesSelectedTags(note));

    if (isCreateEditorForParent(null)) {
      parts.push(renderInlineEditorRow(1, state.treeEditor.mode, state.treeEditor.value));
    }

    if (topFolders.length === 0 && rootNotes.length === 0) {
      parts.push(renderEmptyItem(state.dataMode === 'loading' ? '正在加载资料...' : '暂无目录'));
    } else {
      parts.push(...topFolders.map((folder) => renderFolderNode(folder, 1)));
      parts.push(...rootNotes.map((note) => renderNoteNode(note, 1)));
    }

    return parts.join('');
  }

  function renderFolderNode(folder, level) {
    const childFolders = (folder.children ?? []).filter((childFolder) => matchesFolderSearch(childFolder));
    const childNotes = getDirectNotesForFolder(folder.id)
      .filter((note) => matchesSearch(note.title) && noteMatchesSelectedTags(note));
    const hasChildren = childFolders.length > 0 || childNotes.length > 0 || isCreateEditorForParent(folder.id);
    const isOpen = state.openFolders[folder.id] ?? true;
    const selected = folder.id === state.selectedFolderId;
    const isRenaming = state.treeEditor?.mode === 'rename-folder' && state.treeEditor.targetId === folder.id;
    const isDeleting = state.deleteIntent?.kind === 'folder' && state.deleteIntent.targetId === folder.id;
    const isDragging = state.dragState.activeKind === 'folder' && state.dragState.activeId === folder.id;
    const isDropTarget = state.dragState.overKind === 'folder' && state.dragState.overId === folder.id;

    const rowMarkup = isRenaming
      ? renderInlineEditorRow(level, 'rename-folder', state.treeEditor.value)
      : `
        <button
          type="button"
          class="library-node library-folder-node"
          data-folder-id="${folder.id}"
          data-level="${level}"
          data-selected="${selected}"
          data-drag-kind="folder"
          data-drag-id="${folder.id}"
          data-dragging="${isDragging}"
          data-drop-target="${isDropTarget}"
          title="${escapeHtml(folder.name)}"
          draggable="true"
        >
          <span class="library-node-leading">
            <span class="library-chevron-hitbox" data-folder-toggle="${folder.id}">
              ${hasChildren
                ? renderIcon('navigationChevron', {
                  className: 'library-chevron',
                  data: { 'data-open': isOpen }
                })
                : '<span class="library-node-spacer"></span>'}
            </span>
            ${renderFolderIcon(isOpen)}
          </span>
          <span class="library-node-label">${escapeHtml(folder.name)}</span>
        </button>
      `;

    const childrenMarkup = [];

    if (isOpen) {
      if (isCreateEditorForParent(folder.id)) {
        childrenMarkup.push(renderInlineEditorRow(level + 1, state.treeEditor.mode, state.treeEditor.value));
      }

      childrenMarkup.push(...childFolders.map((childFolder) => renderFolderNode(childFolder, level + 1)));
      childrenMarkup.push(...childNotes.map((note) => renderNoteNode(note, level + 1)));
    }

    if (isDeleting) {
      childrenMarkup.unshift(renderDeleteIntentRow(level + 1, 'folder', folder.id, folder.name));
    }

    return `
      <div class="library-node-group">
        ${rowMarkup}
        ${isOpen || isDeleting ? `<div class="library-node-children">${childrenMarkup.join('')}</div>` : ''}
      </div>
    `;
  }

  function renderNoteNode(note, level) {
    const selected = note.id === state.selectedNoteId;
    const isRenaming = state.treeEditor?.mode === 'rename-note' && state.treeEditor.targetId === note.id;
    const isDeleting = state.deleteIntent?.kind === 'note' && state.deleteIntent.targetId === note.id;
    const isDragging = state.dragState.activeKind === 'note' && state.dragState.activeId === note.id;
    const iconKind = resolveNoteVisualType(note);

    const rowMarkup = isRenaming
      ? renderInlineEditorRow(level, 'rename-note', state.treeEditor.value)
      : renderNoteNodeMarkup({ note, level, selected, isDragging, iconKind });

    if (!isDeleting) {
      return rowMarkup;
    }

    return `
      <div class="library-node-group">
        ${rowMarkup}
        <div class="library-node-children">
          ${renderDeleteIntentRow(level + 1, 'note', note.id, note.title)}
        </div>
      </div>
    `;
  }

  function renderRecycleNoteNode(note, level) {
    return renderRecycleNoteNodeMarkup({
      note,
      level,
      iconKind: resolveNoteVisualType(note)
    });
  }

  function renderInlineEditorRow(level, mode, value) {
    return renderInlineEditorRowMarkup({ level, mode, value });
  }

  function renderDeleteIntentRow(level, kind, targetId, name) {
    return renderDeleteIntentRowMarkup({ level, kind, targetId, name });
  }

  function renderEmptyItem(label) {
    return renderEmptyTreeItem(label);
  }

  function getDirectNotesForFolder(folderId) {
    return selectDirectNotesForFolder(state.allNotes, folderId);
  }

  function isCreateEditorForParent(parentId) {
    return Boolean(
      state.treeEditor
      && (state.treeEditor.mode === 'create-folder' || state.treeEditor.mode === 'create-note')
      && state.treeEditor.parentId === parentId
    );
  }

  return {
    renderMaterialsTree,
    renderFolderNode,
    renderNoteNode,
    renderRecycleNoteNode,
    renderInlineEditorRow,
    renderDeleteIntentRow,
    renderEmptyItem,
    getDirectNotesForFolder,
    isCreateEditorForParent
  };
}

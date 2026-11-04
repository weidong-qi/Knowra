import { createMilkdownHost } from '../../../lib/editor/milkdown-bundle.js';
import { ensureOpenTab } from '../../../lib/editor/tab-workspace.js';
import {
  buildMarkdownImportItems,
  buildNoteExportHtml,
  buildExportFileName,
  createDuplicateTitle,
  createLocalDuplicateNoteInput,
  createUntitledName,
  deriveNoteTitleFromMarkdown,
  getSiblingNamesForFolder,
  getMarkdownImportStatusMessage
} from '../../../lib/editor/file-menu.js';
import {
  applyEditorPanelMatchResult,
  createOpenedEditorPanelState
} from '../../../lib/editor/editor-panel-state.js';
import {
  createLocalDraftNote,
  resolveDraftSaveState
} from '../../../lib/editor/draft-state.js';
import { renderEditorPanelMarkup } from '../../../lib/editor/editor-panel-renderers.js';
import { extractMarkdownHeadings, renderMarkdownPreview } from '../../../lib/markdown.js';
import { replaceNoteInCollection } from '../../../lib/workspace-normalization.js';
import { insertNote as insertLocalNote } from '../../../lib/tree-workspace.js';
import { createLocalImportedNoteInput } from '../../../lib/notes/state.js';
import { getEditorShortcutLabel } from '../../../lib/editor/shortcut-actions.js';
import { EDITOR_CONTEXT_PRIMARY_ACTIONS } from '../../../lib/editor/context-menu-model.js';
import { renderEditorContextMenuMarkup } from '../../../lib/editor/context-menu-renderers.js';
import { renderEditorMenuBarMarkup } from '../../../lib/editor/menu-renderers.js';
import { getSaveStateLabel } from '../../../lib/editor/save-indicator.js';
import {
  renderPreviewPane as renderPreviewPaneMarkup,
  renderSourceEditorPane as renderSourceEditorPaneMarkup,
  renderSourceEditorView as renderSourceEditorViewMarkup
} from '../../../lib/editor/preview-renderers.js';
import { renderRichEditorHost } from '../../../lib/editor/view-renderers.js';
import { resolveEditorRenderState } from '../../../lib/editor/view-state.js';
import {
  normalizeTableDialogValue,
  renderTableInsertDialogMarkup
} from '../../../lib/editor/table-dialog-renderers.js';

export function createEditorContextMenuController(deps, getController) {
  const {
    state,
    elements,
    editorRuntime,
    knowledgeApi,
    autosaveDelayMs,
    getCurrentNote,
    getEffectiveViewState,
    renderAll,
    renderTabs,
    renderFolders,
    renderSidebar,
    renderStatus,
    persistBackendCache,
    refreshKnowledgeData,
    loadCurrentNoteSideData,
    syncLocalWorkspace,
    openFolderBranch,
    closeContextMenu,
    closeSectionMenu,
    closeTabMenu,
    createAnnotationFromCurrentSelection,
    syncAnnotationMarkers,
    flashStatus,
    escapeHtml,
    escapeAttribute
  } = deps;

function renderEditorContextMenu() {
  if (!elements.editorContextMenu) {
    return;
  }

  if (!state.editorContextMenu.open || !getCurrentNote() || state.view.showSourceEditor) {
    elements.editorContextMenu.hidden = true;
    elements.editorContextMenu.innerHTML = '';
    return;
  }

  elements.editorContextMenu.hidden = false;
  elements.editorContextMenu.innerHTML = renderEditorContextMenuMarkup({
    getShortcutLabel: getEditorShortcutLabel
  });
  syncEditorContextMenuPosition();
  syncEditorContextSubmenuLayout();
}

function syncEditorContextSubmenuLayout() {
  if (!elements.editorContextMenu || elements.editorContextMenu.hidden) {
    return;
  }

  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const submenuGroups = elements.editorContextMenu.querySelectorAll('.editor-context-submenu-group');
  submenuGroups.forEach((submenuGroup) => {
    const trigger = submenuGroup.querySelector('.editor-context-submenu-trigger');
    const submenu = submenuGroup.querySelector('.editor-context-submenu');
    if (!trigger || !submenu) {
      return;
    }

    submenuGroup.dataset.submenuSide = 'right';
    submenuGroup.dataset.submenuAlign = 'top';
    submenuGroup.style.setProperty('--submenu-offset-y', '-8px');

    const previousDisplay = submenu.style.display;
    const previousVisibility = submenu.style.visibility;
    submenu.style.display = 'grid';
    submenu.style.visibility = 'hidden';

    const triggerRect = trigger.getBoundingClientRect();
    const submenuRect = submenu.getBoundingClientRect();
    const fitsRight = triggerRect.right + submenuRect.width - 4 <= viewportWidth - 12;
    submenuGroup.dataset.submenuSide = fitsRight ? 'right' : 'left';

    let offsetY = -8;
    if (triggerRect.top + offsetY < 12) {
      offsetY = 12 - triggerRect.top;
    }
    if (triggerRect.top + offsetY + submenuRect.height > viewportHeight - 12) {
      offsetY = viewportHeight - 12 - triggerRect.top - submenuRect.height;
      submenuGroup.dataset.submenuAlign = 'bottom';
    }
    submenuGroup.style.setProperty('--submenu-offset-y', `${Math.round(offsetY)}px`);

    submenu.style.display = previousDisplay;
    submenu.style.visibility = previousVisibility;
  });
}

function openEditorContextMenu({ x, y }) {
  state.editorContextMenu.open = true;
  state.editorContextMenu.x = x;
  state.editorContextMenu.y = y;
  state.editorMenuOpen = null;
  closeContextMenu();
  closeSectionMenu();
  closeTabMenu();
  getController().renderEditorMenuBar();
  renderEditorContextMenu();
}

function closeEditorContextMenu() {
  if (!state.editorContextMenu.open) {
    return;
  }

  state.editorContextMenu.open = false;
  renderEditorContextMenu();
}

async function handleEditorContextMenuAction(action) {
  closeEditorContextMenu();

  const note = getCurrentNote();
  if (!note) {
    flashStatus('请先选择一篇笔记');
    return;
  }

  if (!editorRuntime.currentEditorHost) {
    flashStatus('编辑器尚未就绪');
    return;
  }

  if (action === 'table') {
    getController().openTableInsertDialog();
    return;
  }

  if (action === 'create-annotation') {
    await createAnnotationFromCurrentSelection(note);
    return;
  }

  if (EDITOR_CONTEXT_PRIMARY_ACTIONS.includes(action)) {
    await getController().handleEditMenuAction(action);
    return;
  }

  await editorRuntime.currentEditorHost.run(action);
  await editorRuntime.currentEditorHost.focus();
}

function syncEditorContextMenuPosition() {
  if (!elements.editorContextMenu || elements.editorContextMenu.hidden) {
    return;
  }

  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const panel = elements.editorContextMenu.querySelector('.editor-context-panel');
  if (!panel) {
    elements.editorContextMenu.style.left = `${state.editorContextMenu.x}px`;
    elements.editorContextMenu.style.top = `${state.editorContextMenu.y}px`;
    return;
  }

  const panelRect = panel.getBoundingClientRect();
  const clampedX = Math.min(Math.max(8, state.editorContextMenu.x), Math.max(8, viewportWidth - panelRect.width - 8));
  const clampedY = Math.min(Math.max(8, state.editorContextMenu.y), Math.max(8, viewportHeight - panelRect.height - 8));
  elements.editorContextMenu.style.left = `${Math.round(clampedX)}px`;
  elements.editorContextMenu.style.top = `${Math.round(clampedY)}px`;
}

  return {
    renderEditorContextMenu,
    syncEditorContextSubmenuLayout,
    openEditorContextMenu,
    closeEditorContextMenu,
    handleEditorContextMenuAction,
    syncEditorContextMenuPosition
  };
}

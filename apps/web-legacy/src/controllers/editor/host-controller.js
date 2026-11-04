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
import {
  buildAttachmentReferenceUrl,
  removeAttachmentReferencesFromMarkdown
} from '../../../lib/sidebar/attachments.js';
import { guardWorkspaceWrite } from '../../../lib/workspace-write-guard.js';

export function createEditorHostController(deps, getController) {
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
    restoreEditorScrollPosition,
    flashStatus,
    escapeHtml,
    escapeAttribute
  } = deps;

async function teardownEditorHost() {
  editorRuntime.pendingEditorNoteId = null;
  editorRuntime.pendingEditorMarkdown = null;
  editorRuntime.currentEditorNoteId = null;
  editorRuntime.currentEditorMarkdown = null;
  editorRuntime.editorMountToken += 1;

  if (!editorRuntime.currentEditorHost) {
    return;
  }

  const host = editorRuntime.currentEditorHost;
  editorRuntime.currentEditorHost = null;
  await host.destroy();
}

function mountEditorHost(noteId, markdown) {
  const root = document.getElementById('milkdown-editor');
  if (!root) {
    return;
  }

  if (
    editorRuntime.pendingEditorNoteId === noteId
    && editorRuntime.pendingEditorMarkdown === markdown
  ) {
    return;
  }

  const token = ++editorRuntime.editorMountToken;
  editorRuntime.pendingEditorNoteId = noteId;
  editorRuntime.pendingEditorMarkdown = markdown;
  const previousHost = editorRuntime.currentEditorHost;
  editorRuntime.currentEditorHost = null;
  editorRuntime.currentEditorNoteId = null;
  editorRuntime.currentEditorMarkdown = null;

  void (async () => {
    if (previousHost) {
      await previousHost.destroy();
    }

    const handleAttachmentUpload = async (input) => {
      if (!guardWorkspaceWrite({ dataMode: state.dataMode, flashStatus })) {
        return '';
      }
      const uploaded = await knowledgeApi.uploadAttachmentImage(input);
      const attachment = uploaded?.attachment ?? null;
      if (attachment?.id && attachment.noteId === state.selectedNoteId) {
        state.attachments = [
          ...state.attachments.filter((item) => item?.id !== attachment.id),
          attachment
        ];
        renderSidebar(getCurrentNote());
      }
      return uploaded?.referenceUrl
        ?? buildAttachmentReferenceUrl(attachment?.id)
        ?? uploaded?.contentUrl
        ?? '';
    };

    const host = createMilkdownHost({
      root,
      markdown,
      noteId,
      uploadAttachmentImage: handleAttachmentUpload,
      onInsecureImageSources: () => {
        flashStatus('检测到 HTTP 图片，已阻止插入。请先下载图片，再直接粘贴或上传为本地附件。');
      },
      onChange: handleEditorMarkdownChange
    });

    await host.ready;

    if (token !== editorRuntime.editorMountToken || state.selectedNoteId !== noteId) {
      await host.destroy();
      return;
    }

    editorRuntime.currentEditorHost = host;
    editorRuntime.currentEditorNoteId = noteId;
    editorRuntime.currentEditorMarkdown = markdown;
    editorRuntime.pendingEditorNoteId = null;
    editorRuntime.pendingEditorMarkdown = null;
    syncAnnotationMarkers();
    getController().renderEditorSaveIndicator();
    renderStatus();

    // 恢复之前保存的滚动位置
    restoreEditorScrollPosition(noteId);
  })().catch((error) => {
    if (token === editorRuntime.editorMountToken) {
      editorRuntime.pendingEditorNoteId = null;
      editorRuntime.pendingEditorMarkdown = null;
    }
    flashStatus(error.message || '编辑器加载失败');
  });
}

function handleEditorMarkdownChange(markdown) {
  if (!editorRuntime.currentEditorNoteId || editorRuntime.currentEditorNoteId !== state.selectedNoteId) {
    return;
  }

  editorRuntime.currentEditorMarkdown = markdown;
  if (markdown === state.draftMarkdown) {
    return;
  }

  state.draftMarkdown = markdown;
  renderSidebar(getCurrentNote());
  getController().scheduleAutosave();
}

async function insertAttachmentAtCursor(attachment) {
  if (!guardWorkspaceWrite({ dataMode: state.dataMode, flashStatus })) {
    return false;
  }
  const note = getCurrentNote();
  if (!note) {
    flashStatus('请先选择一篇笔记');
    return false;
  }

  if (state.view.showSourceEditor) {
    flashStatus('请先切回富文本编辑区后再插入附件');
    return false;
  }

  const editorHost = editorRuntime.currentEditorHost;
  if (!editorHost) {
    flashStatus('编辑器尚未就绪');
    return false;
  }

  const attachmentId = attachment?.id ?? '';
  const referenceUrl = buildAttachmentReferenceUrl(attachmentId);
  if (!attachmentId || !referenceUrl) {
    flashStatus('当前附件缺少可插入的引用地址');
    return false;
  }

  const label = escapeMarkdownLinkLabel(attachment?.fileName || '附件');
  const markdown = String(attachment?.mimeType || '').startsWith('image/')
    ? `![${label}](${referenceUrl})\n\n`
    : `[${label}](${referenceUrl})`;

  await editorHost.focus();
  const inserted = await editorHost.pasteMarkdown(markdown);
  if (!inserted) {
    flashStatus('当前附件插入失败');
    return false;
  }

  if (String(attachment?.mimeType || '').startsWith('image/')) {
    await ensureParagraphBelowImage(editorHost);
  }

  flashStatus('附件已插入到当前光标位置');
  return true;
}

async function ensureParagraphBelowImage(editorHost) {
  if (!editorHost || typeof editorHost.run !== 'function') {
    return false;
  }

  const inserted = await editorHost.run('paragraph-below');
  if (inserted) {
    return true;
  }

  return editorHost.pasteMarkdown?.('\n') ?? false;
}

async function removeAttachmentFromCurrentNote(attachment) {
  if (!guardWorkspaceWrite({ dataMode: state.dataMode, flashStatus })) {
    return false;
  }
  const note = getCurrentNote();
  if (!note) {
    flashStatus('请先选择一篇笔记');
    return false;
  }

  if (state.view.showSourceEditor) {
    flashStatus('请先切回富文本编辑区后再移除附件引用');
    return false;
  }

  const editorHost = editorRuntime.currentEditorHost;
  if (!editorHost) {
    flashStatus('编辑器尚未就绪');
    return false;
  }

  const attachmentId = attachment?.id ?? '';
  if (!attachmentId) {
    flashStatus('当前附件缺少可移除的引用标识');
    return false;
  }

  const currentMarkdown = await editorHost.getMarkdown();
  const nextMarkdown = removeAttachmentReferencesFromMarkdown(currentMarkdown, attachmentId);
  if (nextMarkdown === currentMarkdown) {
    flashStatus('当前笔记正文中未找到该附件的引用');
    return false;
  }

  await editorHost.setMarkdown(nextMarkdown);
  state.draftMarkdown = nextMarkdown;
  renderSidebar(getCurrentNote());
  getController().scheduleAutosave();
  await editorHost.focus();
  flashStatus('已从当前笔记移除该附件引用');
  return true;
}

  return {
    teardownEditorHost,
    mountEditorHost,
    handleEditorMarkdownChange,
    insertAttachmentAtCursor,
    removeAttachmentFromCurrentNote
  };
}

function escapeMarkdownLinkLabel(value) {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]');
}

import { knowledgeBaseSeed } from '../../lib/mock-knowledge-base.js';
import { extractMarkdownHeadings } from '../../lib/markdown.js';
import { buildNotePath } from '../../lib/navigation/selection.js';
import { createClearedNoteSideData, createLocalNoteSideData } from '../../lib/sidebar/state.js';
import { ASIDE_TABS, resolveAsideContentKey } from '../../lib/sidebar/tabs.js';
import {
  renderAiTab,
  renderAsideEmptyState,
  renderAsideTabs
} from '../../lib/sidebar/renderers.js';
import { renderInfoTab as renderInfoTabMarkup } from '../../lib/sidebar/info-panel.js';
import { renderOutlineTab as renderOutlineTabMarkup } from '../../lib/sidebar/outline-panel.js';
import { createAttachmentCommandsController } from './sidebar/attachment-commands-controller.js';
import { createAttachmentRenameController } from './sidebar/attachment-rename-controller.js';
import { createOutlineController } from './sidebar/outline-controller.js';
import { isAttachmentReferencedInMarkdown } from '../../lib/sidebar/attachments.js';
import { renderAnnotationPanel } from '../../lib/sidebar/annotation-panel.js';
import { guardWorkspaceWrite } from '../../lib/workspace-write-guard.js';

export function createSidebarController(deps) {
  const {
    state,
    elements,
    knowledgeApi,
    getCurrentNote,
    syncAnnotationMarkers,
    flashStatus,
    formatDate,
    getEditorScrollRoot,
    cancelPendingEditorScrollRestore
  } = deps;

  const attachmentCommands = createAttachmentCommandsController({ elements, flashStatus });
  const attachmentRenameController = createAttachmentRenameController({
    state,
    knowledgeApi,
    getCurrentNote,
    renderSidebar,
    flashStatus
  });
  const outlineController = createOutlineController({
    state,
    elements,
    getCurrentNote,
    renderSidebar,
    flashStatus,
    getEditorScrollRoot,
    cancelPendingEditorScrollRestore
  });
  let sideDataRequestSequence = 0;
  let sidebarRenderSequence = 0;
  let renderedSidebarNoteId = null;
  const panelScrollPositions = new Map();

async function loadCurrentNoteSideData() {
  if (state.dataMode === 'local') {
    loadLocalNoteSideData(state.selectedNoteId);
    return true;
  }
  return loadApiNoteSideData(state.selectedNoteId);
}

async function deleteAttachment(attachmentId) {
  if (!guardWorkspaceWrite({ dataMode: state.dataMode, flashStatus })) {
    return false;
  }
  if (!attachmentId) {
    flashStatus('缺少要删除的附件');
    return false;
  }

  const attachment = state.attachments.find((item) => item?.id === attachmentId);
  const currentNote = getCurrentNote();
  const currentMarkdown = state.draftMarkdown || currentNote?.rawMarkdown || '';
  if (attachment && isAttachmentReferencedInMarkdown(attachment, currentMarkdown)) {
    flashStatus('当前附件仍在正文中被引用，请先删除正文引用');
    return false;
  }

  await knowledgeApi.deleteAttachment(attachmentId);
  state.attachments = state.attachments.filter((attachment) => attachment?.id !== attachmentId);
  if (state.attachmentRenaming?.id === attachmentId) {
    state.attachmentRenaming = null;
  }
  renderSidebar(getCurrentNote());
  flashStatus('附件已删除');
  return true;
}

async function loadApiNoteSideData(noteId) {
  const requestSequence = ++sideDataRequestSequence;
  if (!noteId) {
    clearNoteSideData();
    syncAnnotationMarkers();
    return true;
  }

  try {
    const note = state.allNotes.find((item) => item.id === noteId);
    const spaceId = note?.spaceId ?? state.currentSpaceId;
    const sideData = await knowledgeApi.loadNoteSideData({ noteId, spaceId });
    if (
      requestSequence !== sideDataRequestSequence
      || state.selectedNoteId !== noteId
    ) {
      return false;
    }
    state.linkedNotes = sideData.linkedNotes;
    state.attachments = sideData.attachments;
    state.attachmentRenaming = null;
    state.annotations = sideData.annotations;
    state.annotationLoadState = 'loaded';
    state.noteVersions = sideData.noteVersions ?? [];
    state.knowledgeItems = sideData.knowledgeItems ?? [];
    state.learningObjectives = sideData.learningObjectives ?? [];
    state.questions = sideData.questions ?? [];
    state.knowledgeDomainLoadState = sideData.knowledgeDomainLoadState ?? 'loaded';
    syncAnnotationMarkers();
    return true;
  } catch (error) {
    if (
      requestSequence !== sideDataRequestSequence
      || state.selectedNoteId !== noteId
    ) {
      return false;
    }
    clearNoteSideData();
    syncAnnotationMarkers();
    flashStatus(`附加信息加载失败：${error.message}`);
    return false;
  }
}

function loadLocalNoteSideData(noteId) {
  sideDataRequestSequence += 1;
  if (!noteId) {
    clearNoteSideData();
    syncAnnotationMarkers();
    return;
  }

  Object.assign(state, createLocalNoteSideData({ noteId, notes: state.allNotes, attachments: knowledgeBaseSeed.attachments }));
  state.annotations = [];
  state.attachmentRenaming = null;
  syncAnnotationMarkers();
}

function clearNoteSideData() {
  sideDataRequestSequence += 1;
  Object.assign(state, createClearedNoteSideData());
  state.annotations = [];
}

function renderSidebar(note, focusRequest = null) {
  if (!elements.asideTabs || !elements.asideContent) {
    return;
  }
  const renderSequence = ++sidebarRenderSequence;
  captureSidebarPanelScroll();

  elements.asideTabs.innerHTML = renderAsideTabs({
    tabs: ASIDE_TABS,
    activeKey: state.asideTab
  });
  elements.asideTabs.setAttribute?.('role', 'tablist');
  elements.asideTabs.setAttribute?.('aria-label', '资料边注');
  elements.asideContent.setAttribute?.('role', 'tabpanel');
  elements.asideContent.setAttribute?.('aria-labelledby', `aside-tab-${state.asideTab}`);
  elements.asideContent.setAttribute?.('tabindex', '0');

  const contentKey = resolveAsideContentKey({
    note,
    activeTab: state.asideTab
  });

  elements.asideContent.innerHTML = (() => {
    if (contentKey === 'empty') return renderAsideEmptyState();

    switch (contentKey) {
      case 'outline':
        return renderOutlineTab(note);
      case 'concepts':
        return renderConceptsTab(note);
      case 'ai':
        return renderAiTab(note);
      case 'info':
      default:
        return renderInfoTab(note);
    }
  })();

  restoreSidebarPanelScroll(note);
  renderedSidebarNoteId = note?.id ?? null;

  scheduleSidebarFocusRestore({
    container: elements.asideContent,
    focusRequest,
    isCurrent: () => renderSequence === sidebarRenderSequence
  });
}

function captureSidebarPanelScroll() {
  const activeTabId = elements.asideContent.getAttribute?.('aria-labelledby');
  const activeTab = activeTabId?.replace(/^aside-tab-/, '');
  const scrollRoot = elements.asideContent.querySelector?.('.aside-panel-scroll');
  if (!renderedSidebarNoteId || !activeTab || typeof scrollRoot?.scrollTop !== 'number') {
    return;
  }

  panelScrollPositions.set(`${renderedSidebarNoteId}:${activeTab}`, scrollRoot.scrollTop);
}

function restoreSidebarPanelScroll(note) {
  const scrollRoot = elements.asideContent.querySelector?.('.aside-panel-scroll');
  if (!note?.id || typeof scrollRoot?.scrollTop !== 'number') {
    return;
  }

  scrollRoot.scrollTop = panelScrollPositions.get(`${note.id}:${state.asideTab}`) ?? 0;
}

function renderInfoTab(note) {
  return renderInfoTabMarkup({
    note,
    markdown: state.draftMarkdown || note.rawMarkdown || '',
    folderPath: buildNotePath({
      note,
      foldersById: state.foldersById
    }),
    tags: state.tags,
    tagComposer: state.noteTagComposer,
    linkedNotes: state.linkedNotes,
    attachments: state.attachments,
    attachmentRenaming: state.attachmentRenaming,
    formatDate
  });
}

function scheduleSidebarFocusRestore({ container, focusRequest, isCurrent }) {
  const selector = focusRequest?.selector;
  if (!selector || typeof container?.querySelector !== 'function') return;

  scheduleAfterInteraction(() => {
    if (!isCurrent()) return;
    const target = container.querySelector(selector);
    if (!target) return;

    const disclosure = target.closest?.('details');
    if (disclosure) disclosure.open = true;
    target.focus?.();
    if (focusRequest.select) {
      target.select?.();
    } else if (Number.isInteger(focusRequest.caret)) {
      target.setSelectionRange?.(focusRequest.caret, focusRequest.caret);
    }
  });
}

function scheduleAfterInteraction(callback) {
  setTimeout(callback, 0);
}

function renderOutlineTab() {
  const headings = extractMarkdownHeadings(state.draftMarkdown || '');
  const currentNote = getCurrentNote();
  const noteId = currentNote?.id ?? '';
  const collapsedHeadingIds = state.outlineCollapsedHeadingIdsByNote[noteId] ?? {};

  return renderOutlineTabMarkup({
    headings,
    noteId,
    collapsedHeadingIds
  });
}

function renderConceptsTab() {
  return renderAnnotationPanel(state.annotations, {
    knowledgeItems: state.knowledgeItems,
    noteVersions: state.noteVersions,
    learningObjectives: state.learningObjectives,
    questions: state.questions
  });
}

  return {
    // 本地方法 —— 直接引用
    loadCurrentNoteSideData,
    loadApiNoteSideData,
    loadLocalNoteSideData,
    clearNoteSideData,
    renderSidebar,
    renderInfoTab,
    renderOutlineTab,
    renderConceptsTab,
    deleteAttachment,
    ...outlineController,
    // attachmentCommands —— 通过子控制器委托
    findAttachmentReferenceTarget: (...args) => attachmentCommands.findAttachmentReferenceTarget(...args),
    jumpToAttachmentReference: (...args) => attachmentCommands.jumpToAttachmentReference(...args),
    openAttachment: (...args) => attachmentCommands.openAttachment(...args),
    copyAttachmentLink: (...args) => attachmentCommands.copyAttachmentLink(...args),
    // attachmentRenameController —— 展开子控制器方法
    ...attachmentRenameController
  };
}

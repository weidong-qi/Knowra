import '@milkdown/kit/prose/view/style/prosemirror.css';

import { editorViewCtx } from '@milkdown/kit/core';
import { callCommand, getMarkdown, replaceAll } from '@milkdown/kit/utils';
import { commandResolvers } from './milkdown/commands/editor-commands.js';
import {
  handleHeadingShortcut,
  handleIndentShortcut,
  handleListShortcut,
  handleOutdentShortcut,
  handleParagraphShortcut,
  insertBlockBelowSelection,
  insertParagraphNearSelection
} from './milkdown/commands/shortcut-handlers.js';
import { syncTableHandleLabels } from './milkdown/table/table-buttons.js';
import { ensureTableHasHeaderRowAtPos } from './milkdown/table/table-document.js';
import { TableHandleController } from './milkdown/table/table-handle-controller.js';
import { createConfiguredMilkdownEditor } from './milkdown/host/editor-factory.js';
import {
  attachImageLayoutObserver,
  disconnectImageLayoutObserver,
  refreshImageBlockLayouts,
  scheduleImageLayoutRefresh
} from './milkdown/host/image-layout-controller.js';
import { attachCodeBlockPlaceholderObserver } from './milkdown/host/code-block-layout-controller.js';
import { uploadAttachmentImage } from './milkdown/host/image-upload.js';
import { pasteImageFile } from './milkdown/host/image-paste-controller.js';
import {
  getSelectionSnapshot,
  selectTextRange
} from './milkdown/host/selection-controller.js';
import {
  attachSelectionMemory,
  restoreLastSelection
} from './milkdown/host/selection-memory-controller.js';
import {
  clearSearchHighlights,
  findAndSelect
} from './milkdown/host/find-controller.js';
import { selectAnnotation, setAnnotations } from './milkdown/host/annotation-source-controller.js';
import { pasteMarkdown } from './milkdown/host/markdown-paste-controller.js';
import { resolveBlockCommandBehavior } from './enter-behavior.js';
import { normalizeMarkdown } from './milkdown/utils/markdown-slice.js';

export class MilkdownHost {
  constructor({
    root,
    markdown = '',
    onChange,
    onInsecureImageSources,
    noteId = null,
    uploadAttachmentImage: uploadAttachment = null
  } = {}) {
    if (!(root instanceof HTMLElement)) {
      throw new Error('MilkdownHost requires a valid root element.');
    }

    this.root = root;
    this.onChange = typeof onChange === 'function' ? onChange : null;
    this.onInsecureImageSources = typeof onInsecureImageSources === 'function'
      ? onInsecureImageSources
      : null;
    this.noteId = typeof noteId === 'string' && noteId.trim() ? noteId.trim() : null;
    this.uploadAttachment = typeof uploadAttachment === 'function' ? uploadAttachment : null;
    this.editor = null;
    this.codeBlockPlaceholderObserver = null;
    this.imageLayoutObserver = null;
    this.imageLayoutRefreshFrame = 0;
    this.imageLayoutLastWidth = 0;
    this.imageLayoutRetryTimers = [];
    this.tableHandleController = null;
    this.lastSelectionRange = null;
    this.detachSelectionMemory = null;
    this.ready = this.mount(normalizeMarkdown(markdown));
  }

  async mount(markdown) {
    this.editor = createConfiguredMilkdownEditor(this, markdown);

    await this.editor.create();
    this.root.dataset.editorReady = 'true';
    this.codeBlockPlaceholderObserver = attachCodeBlockPlaceholderObserver(this.root);
    this.attachImageLayoutObserver();
    this.attachTableHandleController();
    this.attachSelectionMemory();
    syncTableHandleLabels(this.root, this);
    this.scheduleImageLayoutRefresh();
    return this;
  }

  async setMarkdown(markdown) {
    await this.ready;
    this.editor.action(replaceAll(normalizeMarkdown(markdown), true));
    syncTableHandleLabels(this.root, this);
    this.tableHandleController?.queueSyncPinnedHandles();
  }

  async getMarkdown() {
    await this.ready;
    return this.editor.action(getMarkdown());
  }

  async run(commandKey, options = {}) {
    await this.ready;
    const view = this.editor.ctx.get(editorViewCtx);
    if (resolveBlockCommandBehavior(commandKey) === 'insert-below-current-block') {
      return insertBlockBelowSelection(this.editor, commandResolvers, commandKey, options);
    }

    if (commandKey === 'paragraph-above') {
      return insertParagraphNearSelection(this.editor, 'above');
    }
    if (commandKey === 'paragraph-below') {
      return insertParagraphNearSelection(this.editor, 'below');
    }
    if (commandKey === 'indent') {
      return handleIndentShortcut(this.editor);
    }
    if (commandKey === 'outdent') {
      return handleOutdentShortcut(this.editor);
    }
    if (commandKey === 'paragraph') {
      return handleParagraphShortcut(this.editor);
    }
    if (commandKey.startsWith('heading-')) {
      const level = Number(commandKey.split('-')[1]);
      if (Number.isInteger(level) && level >= 1 && level <= 6) {
        return handleHeadingShortcut(this.editor, level);
      }
    }
    if (commandKey === 'bullet' || commandKey === 'ordered') {
      return handleListShortcut(this.editor, commandKey);
    }

    const resolve = commandResolvers[commandKey];
    if (!resolve) {
      return false;
    }

    const { key, payload } = resolve(options);
    const result = await this.editor.action(callCommand(key, payload));
    syncTableHandleLabels(this.root, this);
    this.tableHandleController?.queueSyncPinnedHandles();
    view.focus();
    return result;
  }

  async focus() {
    await this.ready;
    if (restoreLastSelection(this)) {
      return;
    }
    const view = this.editor.ctx.get(editorViewCtx);
    view.focus();
  }

  async getSelectionSnapshot({ contextChars = 80 } = {}) {
    return getSelectionSnapshot(this, { contextChars });
  }

  repairTableAfterDelete(pinnedSnapshot) {
    if (!this.editor || !pinnedSnapshot) {
      return false;
    }

    const repaired = ensureTableHasHeaderRowAtPos(this.editor, pinnedSnapshot.tablePos);
    if (repaired) {
      syncTableHandleLabels(this.root, this);
      this.tableHandleController?.queueSyncPinnedHandles();
    }
    return repaired;
  }

  attachTableHandleController() {
    this.tableHandleController = new TableHandleController(this);
    this.tableHandleController.attach();
  }

  attachSelectionMemory() {
    this.detachSelectionMemory?.();
    this.detachSelectionMemory = attachSelectionMemory(this);
  }

  attachImageLayoutObserver() {
    attachImageLayoutObserver(this);
  }

  disconnectImageLayoutObserver() {
    disconnectImageLayoutObserver(this);
  }

  scheduleImageLayoutRefresh() {
    scheduleImageLayoutRefresh(this);
  }

  scheduleImageLayoutRefreshBurst(delays = [0, 48, 160, 320]) {
    this.clearImageLayoutRetryTimers();
    delays.forEach((delay) => {
      const timerId = window.setTimeout(() => {
        this.imageLayoutRetryTimers = this.imageLayoutRetryTimers.filter((value) => value !== timerId);
        this.scheduleImageLayoutRefresh();
      }, delay);
      this.imageLayoutRetryTimers.push(timerId);
    });
  }

  clearImageLayoutRetryTimers() {
    this.imageLayoutRetryTimers.forEach((timerId) => window.clearTimeout(timerId));
    this.imageLayoutRetryTimers = [];
  }

  refreshImageBlockLayouts() {
    refreshImageBlockLayouts(this);
  }

  async uploadAttachmentImage(file) {
    return uploadAttachmentImage({
      file,
      noteId: this.noteId,
      uploadAttachment: this.uploadAttachment
    });
  }

  pasteImageFile(file) {
    return pasteImageFile(this, file);
  }

  reportInsecureImageSources(urls = []) {
    this.onInsecureImageSources?.([...new Set(urls)]);
  }

  async pasteMarkdown(markdown) {
    return pasteMarkdown(this, markdown);
  }

  async selectTextRange({ startNode, startOffset, endNode, endOffset } = {}) {
    return selectTextRange(this, { startNode, startOffset, endNode, endOffset });
  }

  async findAndSelectNext(query, previousMatchIndex = -1) {
    return this.findAndSelect(query, previousMatchIndex, 'next');
  }

  async findAndSelectPrevious(query, previousMatchIndex = -1) {
    return this.findAndSelect(query, previousMatchIndex, 'previous');
  }

  async findAndSelect(query, previousMatchIndex = -1, direction = 'next') {
    return findAndSelect(this, query, previousMatchIndex, direction);
  }

  async setAnnotations(annotations = []) {
    return setAnnotations(this, annotations);
  }

  async selectAnnotation(annotationId) {
    return selectAnnotation(this, annotationId);
  }

  async clearSearchHighlights() {
    return clearSearchHighlights(this);
  }

  async destroy() {
    if (!this.editor) {
      return;
    }

    await this.ready;
    this.codeBlockPlaceholderObserver?.disconnect();
    this.codeBlockPlaceholderObserver = null;
    this.disconnectImageLayoutObserver();
    this.clearImageLayoutRetryTimers();
    this.tableHandleController?.destroy();
    this.tableHandleController = null;
    this.detachSelectionMemory?.();
    this.detachSelectionMemory = null;
    await this.editor.destroy();
    this.root.dataset.editorReady = 'false';
    this.editor = null;
  }
}

export function createMilkdownHost(options) {
  return new MilkdownHost(options);
}

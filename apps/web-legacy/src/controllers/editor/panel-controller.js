import {
  applyEditorPanelMatchResult,
  createOpenedEditorPanelState
} from '../../../lib/editor/editor-panel-state.js';
import { renderEditorPanelMarkup } from '../../../lib/editor/editor-panel-renderers.js';
import { createEditorTableDialogController } from './panel/table-dialog-controller.js';

export function createEditorPanelController(deps, getController) {
  const {
    state,
    editorRuntime,
    getCurrentNote,
    flashStatus
  } = deps;

  const tableDialog = createEditorTableDialogController(deps, getController);

function openEditorPanel(mode) {
  state.editorPanel = createOpenedEditorPanelState(state.editorPanel, mode);
  getController().closeEditorMenuBar();
  renderEditorPanel();
}

function closeEditorPanel() {
  if (!state.editorPanel.open) {
    return;
  }

  state.editorPanel.open = false;
  void editorRuntime.currentEditorHost?.clearSearchHighlights();
  renderEditorPanel();
}

async function handleEditorPanelAction(action) {
  const note = getCurrentNote();
  if (!note) {
    closeEditorPanel();
    flashStatus('请先选择一篇笔记');
    return;
  }

  if (action === 'close') {
    closeEditorPanel();
    return;
  }

  const query = state.editorPanel.query.trim();
  if (!query) {
    flashStatus('请输入查找内容');
    return;
  }

  const editorHost = editorRuntime.currentEditorHost;

  if (action === 'submit' || action === 'submit-previous') {
    if (state.editorPanel.mode === 'find') {
      const direction = action === 'submit-previous' ? 'previous' : 'next';
      const result = await editorHost?.findAndSelect(query, state.editorPanel.matchIndex, direction);
      if (!result) {
        flashStatus('当前编辑器未就绪');
        return;
      }

      state.editorPanel = applyEditorPanelMatchResult(state.editorPanel, result);
      renderEditorPanel();

      if (!result.found) {
        flashStatus(`未找到：${query}`);
        return;
      }
      flashStatus(`已查找 ${result.index + 1}/${result.count}：${query}`);
      return;
    }

    if (state.editorPanel.mode === 'replace') {
      const replacement = state.editorPanel.replacement;
      const nextMarkdown = state.draftMarkdown.replace(query, replacement);
      if (nextMarkdown === state.draftMarkdown) {
        flashStatus(`未找到：${query}`);
        return;
      }

      state.draftMarkdown = nextMarkdown;
      if (editorHost) {
        await editorHost.setMarkdown(nextMarkdown);
        await editorHost.focus();
      }
      getController().scheduleAutosave();
      flashStatus(`已替换：${query}`);
      renderEditorPanel();
      return;
    }
  }

  if (action === 'replace-all' && state.editorPanel.mode === 'replace') {
    const replacement = state.editorPanel.replacement;
    if (!state.draftMarkdown.includes(query)) {
      flashStatus(`未找到：${query}`);
      return;
    }

    const nextMarkdown = state.draftMarkdown.split(query).join(replacement);
    state.draftMarkdown = nextMarkdown;
    if (editorHost) {
      await editorHost.setMarkdown(nextMarkdown);
      await editorHost.focus();
    }
    getController().scheduleAutosave();
    flashStatus(`已全部替换：${query}`);
    renderEditorPanel();
  }
}

function renderEditorPanel() {
  const panel = document.getElementById('editor-utility-panel');
  if (!panel) {
    return;
  }

  const note = getCurrentNote();
  if (!state.editorPanel.open || !note) {
    panel.hidden = true;
    panel.innerHTML = '';
    return;
  }

  panel.hidden = false;
  panel.dataset.mode = state.editorPanel.mode;
  panel.innerHTML = renderEditorPanelMarkup(state.editorPanel);

  if (state.editorPanel.autoFocusInput) {
    window.requestAnimationFrame(() => {
      const input = panel.querySelector('[data-panel-field="query"]');
      input?.focus();
      input?.select();
      state.editorPanel.autoFocusInput = false;
    });
  }
}

  return {
    openEditorPanel,
    closeEditorPanel,
    handleEditorPanelAction,
    renderEditorPanel,
    ...tableDialog
  };
}

import { closestFromEventTarget } from '../../../../lib/dom/event-target.js';

export function createEditorShortcutCommandController(deps) {
  const {
    state,
    editorRuntime,
    getCurrentNote
  } = deps;

  function shouldHandleEditorShortcut(event) {
    if (!editorRuntime.currentEditorHost || !getCurrentNote() || state.view.showSourceEditor) {
      return false;
    }

    if (closestFromEventTarget(event.target, '#editor-utility-panel')) {
      return false;
    }

    if (closestFromEventTarget(event.target, '[data-source-editor-input]')) {
      return false;
    }

    if (closestFromEventTarget(event.target, '.milkdown-code-block .cm-editor')) {
      return false;
    }

    return Boolean(closestFromEventTarget(event.target, '#editor-content'));
  }

  async function handleResolvedEditorShortcut(action) {
    if (!editorRuntime.currentEditorHost) {
      return;
    }

    await editorRuntime.currentEditorHost.run(action);
    await editorRuntime.currentEditorHost.focus();
  }

  return {
    shouldHandleEditorShortcut,
    handleResolvedEditorShortcut
  };
}

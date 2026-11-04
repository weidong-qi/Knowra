export function createEditorBlockCommandController(deps, getController, menuState) {
  const {
    editorRuntime,
    getCurrentNote,
    flashStatus
  } = deps;

  async function handleFormat(format) {
    if (!editorRuntime.currentEditorHost) {
      return;
    }

    if (format === 'table') {
      getController().openTableInsertDialog();
      return;
    }

    await editorRuntime.currentEditorHost.run(format);
    await editorRuntime.currentEditorHost.focus();
  }

  async function handleParagraphMenuAction(action) {
    await runMenuEditorCommand(action);
  }

  async function handleFormatMenuAction(action) {
    if (action === 'table') {
      menuState.closeEditorMenuBar();

      const note = getCurrentNote();
      if (!note) {
        flashStatus('请先选择一篇笔记');
        return;
      }

      if (!editorRuntime.currentEditorHost) {
        flashStatus('编辑器尚未就绪');
        return;
      }

      getController().openTableInsertDialog();
      return;
    }

    await runMenuEditorCommand(action);
  }

  async function runMenuEditorCommand(action) {
    menuState.closeEditorMenuBar();

    const note = getCurrentNote();
    if (!note) {
      flashStatus('请先选择一篇笔记');
      return;
    }

    if (!editorRuntime.currentEditorHost) {
      flashStatus('编辑器尚未就绪');
      return;
    }

    await editorRuntime.currentEditorHost.run(action);
    await editorRuntime.currentEditorHost.focus();
  }

  return {
    handleFormat,
    handleParagraphMenuAction,
    handleFormatMenuAction
  };
}

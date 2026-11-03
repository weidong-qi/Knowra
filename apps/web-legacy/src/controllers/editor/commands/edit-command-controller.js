import { readClipboardText, runDocumentCommand } from '../../../../lib/browser/clipboard.js';

export function createEditorEditCommandController(deps, getController, menuState) {
  const {
    editorRuntime,
    getCurrentNote,
    flashStatus
  } = deps;

  async function handleEditMenuAction(action) {
    menuState.closeEditorMenuBar();
    getController().closeEditorContextMenu();

    const note = getCurrentNote();
    if (!note) {
      flashStatus('请先选择一篇笔记');
      return;
    }

    const editorHost = editorRuntime.currentEditorHost;
    const focusEditor = async () => {
      if (editorHost) {
        await editorHost.focus();
      }
    };

    switch (action) {
      case 'cut':
      case 'copy':
      case 'delete':
      case 'select-all': {
        await focusEditor();
        const command = action === 'select-all' ? 'selectAll' : action;
        const success = runDocumentCommand(command);
        if (!success) {
          flashStatus('当前环境暂不支持该编辑操作');
        }
        return;
      }
      case 'undo':
      case 'redo': {
        if (!editorHost) {
          flashStatus('编辑器尚未就绪');
          return;
        }
        await editorHost.run(action);
        await focusEditor();
        return;
      }
      case 'paste': {
        await focusEditor();
        const clipboardResult = await readClipboardText();
        if (clipboardResult.ok) {
          if (!clipboardResult.text) {
            flashStatus('剪贴板为空');
            return;
          }

          const inserted = await editorRuntime.currentEditorHost?.pasteMarkdown(clipboardResult.text);
          if (!inserted) {
            flashStatus('当前环境暂不支持粘贴');
          }
          return;
        }

        const pastedNatively = runDocumentCommand('paste');
        if (!pastedNatively) {
          flashStatus('无法读取剪贴板内容，请检查浏览器权限');
        }
        return;
      }
      case 'find': {
        getController().openEditorPanel('find');
        return;
      }
      case 'replace': {
        getController().openEditorPanel('replace');
        return;
      }
      default:
        return;
    }
  }

  return {
    handleEditMenuAction
  };
}

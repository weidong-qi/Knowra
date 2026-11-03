import { createUntitledName } from '../../../lib/editor/file-menu.js';
import { createNoteDuplicateController } from './file/duplicate-controller.js';
import { createNoteExportController } from './file/export-controller.js';
import { createMarkdownImportController } from './file/import-controller.js';
import { createEditorFileTargetController } from './file/target-controller.js';

export function createEditorFileController(deps, getController) {
  const {
    elements,
    getCurrentNote,
    createNote,
    startTreeEditor,
    setNoteFavorite,
    deleteNote,
    restoreNote,
    flashStatus
  } = deps;

  const target = createEditorFileTargetController(deps);
  const importer = createMarkdownImportController(deps, target);
  const duplicate = createNoteDuplicateController(deps, target, getController);
  const exporter = createNoteExportController(deps);

  async function handleFileMenuAction(action) {
    const controller = getController();
    controller.closeEditorMenuBar();

    const note = getCurrentNote();
    const folderId = target.getMenuTargetFolderId();

    switch (action) {
      case 'new-note': {
        const title = createUntitledName(target.getSiblingNames(folderId), 'Untitled Note');
        const created = await createNote(folderId, title);
        if (created === false) return;
        flashStatus(`已创建笔记：${title}`);
        return;
      }
      case 'new-folder': {
        const title = createUntitledName(target.getSiblingNames(folderId), 'Untitled Folder');
        startTreeEditor({ mode: 'create-folder', parentId: folderId, value: title });
        return;
      }
      case 'import-markdown':
        elements.markdownImportInput?.click();
        return;
      case 'favorite-note':
        if (note && !note.deleted) {
          const nextFavorite = !note.favorite;
          const updated = await setNoteFavorite(note.id, nextFavorite);
          if (updated === false) return;
          flashStatus(nextFavorite ? '已收藏笔记' : '已取消收藏');
        }
        return;
      case 'delete-note':
        if (note && !note.deleted) {
          const deleted = await deleteNote(note.id);
          if (deleted === false) return;
          flashStatus('笔记已删除');
        }
        return;
      case 'restore-note':
        if (note?.deleted) {
          const restored = await restoreNote(note.id);
          if (restored === false) return;
          flashStatus('笔记已恢复');
        }
        return;
      case 'save':
        await controller.persistDraft({ immediate: true });
        return;
      case 'save-as':
        await duplicate.duplicateCurrentNote(note);
        return;
      case 'rename':
        if (note) {
          startTreeEditor({ mode: 'rename-note', targetId: note.id, value: note.title });
        }
        return;
      case 'export-markdown':
        exporter.exportCurrentNoteAsMarkdown(note);
        return;
      case 'export-pdf':
        exporter.exportCurrentNoteAsPdfStable(note);
        return;
      default:
        return;
    }
  }

  return {
    handleFileMenuAction,
    ...importer,
    ...target,
    ...duplicate,
    ...exporter
  };
}

import { createNavigationFolderCommandController } from './folder-command-controller.js';
import { createNavigationNoteCommandController } from './note-command-controller.js';
import { createNavigationSelectionCommandController } from './selection-command-controller.js';
import { createNavigationTreeEditorCommandController } from './tree-editor-command-controller.js';

export function createNavigationTreeCommandController(deps, getController) {
  return {
    ...createNavigationTreeEditorCommandController(deps, getController),
    ...createNavigationFolderCommandController(deps, getController),
    ...createNavigationNoteCommandController(deps, getController),
    ...createNavigationSelectionCommandController(deps, getController)
  };
}

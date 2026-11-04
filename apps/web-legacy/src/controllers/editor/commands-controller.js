import { createEditorBlockCommandController } from './commands/block-command-controller.js';
import { createEditorEditCommandController } from './commands/edit-command-controller.js';
import { createEditorMenuStateController } from './commands/menu-state-controller.js';
import { createEditorShortcutCommandController } from './commands/shortcut-controller.js';
import { createEditorViewCommandController } from './commands/view-command-controller.js';

export function createEditorCommandsController(deps, getController) {
  const menuState = createEditorMenuStateController(deps, getController);
  const shortcuts = createEditorShortcutCommandController(deps);
  const blockCommands = createEditorBlockCommandController(deps, getController, menuState);
  const viewCommands = createEditorViewCommandController(deps, getController, menuState);
  const editCommands = createEditorEditCommandController(deps, getController, menuState);

  return {
    ...blockCommands,
    ...shortcuts,
    ...viewCommands,
    ...editCommands,
    ...menuState
  };
}

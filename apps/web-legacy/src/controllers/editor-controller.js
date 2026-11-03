import { createEditorRenderController } from './editor/render-controller.js';
import { createEditorContextMenuController } from './editor/context-menu-controller.js';
import { createEditorCommandsController } from './editor/commands-controller.js';
import { createEditorPanelController } from './editor/panel-controller.js';
import { createEditorFileController } from './editor/file-controller.js';
import { createEditorHostController } from './editor/host-controller.js';
import { createEditorDraftController } from './editor/draft-controller.js';

export function createEditorController(deps) {
  let controller = null;
  const getController = () => controller;

  const render = createEditorRenderController(deps, getController);
  const contextMenu = createEditorContextMenuController(deps, getController);
  const commands = createEditorCommandsController(deps, getController);
  const panel = createEditorPanelController(deps, getController);
  const file = createEditorFileController(deps, getController);
  const host = createEditorHostController(deps, getController);
  const draft = createEditorDraftController(deps, getController);

  controller = {
    ...render,
    ...contextMenu,
    ...commands,
    ...panel,
    ...file,
    ...host,
    ...draft
  };

  return controller;
}

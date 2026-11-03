import { createNavigationDragCommandController } from './drag-command-controller.js';
import { createNavigationMenuCommandController } from './menu-command-controller.js';
import { createNavigationTreeCommandController } from './tree-command-controller.js';

export function createNavigationCommandController(deps, getController) {
  return {
    ...createNavigationMenuCommandController(deps, getController),
    ...createNavigationDragCommandController(deps, getController),
    ...createNavigationTreeCommandController(deps, getController)
  };
}

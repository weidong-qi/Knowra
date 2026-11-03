import { createNavigationRenderController } from './navigation/render-controller.js';
import { createNavigationCommandController } from './navigation/command-controller.js';

export function createNavigationController(deps) {
  let controller = null;
  const getController = () => controller;

  const renderController = createNavigationRenderController(deps, getController);
  const commandController = createNavigationCommandController(deps, getController);

  controller = {
    ...renderController,
    ...commandController
  };

  return controller;
}

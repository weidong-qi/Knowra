import { renderNavigationSection } from '../../../../lib/navigation/tree-renderers.js';

export function createNavigationSectionRenderController(deps, getController) {
  const { state } = deps;

  function renderNavSection({ key, label, count, children }) {
    const open = state.navSections[key] ?? false;
    return renderNavigationSection({
      key,
      label,
      count,
      children,
      open,
      isDropTarget: key === 'materials' && getController().isRootDropActive()
    });
  }

  return {
    renderNavSection
  };
}

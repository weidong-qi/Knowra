import { createNavigationMenuRenderController } from './render/menu-render-controller.js';
import { createNavigationSectionRenderController } from './render/section-render-controller.js';
import { createNavigationTreeRenderController } from './render/tree-render-controller.js';

export function createNavigationRenderController(deps, getController) {
  const {
    state,
    elements,
    getActiveNotes,
    getRecycleNotes,
    noteMatchesSelectedTags,
    matchesSearch,
    matchesFolderSearch
  } = deps;

  const treeRenderer = createNavigationTreeRenderController(deps);
  const sectionRenderer = createNavigationSectionRenderController(deps, getController);
  const menuRenderer = createNavigationMenuRenderController(deps);

  function renderFolders() {
    if (!elements.folderTree) {
      return;
    }

    const activeNotes = getActiveNotes();
    const filteredActiveNotes = activeNotes.filter((note) => noteMatchesSelectedTags(note));
    const recycleNotes = getRecycleNotes();
    const topFolders = state.folderTree.filter((folder) => matchesFolderSearch(folder));
    const favoriteNotes = filteredActiveNotes.filter((note) => note.favorite && matchesSearch(note.title));
    const recentNotes = [...filteredActiveNotes]
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
      .filter((note) => matchesSearch(note.title))
      .slice(0, 5);

    const sections = [
      sectionRenderer.renderNavSection({
        key: 'materials',
        label: '资料',
        count: topFolders.length,
        children: treeRenderer.renderMaterialsTree(topFolders)
      })
    ];

    if (state.secondarySections.favorites) {
      sections.push(
        sectionRenderer.renderNavSection({
          key: 'favorites',
          label: '收藏',
          count: favoriteNotes.length,
          children: favoriteNotes.length
            ? favoriteNotes.map((note) => treeRenderer.renderNoteNode(note, 1)).join('')
            : treeRenderer.renderEmptyItem('暂无收藏')
        })
      );
    }

    if (state.secondarySections.recent) {
      sections.push(
        sectionRenderer.renderNavSection({
          key: 'recent',
          label: '最近',
          count: recentNotes.length,
          children: recentNotes.length
            ? recentNotes.map((note) => treeRenderer.renderNoteNode(note, 1)).join('')
            : treeRenderer.renderEmptyItem('暂无最近笔记')
        })
      );
    }

    if (state.secondarySections.recycle) {
      sections.push(
        sectionRenderer.renderNavSection({
          key: 'recycle',
          label: '回收站',
          count: recycleNotes.length,
          children: recycleNotes.length
            ? recycleNotes.map((note) => treeRenderer.renderRecycleNoteNode(note, 1)).join('')
            : treeRenderer.renderEmptyItem('暂无回收站文件')
        })
      );
    }

    elements.folderTree.innerHTML = sections.join('');
    menuRenderer.renderHeaderToggle();
    menuRenderer.renderContextMenu();
    menuRenderer.renderSectionMenu();
    getController().focusInlineEditor();
  }

  return {
    renderFolders,
    ...sectionRenderer,
    ...treeRenderer,
    ...menuRenderer
  };
}

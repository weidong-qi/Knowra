import assert from 'node:assert/strict';
import { createTabOverflowController } from '../../src/controllers/tab/overflow-controller.js';

{
  const attributes = new Map();
  let focused = 0;
  const overflowToggle = {
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    focus() {
      focused += 1;
    }
  };
  const state = {
    selectedNoteId: 'note-1',
    tabOverflowMenuOpen: true,
    foldersById: {}
  };
  const elements = {
    noteTabs: {},
    noteTabOverflowToggleHost: {
      querySelector: () => overflowToggle
    },
    noteTabOverflowMenu: {
      hidden: false,
      innerHTML: 'menu'
    }
  };
  const controller = createTabOverflowController({
    state,
    elements,
    closeContextMenu() {},
    closeSectionMenu() {},
    closeTabMenu() {},
    renderTabs() {},
    selectTab: async () => true
  });

  controller.close({ restoreFocus: true });

  assert.equal(state.tabOverflowMenuOpen, false);
  assert.equal(elements.noteTabOverflowMenu.hidden, true);
  assert.equal(attributes.get('aria-expanded'), 'false');
  assert.equal(attributes.get('data-open'), 'false');
  assert.equal(focused, 1);
}

console.log('ok - closing the tab overflow menu can restore focus to its trigger');

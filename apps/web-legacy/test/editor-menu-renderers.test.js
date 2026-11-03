import assert from 'node:assert/strict';
import {
  EDIT_MENU_ITEMS,
  FORMAT_MENU_ITEMS,
  PARAGRAPH_MENU_ITEMS,
  renderEditorMenuBarMarkup,
  renderFileMenu,
  renderMoreMenu
} from '../lib/editor/menu-renderers.js';
import { focusEditorMenuTarget } from '../lib/editor/menu-focus.js';
import { createEditorMenuStateController } from '../src/controllers/editor/commands/menu-state-controller.js';

const shortcutLabel = (action) => {
  switch (action) {
    case 'save':
      return 'Ctrl+S';
    case 'code':
      return 'Ctrl+E';
    default:
      return '';
  }
};
const note = {
  id: 'note-1',
  title: '<Note>',
  favorite: false,
  deleted: false
};

const fileMenuBar = renderEditorMenuBarMarkup({
  note,
  effectiveView: {
    mode: 'edit',
    showLeftSidebar: true,
    showRightSidebar: false,
    showSourceEditor: false
  },
  openMenu: 'file',
  getShortcutLabel: shortcutLabel
});

assert.match(fileMenuBar, /data-editor-menu-toggle="file"[\s\S]*data-open="true"/);
assert.match(fileMenuBar, /data-editor-menu-toggle="file"[\s\S]*aria-controls="editor-menu-file"/);
assert.match(fileMenuBar, /id="editor-menu-file"[^>]*role="menu"/);
assert.match(fileMenuBar, /data-file-menu-action="save"[\s\S]*Ctrl\+S/);
assert.match(fileMenuBar, /data-file-menu-action="delete-note"/);

const viewMenuBar = renderEditorMenuBarMarkup({
  note,
  effectiveView: {
    mode: 'edit',
    showLeftSidebar: true,
    showRightSidebar: false,
    showSourceEditor: false
  },
  openMenu: 'view',
  getShortcutLabel: shortcutLabel
});

assert.match(viewMenuBar, /data-view-menu-action="toggle-right-sidebar"[\s\S]*显示右侧辅助区/);

assert.match(
  renderFileMenu({ note: { ...note, deleted: true }, getShortcutLabel: shortcutLabel }),
  /data-file-menu-action="restore-note"/,
  'deleted notes should render a restore action'
);

assert.match(
  renderFileMenu({ note: null, getShortcutLabel: shortcutLabel }),
  /data-file-menu-action="save" disabled/,
  'file actions requiring a note should be disabled without a current note'
);

const moreMenu = renderMoreMenu({
  note,
  effectiveView: {
    mode: 'edit',
    showLeftSidebar: true,
    showRightSidebar: false,
    showSourceEditor: false
  },
  getShortcutLabel: shortcutLabel
});
assert.match(moreMenu, /data-editor-menu="more"[^>]*role="menu"/);
for (const action of [
  'new-note', 'save', 'undo', 'find', 'heading-4', 'table',
  'image', 'highlight', 'mode-focus', 'toggle-source-editor'
]) {
  assert.match(moreMenu, new RegExp(`(?:data-file-menu-action|data-edit-menu-action|data-paragraph-menu-action|data-format-menu-action|data-view-menu-action)="${action}"`));
}
assert.match(fileMenuBar, /data-editor-menu-toggle="more"/);
assert.match(fileMenuBar, /data-quick-action="bullet"/);

const closedMenuBar = renderEditorMenuBarMarkup({
  note,
  effectiveView: {
    mode: 'edit',
    showLeftSidebar: true,
    showRightSidebar: false,
    showSourceEditor: false
  },
  openMenu: null,
  getShortcutLabel: shortcutLabel
});
assert.doesNotMatch(
  closedMenuBar,
  /aria-controls="editor-menu-(?:file|paragraph|edit|format|view|more)"/,
  'closed menu triggers should not reference popovers that are not rendered'
);

{
  const focusCalls = [];
  const menuBar = {
    querySelector(selector) {
      return { focus: () => focusCalls.push(selector) };
    }
  };
  assert.equal(focusEditorMenuTarget({
    menuBar,
    menuKey: 'more',
    focusTarget: 'first-item'
  }), true);
  assert.equal(focusEditorMenuTarget({
    menuBar,
    menuKey: 'more',
    focusTarget: 'trigger'
  }), true);
  assert.equal(focusEditorMenuTarget({
    menuBar: null,
    menuKey: 'more',
    focusTarget: 'trigger'
  }), false);
  assert.deepEqual(focusCalls, [
    '[data-editor-menu="more"] [role="menuitem"]:not([disabled])',
    '[data-editor-menu-toggle="more"]'
  ]);
}

{
  const state = { editorMenuOpen: 'more' };
  const renderCalls = [];
  const controller = createEditorMenuStateController({ state }, () => ({
    renderEditorMenuBar: (options) => renderCalls.push(options)
  }));

  controller.closeEditorMenuBar({ restoreFocus: true });
  assert.equal(state.editorMenuOpen, null);
  assert.deepEqual(renderCalls, [{
    focusMenuKey: 'more',
    focusTarget: 'trigger'
  }]);
}

assert.ok(EDIT_MENU_ITEMS.some((item) => item.key === 'find'));
assert.ok(PARAGRAPH_MENU_ITEMS.some((item) => item.key === 'heading-4'));
assert.ok(!PARAGRAPH_MENU_ITEMS.some((item) => item.key === 'heading-5'));
assert.ok(!PARAGRAPH_MENU_ITEMS.some((item) => item.key === 'heading-6'));
assert.ok(FORMAT_MENU_ITEMS.some((item) => item.key === 'highlight'));
assert.doesNotMatch(fileMenuBar, /data-format-quick-action/, 'editor menu bar should not render the removed quick action buttons');
assert.ok(
  FORMAT_MENU_ITEMS.some((item) => item.key === 'code' && item.label === '行内代码'),
  'format menu should keep inline code in the top format dropdown'
);
assert.ok(
  PARAGRAPH_MENU_ITEMS.some((item) => item.key === 'codeblock' && item.label === '代码块'),
  'paragraph menu should keep code blocks in the block-level dropdown'
);

console.log('ok - editor menu renderers build menus and states');

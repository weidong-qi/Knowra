import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createShellController } from '../src/controllers/shell-controller.js';
import {
  resolveEditorLayoutMode,
  resolveEditorMainWidth
} from '../lib/editor/layout-state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const editorCss = fs.readFileSync(
  path.resolve(__dirname, '../styles/components/knowra-inkgrid-editor.css'),
  'utf8'
);

assert.equal(resolveEditorLayoutMode(1120), 'full');
assert.equal(resolveEditorLayoutMode(1119), 'compact');
assert.equal(resolveEditorLayoutMode(900), 'compact');
assert.equal(resolveEditorLayoutMode(899), 'protected');
assert.equal(resolveEditorLayoutMode(720), 'protected');
assert.equal(resolveEditorLayoutMode(719), 'overlay');
assert.equal(resolveEditorLayoutMode(-1), null);
assert.equal(resolveEditorMainWidth({ workspaceWidth: 1000, rightSidebarOpen: true }), 768);
assert.equal(resolveEditorMainWidth({ workspaceWidth: 1000, rightSidebarOpen: false }), 1000);

assert.match(
  editorCss,
  /\.knowra-production-shell \.editor-workspace-view\s*\{[\s\S]*container-type:\s*inline-size;[\s\S]*container-name:\s*editor-main;/,
  'EditorMain host should expose a named inline-size query container'
);
for (const breakpoint of [1120, 900, 720, 719]) {
  assert.match(editorCss, new RegExp(`@container editor-main[^\\n]*${breakpoint}`));
}
assert.match(
  editorCss,
  /\.kb-workspace\[data-editor-layout='protected'\][\s\S]*grid-template-columns:\s*minmax\(0, 1fr\);/,
  'Protected mode should keep the editor body as the only docked grid column'
);
assert.match(
  editorCss,
  /\.kb-workspace\[data-editor-layout='overlay'\] \.editor-inspector[\s\S]*position:\s*absolute;/,
  'Overlay mode should move the marginalia rail to a non-destructive overlay'
);

const stage = {
  hidden: false,
  dataset: {},
  getBoundingClientRect: () => ({ width: 1360 })
};
const elements = {
  moduleRail: { hidden: false },
  workspaceShell: { dataset: {} },
  workspace: { dataset: {} },
  editorWorkspaceView: stage,
  sidebar: { hidden: false },
  aside: { hidden: false, getBoundingClientRect: () => ({ width: 232 }) },
  libraryIndexDirectoryToggle: {
    hidden: true,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  },
  libraryIndexDirectoryReopen: {
    hidden: true,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  },
  workDomainView: { hidden: true, dataset: {} }
};
const state = {
  editorMenuOpen: null,
  navigation: { activeWorkDomain: 'materials' },
  view: {
    screen: 'editor',
    mode: 'edit',
    showLeftSidebar: true,
    showRightSidebar: true
  }
};
const menuRenderOptions = [];
const controller = createShellController({
  state,
  elements,
  railItems: [],
  getCurrentNote: () => null,
  renderEditor: () => {},
  renderEditorContextMenu: () => {},
  renderEditorMenuBar: (options) => menuRenderOptions.push(options),
  renderFolders: () => {},
  renderSearchShell: () => {},
  renderSidebar: () => {},
  renderTabs: () => {},
  reportRuntimeError: () => {},
  renderWorkDomain: () => {}
});

controller.renderWorkspaceViewState();
assert.equal(elements.workspace.dataset.editorLayout, 'full', '1360 - 232 should enter Full mode');

stage.getBoundingClientRect = () => ({ width: 1150 });
state.editorMenuOpen = 'paragraph';
controller.syncEditorLayoutState();
assert.equal(elements.workspace.dataset.editorLayout, 'compact', '1150 - 232 should enter Compact mode');
assert.equal(state.editorMenuOpen, 'more', 'a hidden open menu should migrate to the compact more menu');
assert.deepEqual(menuRenderOptions.at(-1), {
  focusMenuKey: 'more',
  focusTarget: 'first-item',
  onlyIfMenuFocused: true
});

stage.getBoundingClientRect = () => ({ width: 1360 });
controller.syncEditorLayoutState();
assert.equal(elements.workspace.dataset.editorLayout, 'full');
assert.equal(state.editorMenuOpen, null, 'Full mode should close the compact-only more menu');
assert.deepEqual(menuRenderOptions.at(-1), {
  focusMenuKey: 'file',
  focusTarget: 'trigger',
  onlyIfMenuFocused: true
});

stage.getBoundingClientRect = () => ({ width: 1000 });
controller.syncEditorLayoutState();
assert.equal(elements.workspace.dataset.editorLayout, 'protected', '1000 - 232 should enter Protected mode');

stage.getBoundingClientRect = () => ({ width: 900 });
controller.syncEditorLayoutState();
assert.equal(elements.workspace.dataset.editorLayout, 'overlay', '900 - 232 should enter Overlay mode');
controller.renderWorkspaceViewState();
assert.equal(elements.libraryIndexDirectoryToggle.hidden, false, 'Overlay editor should expose the directory close trigger');
assert.equal(elements.libraryIndexDirectoryToggle.attributes['aria-label'], '折叠目录栏');

state.view.showLeftSidebar = false;
controller.renderWorkspaceViewState();
assert.equal(elements.libraryIndexDirectoryReopen.hidden, false, 'Overlay editor should expose the directory reopen trigger');
assert.equal(elements.libraryIndexDirectoryReopen.attributes['aria-label'], '展开目录栏');

state.view.showRightSidebar = false;
state.view.showLeftSidebar = true;
stage.getBoundingClientRect = () => ({ width: 840 });
controller.syncEditorLayoutState();
assert.equal(elements.workspace.dataset.editorLayout, 'protected', 'the left-only combination should resolve from its docked EditorMain width');

let historyElements;
const historyStage = {
  hidden: false,
  dataset: {},
  getBoundingClientRect: () => ({
    width: historyElements.workspaceShell.dataset.editorLayout === 'overlay' ? 1072 : 840
  })
};
historyElements = {
  moduleRail: { hidden: false },
  workspaceShell: { dataset: { editorLayout: 'full' } },
  workspace: { dataset: {} },
  editorWorkspaceView: historyStage,
  sidebar: { hidden: false },
  aside: { hidden: true },
  workDomainView: { hidden: true, dataset: {} }
};
const historyState = {
  navigation: { activeWorkDomain: 'materials' },
  view: {
    screen: 'editor',
    mode: 'edit',
    showLeftSidebar: true,
    showRightSidebar: false
  }
};
const historyController = createShellController({
  state: historyState,
  elements: historyElements,
  railItems: [],
  getCurrentNote: () => null,
  renderEditor: () => {},
  renderEditorContextMenu: () => {},
  renderEditorMenuBar: () => {},
  renderFolders: () => {},
  renderSearchShell: () => {},
  renderSidebar: () => {},
  renderTabs: () => {},
  reportRuntimeError: () => {},
  renderWorkDomain: () => {}
});

historyController.syncEditorLayoutState();
assert.equal(historyElements.workspace.dataset.editorLayout, 'protected', 'the same left-only combination should resolve from the docked baseline');
historyElements.workspaceShell.dataset.editorLayout = 'overlay';
historyController.syncEditorLayoutState();
assert.equal(historyElements.workspace.dataset.editorLayout, 'protected', 'layout mode should not depend on the previous mode attribute');

console.log('ok - editor container layout state is wired for four modes');

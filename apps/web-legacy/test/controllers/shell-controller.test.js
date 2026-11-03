import assert from 'node:assert/strict';
import { createShellController } from '../../src/controllers/shell-controller.js';

function createElements() {
  const editorAsideToggle = {
    hidden: false,
    attributes: {},
    setAttribute(name, value) { editorAsideToggle.attributes[name] = value; }
  };
  const editorAsideReopen = {
    hidden: true,
    attributes: {},
    setAttribute(name, value) { editorAsideReopen.attributes[name] = value; }
  };
  return {
    moduleRail: { innerHTML: '', hidden: false },
    workspaceShell: { dataset: {} },
    workspace: { dataset: {} },
    workDomainView: { hidden: true, dataset: {} },
    sidebar: { hidden: false },
    aside: {
      hidden: false,
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; }
    },
    editorAsideToggle,
    editorAsideReopen,
    statusIndicators: { innerHTML: '' },
    statusMeta: { innerHTML: '' }
  };
}

function createState(overrides = {}) {
  return {
    statusMessage: 'Ready',
    navigation: {
      activeWorkDomain: 'materials'
    },
    foldersById: {
      'folder-1': { id: 'folder-1' },
      'folder-2': { id: 'folder-2' }
    },
    dataMode: 'api',
    currentSpaceId: 'space-1',
    view: {
      mode: 'focus',
      showLeftSidebar: true,
      showRightSidebar: true,
      showSourceEditor: false
    },
    ...overrides
  };
}

function createDeps({ state = createState(), elements = createElements(), overrides = {} } = {}) {
  const calls = [];
  const errors = [];
  const controller = createShellController({
    state,
    elements,
    railItems: [{ key: 'knowledge', active: true }],
    getCurrentNote: () => ({ id: 'note-1' }),
    getVisibleNotes: () => [{ id: 'note-1' }, { id: 'note-2' }],
    renderEditor: (note) => calls.push(['editor', note.id]),
    renderEditorContextMenu: () => calls.push(['editor-context-menu']),
    renderEditorMenuBar: () => calls.push(['editor-menu']),
    renderFolders: () => calls.push(['navigation']),
    renderSearchShell: () => calls.push(['search']),
    renderSidebar: (note) => calls.push(['sidebar', note.id]),
    renderTabs: () => calls.push(['tabs']),
    reportRuntimeError: (name, error) => errors.push([name, error.message]),
    ...overrides
  });

  return { controller, state, elements, calls, errors };
}

function runTest(name, callback) {
  try {
    callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

runTest('renderAll renders shell sections and isolates failed steps', () => {
  const { controller, calls, errors, elements } = createDeps({
    overrides: {
      renderFolders: () => {
        throw new Error('navigation failed');
      }
    }
  });

  controller.renderAll();

  assert.deepEqual(calls, [
    ['search'],
    ['tabs'],
    ['editor-menu'],
    ['editor', 'note-1'],
    ['sidebar', 'note-1'],
    ['editor-context-menu']
  ]);
  assert.deepEqual(errors, [['navigation', 'navigation failed']]);
  assert.match(elements.statusIndicators.innerHTML, /Ready/);
  assert.doesNotMatch(elements.statusIndicators.innerHTML, /data-save-now|data-status-action/);
  assert.match(elements.statusMeta.innerHTML, /data-status-global="connection"/);
});

runTest('renderWorkspaceViewState applies effective focus layout', () => {
  const { controller, elements } = createDeps();

  controller.renderWorkspaceViewState();

  assert.equal(elements.workspace.dataset.leftHidden, 'true');
  assert.equal(elements.workspaceShell.dataset.functionNavigationHidden, 'true');
  assert.equal(elements.workspaceShell.dataset.directoryHidden, 'true');
  assert.equal(elements.workspace.dataset.rightHidden, 'true');
  assert.equal(elements.workspace.dataset.viewMode, 'focus');
  assert.equal(elements.workspaceShell.dataset.viewMode, 'focus');
  assert.equal(elements.sidebar.hidden, true);
  assert.equal(elements.moduleRail.hidden, true);
  assert.equal(elements.aside.hidden, true);
  assert.equal(elements.editorAsideReopen.hidden, true);
  assert.equal(elements.editorAsideReopen.attributes['aria-expanded'], 'false');
});

runTest('renderWorkspaceViewState exposes the editor aside trigger state', () => {
  const { controller, elements, state } = createDeps({
    state: createState({
      view: {
        screen: 'editor',
        mode: 'edit',
        showLeftSidebar: true,
        showRightSidebar: true,
        showSourceEditor: false
      }
    })
  });

  controller.renderWorkspaceViewState();

  assert.equal(elements.aside.hidden, false);
  assert.equal(elements.aside.attributes['aria-hidden'], 'false');
  assert.equal(elements.editorAsideToggle.attributes['aria-expanded'], 'true');
  assert.equal(elements.editorAsideToggle.attributes['aria-controls'], 'kb-aside');
  assert.equal(elements.editorAsideReopen.hidden, true);

  state.view.showRightSidebar = false;
  controller.renderWorkspaceViewState();

  assert.equal(elements.aside.hidden, true);
  assert.equal(elements.aside.attributes['aria-hidden'], 'true');
  assert.equal(elements.editorAsideToggle.attributes['aria-expanded'], 'false');
  assert.equal(elements.editorAsideReopen.hidden, false);
  assert.equal(elements.editorAsideReopen.attributes['aria-label'], '展开资料边注');
});

runTest('renderWorkspaceViewState keeps the global rail available in work domains', () => {
  const { controller, elements } = createDeps({
    state: createState({
      navigation: {
        activeWorkDomain: 'knowledge'
      }
    })
  });

  controller.renderWorkspaceViewState();

  assert.equal(elements.workspaceShell.dataset.screen, 'domain');
  assert.equal(elements.workspaceShell.dataset.leftHidden, 'false');
  assert.equal(elements.workspaceShell.dataset.functionNavigationHidden, 'false');
  assert.equal(elements.workspaceShell.dataset.directoryHidden, 'true');
  assert.equal(elements.moduleRail.hidden, false);
  assert.equal(elements.sidebar.hidden, true);
  assert.equal(elements.workDomainView.hidden, false);
});

runTest('renderRail and renderStatus write shell markup', () => {
  const { controller, elements } = createDeps({
    state: createState({
      view: {
        mode: 'edit',
        screen: 'editor',
        showLeftSidebar: true,
        showRightSidebar: true,
        showSourceEditor: false
      }
    })
  });

  controller.renderRail();
  controller.renderStatus();

  assert.match(elements.moduleRail.innerHTML, /class="function-nav-item"/);
  assert.match(elements.moduleRail.innerHTML, /data-module-key="materials"[^>]*aria-current="page"/);
  assert.match(elements.moduleRail.innerHTML, /data-nav-item="home"[^>]*data-active="false"/);
  assert.doesNotMatch(elements.moduleRail.innerHTML, /data-nav-item="home"[^>]*disabled/);
  assert.match(elements.moduleRail.innerHTML, /data-active="true"/);
  assert.match(elements.statusIndicators.innerHTML, /data-save-now/);
  assert.match(elements.statusIndicators.innerHTML, /data-status-feature-controls/);
  assert.doesNotMatch(elements.statusIndicators.innerHTML, /笔记|目录/);
  assert.match(elements.statusMeta.innerHTML, /data-status-global="connection"[^>]*>云端已连接/);
  assert.doesNotMatch(elements.statusMeta.innerHTML, /data-status-action/);
});

runTest('renderRail activates homepage only inside the Materials domain', () => {
  const { controller, elements } = createDeps({
    state: createState({
      navigation: { activeWorkDomain: 'materials' },
      view: { screen: 'home', mode: 'edit', showLeftSidebar: true, showRightSidebar: true }
    })
  });

  controller.renderRail();
  assert.match(elements.moduleRail.innerHTML, /data-nav-item="home" data-active="true"/);
  assert.doesNotMatch(elements.moduleRail.innerHTML, /data-module-key="materials"[^>]*data-active="true"/);

  const knowledgeHarness = createDeps({
    state: createState({
      navigation: { activeWorkDomain: 'knowledge' },
      view: { screen: 'home', mode: 'edit', showLeftSidebar: true, showRightSidebar: true }
    })
  });
  knowledgeHarness.controller.renderRail();
  assert.match(knowledgeHarness.elements.moduleRail.innerHTML, /data-nav-item="knowledge-overview" data-active="true"[^>]*data-module-key="knowledge"/);
  assert.match(knowledgeHarness.elements.moduleRail.innerHTML, /data-nav-item="home" data-active="false"/);
});

console.log('shell-controller tests passed');

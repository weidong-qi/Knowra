import assert from 'node:assert/strict';
import { createControllerActionProxies } from '../../src/controllers/controller-action-proxies.js';

function createTrackedController(methodNames, calls, controllerName) {
  return Object.fromEntries(
    methodNames.map((methodName) => [
      methodName,
      (...args) => {
        calls.push([controllerName, methodName, args]);
        return `${controllerName}.${methodName}`;
      }
    ])
  );
}

const expectedMethods = {
  scrollController: ['saveCurrentEditorScrollPosition', 'restoreEditorScrollPosition'],
  workspaceController: ['startWorkspaceLoad', 'refreshKnowledgeData'],
  sidebarController: ['renderSidebar', 'findOutlineHeadingTarget', 'toggleOutlineHeading', 'jumpToOutlineHeading'],
  shellController: ['renderAll', 'renderStatus'],
  searchController: ['renderSearchShell', 'toggleSearchTagFilter'],
  navigationController: ['renderFolders', 'selectNote'],
  tabController: ['renderTabs', 'handleTabClose'],
  editorController: ['renderEditor', 'persistDraft'],
  tagController: ['addTagToCurrentNote', 'cleanupOrphanTag'],
  knowledgePointController: ['createKnowledgePointFromCurrentSelection', 'updateCurrentKnowledgePoint']
};

const calls = [];
let controllers = Object.fromEntries(
  Object.entries(expectedMethods).map(([controllerName, methodNames]) => [
    controllerName,
    createTrackedController(methodNames, calls, controllerName)
  ])
);

const actions = createControllerActionProxies(() => controllers);

Object.entries(expectedMethods).forEach(([controllerName, methodNames]) => {
  methodNames.forEach((methodName) => {
    assert.equal(
      actions[methodName]('arg-1', 'arg-2'),
      `${controllerName}.${methodName}`,
      `${methodName} should forward to ${controllerName}`
    );
  });
});

assert.deepEqual(calls[0], [
  'scrollController',
  'saveCurrentEditorScrollPosition',
  ['arg-1', 'arg-2']
]);

controllers = {
  ...controllers,
  shellController: {
    renderAll: () => 'replacement-shell.renderAll',
    renderStatus: () => 'replacement-shell.renderStatus'
  }
};

assert.equal(
  actions.renderAll(),
  'replacement-shell.renderAll',
  'proxy actions should resolve controllers lazily at call time'
);

assert.throws(
  () => actions.missingAction(),
  /Controller action is not registered: missingAction/,
  'missing controller actions should fail loudly'
);

console.log('controller-action-proxies tests passed');

import assert from 'node:assert/strict';
import { createWorkspaceController } from '../../src/controllers/workspace-controller.js';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

function createState(overrides = {}) {
  return {
    dataMode: 'loading',
    spaces: [],
    currentSpaceId: null,
    folderTree: [],
    foldersById: {},
    tags: [],
    allNotes: [],
    selectedFolderId: null,
    selectedNoteId: null,
    openFolders: {},
    openNoteTabs: [],
    linkedNotes: ['stale'],
    attachments: ['stale'],
    knowledgePoints: ['stale'],
    allKnowledgePoints: ['stale'],
    knowledgePointTagGroups: ['stale'],
    ...overrides
  };
}

function createDeps({ state = createState(), knowledgeApi, storage = createStorage(), browserWindow = {}, overrides = {} } = {}) {
  const calls = {
    flashStatus: [],
    loadCurrentNoteSideData: 0,
    loadLocalNoteSideData: [],
    persistScrollPositions: 0,
    reconcileSelection: 0,
    renderAll: 0,
    saveCurrentEditorScrollPosition: 0
  };

  const controller = createWorkspaceController({
    state,
    knowledgeApi: knowledgeApi ?? {
      async listKnowledgeSpaces() {
        return [{ id: 'space-1' }];
      },
      async createDefaultKnowledgeSpace() {
        return { id: 'space-created' };
      },
      async loadWorkspaceResources() {
        return {
          folderTree: [{ id: 'folder-1', name: 'Folder', parentId: null, children: [] }],
          tags: [{ id: 'tag-1', name: 'Tag' }],
          notes: [{ id: 'note-1', title: 'Note', folderId: 'folder-1', tagIds: [], internalLinks: [] }]
        };
      }
    },
    cacheKey: 'workspace-cache',
    storage,
    browserWindow,
    flashStatus: (message) => calls.flashStatus.push(message),
    loadCurrentNoteSideData: async () => { calls.loadCurrentNoteSideData += 1; },
    loadLocalNoteSideData: (noteId) => calls.loadLocalNoteSideData.push(noteId),
    persistScrollPositions: () => { calls.persistScrollPositions += 1; },
    reconcileSelection: () => { calls.reconcileSelection += 1; },
    renderAll: () => { calls.renderAll += 1; },
    saveCurrentEditorScrollPosition: () => { calls.saveCurrentEditorScrollPosition += 1; },
    ...overrides
  });

  return { controller, state, storage, calls };
}

async function runTest(name, callback) {
  try {
    await callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

await runTest('loadWorkspaceData loads backend resources and persists cache', async () => {
  const { controller, state, storage, calls } = createDeps();

  await controller.loadWorkspaceData();

  assert.equal(state.dataMode, 'api');
  assert.equal(state.currentSpaceId, 'space-1');
  assert.equal(state.folderTree[0].id, 'folder-1');
  assert.equal(state.foldersById['folder-1'].id, 'folder-1');
  assert.equal(state.allNotes[0].id, 'note-1');
  assert.equal(calls.loadCurrentNoteSideData, 1);
  assert.equal(calls.saveCurrentEditorScrollPosition, 1);
  assert.equal(calls.persistScrollPositions, 1);
  assert.match(storage.getItem('workspace-cache'), /note-1/);
  assert.deepEqual(calls.flashStatus, ['知识库已连接到后端数据']);
});

await runTest('loadWorkspaceData keeps the homepage status context', async () => {
  const { controller, calls } = createDeps({
    state: createState({
      navigation: { activeWorkDomain: 'materials' },
      view: { screen: 'home' }
    })
  });

  await controller.loadWorkspaceData();
  assert.deepEqual(calls.flashStatus, ['当前工作台：主页概览']);
});

await runTest('loadWorkspaceData falls back to cached snapshot when backend fails', async () => {
  const cachedSnapshot = {
    spaces: [{ id: 'cached-space' }],
    currentSpaceId: 'cached-space',
    folderTree: [{ id: 'cached-folder', name: 'Cached', parentId: null, children: [] }],
    tags: [],
    allNotes: [{ id: 'cached-note', title: 'Cached note', folderId: 'cached-folder', tagIds: [], internalLinks: [] }],
    openFolders: {},
    openNoteTabs: ['cached-note'],
    selectedFolderId: 'cached-folder',
    selectedNoteId: 'cached-note'
  };
  const { controller, state, calls } = createDeps({
    knowledgeApi: {
      async listKnowledgeSpaces() {
        throw new Error('offline');
      }
    }
  });

  await controller.loadWorkspaceData({ cachedSnapshot });

  assert.equal(state.dataMode, 'cache');
  assert.equal(state.currentSpaceId, 'cached-space');
  assert.deepEqual(state.openNoteTabs, ['cached-note']);
  assert.deepEqual(calls.loadLocalNoteSideData, ['cached-note']);
  assert.equal(calls.flashStatus.at(-1), '后端暂时不可用，已显示最近一次成功加载的资料');
});

await runTest('resetWorkspaceDataForStartupRecovery clears workspace and side data', () => {
  const state = createState({
    dataMode: 'cache',
    spaces: [{ id: 'space-1' }],
    currentSpaceId: 'space-1',
    folderTree: [{ id: 'folder-1', children: [] }],
    foldersById: { 'folder-1': { id: 'folder-1' } },
    tags: [{ id: 'tag-1' }],
    allNotes: [{ id: 'note-1' }],
    selectedFolderId: 'folder-1',
    selectedNoteId: 'note-1',
    openFolders: { 'folder-1': true },
    openNoteTabs: ['note-1']
  });
  const { controller, calls } = createDeps({ state });

  controller.resetWorkspaceDataForStartupRecovery();

  assert.equal(state.dataMode, 'loading');
  assert.deepEqual(state.spaces, []);
  assert.deepEqual(state.folderTree, []);
  assert.deepEqual(state.openNoteTabs, []);
  assert.deepEqual(state.linkedNotes, []);
  assert.deepEqual(state.attachments, []);
  assert.equal(calls.renderAll, 1);
});

console.log('workspace-controller tests passed');

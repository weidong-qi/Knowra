import assert from 'node:assert/strict';
import { createEditorDraftController } from '../../src/controllers/editor/draft-controller.js';

function createHarness({ dataMode = 'api', updateNote } = {}) {
  const note = {
    id: 'note-1',
    title: 'Original',
    rawMarkdown: '# Original',
    updatedAt: '2026-07-27T00:00:00.000Z'
  };
  const state = {
    dataMode,
    allNotes: [note],
    draftTitle: 'Changed',
    draftMarkdown: '# Changed',
    saveState: 'pending',
    lastSavedAt: null
  };
  const calls = { flashes: [], api: 0, renderTabs: 0 };
  const editorRuntime = { autosaveTimer: null };
  const controller = createEditorDraftController({
    state,
    elements: {},
    editorRuntime,
    knowledgeApi: {
      async updateNote(id, input) {
        calls.api += 1;
        if (updateNote) return updateNote(id, input);
        return { ...note, ...input, updatedAt: '2026-07-27T01:00:00.000Z' };
      }
    },
    autosaveDelayMs: 1,
    getCurrentNote: () => state.allNotes[0] ?? null,
    renderFolders: () => {},
    renderTabs: () => { calls.renderTabs += 1; },
    renderSidebar: () => {},
    renderStatus: () => {},
    persistBackendCache: () => {},
    flashStatus: (message) => calls.flashes.push(message)
  }, () => ({ renderEditorSaveIndicator() {} }));
  return { controller, state, calls, editorRuntime };
}

{
  const { controller, state, calls, editorRuntime } = createHarness();
  controller.scheduleAutosave();

  assert.equal(state.saveState, 'pending');
  assert.equal(calls.renderTabs, 1, 'pending autosave should immediately redraw the active Tab dirty state');
  clearTimeout(editorRuntime.autosaveTimer);
  editorRuntime.autosaveTimer = null;
}

{
  const { controller, state } = createHarness();
  const result = await controller.persistDraft({ immediate: true });

  assert.deepEqual(
    { ok: result.ok, changed: result.changed },
    { ok: true, changed: true }
  );
  assert.equal(state.saveState, 'saved');
}

{
  const { controller, state, calls } = createHarness({
    updateNote: async () => {
      throw new Error('network down');
    }
  });
  const result = await controller.persistDraft({ immediate: true });

  assert.equal(result.ok, false);
  assert.equal(result.changed, true);
  assert.equal(result.error.message, 'network down');
  assert.equal(state.saveState, 'error');
  assert.equal(calls.flashes.at(-1), 'network down');
}

{
  const { controller, state, calls } = createHarness({ dataMode: 'cache' });
  const result = await controller.persistDraft({ immediate: true });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'read-only');
  assert.equal(state.saveState, 'error');
  assert.equal(calls.api, 0);
  assert.equal(calls.flashes.at(-1), '当前显示的是只读缓存，请在后端恢复后刷新页面再修改');
}

{
  let releaseFirstSave;
  const pendingFirstSave = new Promise((resolve) => {
    releaseFirstSave = resolve;
  });
  const payloads = [];
  const { controller, state } = createHarness({
    updateNote: async (_id, input) => {
      payloads.push(input);
      if (payloads.length === 1) {
        await pendingFirstSave;
      }
      return {
        id: 'note-1',
        ...input,
        updatedAt: `2026-07-27T0${payloads.length}:00:00.000Z`
      };
    }
  });

  const firstSave = controller.persistDraft();
  state.draftMarkdown = '# Newer';
  const secondSave = controller.persistDraft();
  releaseFirstSave();

  assert.equal((await firstSave).ok, true);
  assert.equal((await secondSave).ok, true);
  assert.deepEqual(payloads.map((payload) => payload.rawMarkdown), [
    '# Changed',
    '# Newer'
  ]);
  assert.equal(state.allNotes[0].rawMarkdown, '# Newer');
}

console.log('ok - draft persistence returns explicit outcomes and blocks cache writes');

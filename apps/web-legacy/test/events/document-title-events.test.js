import assert from 'node:assert/strict';
import { bindDocumentTitleEvents } from '../../lib/events/document-title-events.js';

function createHarness() {
  const listeners = {};
  const elements = {
    editorDocumentHead: {
      addEventListener(type, listener) {
        listeners[type] = listener;
      }
    }
  };
  const state = { draftTitle: 'Original' };
  const calls = { autosave: 0, persist: [], status: [] };
  const deps = {
    getCurrentNote: () => ({ id: 'note-a', title: 'Original' }),
    scheduleAutosave: () => { calls.autosave += 1; },
    persistDraft: async (options) => { calls.persist.push(options); },
    flashStatus: (message) => { calls.status.push(message); }
  };
  bindDocumentTitleEvents({ state, elements, deps });
  return { listeners, state, calls };
}

function createInput(value) {
  return {
    value,
    closest(selector) {
      return selector === '[data-document-title-input]' ? this : null;
    },
    blur() {}
  };
}

{
  const { listeners, state, calls } = createHarness();
  const input = createInput('New title');
  listeners.input({ target: input });
  assert.equal(state.draftTitle, 'New title');
  assert.equal(calls.autosave, 1);
}

{
  const { listeners, state, calls } = createHarness();
  const input = createInput('  Trimmed title  ');
  listeners.focusout({ target: input });
  assert.equal(state.draftTitle, 'Trimmed title');
  assert.equal(input.value, 'Trimmed title');
  assert.deepEqual(calls.persist, [{ immediate: true }]);
}

{
  const { listeners, state, calls } = createHarness();
  const input = createInput('   ');
  listeners.focusout({ target: input });
  assert.equal(state.draftTitle, 'Original');
  assert.equal(input.value, 'Original');
  assert.deepEqual(calls.status, ['标题不能为空，已恢复原标题']);
}

console.log('ok - document title events keep the title separate from body input');

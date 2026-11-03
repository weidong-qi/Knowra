import assert from 'node:assert/strict';
import { createAnnotationController } from '../../src/controllers/annotation-controller.js';

{
  const calls = [];
  const note = {
    id: 'note-1',
    spaceId: 'space-1',
    rawMarkdown: 'saved body'
  };
  const controller = createAnnotationController({
    state: {
      dataMode: 'api',
      draftMarkdown: 'unsaved body',
      annotations: [],
      expandedAnnotationIds: {}
    },
    editorRuntime: {
      currentEditorHost: {
        async getSelectionSnapshot() {
          return {
            sourceText: 'unsaved',
            startOffset: 0,
            endOffset: 7
          };
        }
      }
    },
    knowledgeApi: {
      async createAnnotation() {
        calls.push('create');
      }
    },
    getCurrentNote: () => note,
    persistDraft: async () => {
      calls.push('save');
      return { ok: false, changed: true };
    },
    renderSidebar: () => {},
    flashStatus: () => {}
  });

  const created = await controller.createAnnotationFromCurrentSelection();

  assert.equal(created, false);
  assert.deepEqual(calls, ['save']);
}

console.log('ok - annotation creation stops when the current draft cannot be saved');

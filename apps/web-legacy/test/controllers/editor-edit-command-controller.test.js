import assert from 'node:assert/strict';

import { createEditorEditCommandController } from '../../src/controllers/editor/commands/edit-command-controller.js';

function withMockGlobals({ documentRef, navigatorRef }, callback) {
  const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  if (documentRef === undefined) {
    delete globalThis.document;
  } else {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      writable: true,
      value: documentRef
    });
  }

  if (navigatorRef === undefined) {
    delete globalThis.navigator;
  } else {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      writable: true,
      value: navigatorRef
    });
  }

  return Promise.resolve()
    .then(callback)
    .finally(() => {
      if (!originalDocumentDescriptor) {
        delete globalThis.document;
      } else {
        Object.defineProperty(globalThis, 'document', originalDocumentDescriptor);
      }

      if (!originalNavigatorDescriptor) {
        delete globalThis.navigator;
      } else {
        Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
      }
    });
}

function createHarness(overrides = {}) {
  const calls = {
    flashed: [],
    menuClosed: 0,
    contextClosed: 0,
    focused: 0,
    pasted: []
  };

  const editorHost = {
    async focus() {
      calls.focused += 1;
    },
    async pasteMarkdown(markdown) {
      calls.pasted.push(markdown);
      return true;
    },
    ...overrides.editorHost
  };

  const controller = createEditorEditCommandController(
    {
      editorRuntime: { currentEditorHost: editorHost },
      getCurrentNote: () => ({ id: 'note-1' }),
      flashStatus: (message) => { calls.flashed.push(message); },
      ...overrides.deps
    },
    () => ({
      closeEditorContextMenu() {
        calls.contextClosed += 1;
      },
      openEditorPanel() {}
    }),
    {
      closeEditorMenuBar() {
        calls.menuClosed += 1;
      }
    }
  );

  return { controller, calls };
}

await withMockGlobals({
  documentRef: {
    execCommand() {
      return true;
    }
  },
  navigatorRef: {
    clipboard: {
      async readText() {
        return '# pasted';
      }
    }
  }
}, async () => {
  const { controller, calls } = createHarness();
  await controller.handleEditMenuAction('paste');
  assert.deepEqual(calls.pasted, ['# pasted']);
  assert.deepEqual(calls.flashed, []);
});

await withMockGlobals({
  documentRef: {
    commands: [],
    execCommand(command) {
      this.commands.push(command);
      return command === 'paste';
    }
  },
  navigatorRef: {
    clipboard: {
      async readText() {
        throw new Error('denied');
      }
    }
  }
}, async () => {
  const { controller, calls } = createHarness();
  await controller.handleEditMenuAction('paste');
  assert.deepEqual(calls.flashed, []);
});

await withMockGlobals({
  documentRef: {
    execCommand() {
      return false;
    }
  },
  navigatorRef: {
    clipboard: {
      async readText() {
        throw new Error('denied');
      }
    }
  }
}, async () => {
  const { controller, calls } = createHarness();
  await controller.handleEditMenuAction('paste');
  assert.deepEqual(calls.flashed, ['无法读取剪贴板内容，请检查浏览器权限']);
});

await withMockGlobals({
  documentRef: {
    lastCommand: null,
    execCommand(command) {
      this.lastCommand = command;
      return true;
    }
  },
  navigatorRef: {}
}, async () => {
  const { controller, calls } = createHarness();
  await controller.handleEditMenuAction('copy');
  assert.equal(globalThis.document.lastCommand, 'copy');
  assert.deepEqual(calls.flashed, []);
});

console.log('ok - editor edit command controller handles clipboard fallbacks');

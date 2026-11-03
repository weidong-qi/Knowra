import assert from 'node:assert/strict';

import {
  readClipboardText,
  runDocumentCommand,
  writeClipboardText
} from '../../lib/browser/clipboard.js';

function createMockDocument({ execCommandResult = true } = {}) {
  const appended = [];
  const removed = [];
  const activeElement = {
    focused: 0,
    focus() {
      this.focused += 1;
    }
  };

  return {
    appended,
    removed,
    activeElement,
    body: {
      appendChild(node) {
        appended.push(node);
      }
    },
    createElement() {
      return {
        value: '',
        style: {},
        setAttribute() {},
        focus() {},
        select() {},
        setSelectionRange() {},
        remove() {
          removed.push(this);
        }
      };
    },
    execCommand(command) {
      this.lastCommand = command;
      return execCommandResult;
    }
  };
}

const clipboardWrites = [];
assert.equal(
  await writeClipboardText('Alpha', {
    navigatorRef: {
      clipboard: {
        async writeText(value) {
          clipboardWrites.push(value);
        }
      }
    }
  }),
  true
);
assert.deepEqual(clipboardWrites, ['Alpha']);

const fallbackDocument = createMockDocument();
assert.equal(
  await writeClipboardText('Beta', {
    navigatorRef: {
      clipboard: {
        async writeText() {
          throw new Error('denied');
        }
      }
    },
    documentRef: fallbackDocument
  }),
  true
);
assert.equal(fallbackDocument.lastCommand, 'copy');
assert.equal(fallbackDocument.appended.length, 1);
assert.equal(fallbackDocument.removed.length, 1);
assert.equal(fallbackDocument.activeElement.focused, 1);

assert.equal(
  runDocumentCommand('paste', { documentRef: { execCommand: () => false } }),
  false
);

const deniedRead = await readClipboardText({
  navigatorRef: {
    clipboard: {
      async readText() {
        throw new Error('blocked');
      }
    }
  }
});
assert.equal(deniedRead.ok, false);
assert.equal(deniedRead.reason, 'denied');

console.log('ok - clipboard helpers support async and legacy browser flows');

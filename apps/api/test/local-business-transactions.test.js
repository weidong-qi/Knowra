import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppContext } from '../src/app.factory.js';
import { createFileDataStore } from '../src/infrastructure/file-data-store.js';
import { writeJsonFileAtomically } from '../src/infrastructure/atomic-json-file.ts';

function withFixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-business-transaction-'));
  const file = path.join(dir, 'data.json');
  let fail = false;
  let writes = 0;
  try {
    const store = createFileDataStore(file, {
      writeJson(target, value) {
        writes += 1;
        if (fail) {
          fail = false;
          throw new Error('injected disk failure');
        }
        writeJsonFileAtomically(target, value);
      }
    });
    const app = createAppContext({
      dataStore: store,
      uploadsDir: path.join(dir, 'uploads'),
      storageRootDir: dir,
      ownerId: 'test'
    });
    const api = app.http.knowledge;
    const space = api.createDefaultKnowledgeSpace();
    const snapshot = () => ({ memory: JSON.stringify(store.state), disk: fs.readFileSync(file, 'utf8') });
    run({
      api,
      space,
      store,
      file,
      snapshot,
      failNext: () => {
        fail = true;
      },
      writes: () => writes
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export const localBusinessTransactionTests = [
  {
    name: 'local service writes roll back failed folder creation and favorite changes',
    run() {
      withFixture(({ api, space, snapshot, failNext, file }) => {
        const note = api.createNote({ id: 'note-1', title: 'Original', rawMarkdown: 'text', spaceId: space.id });
        const before = snapshot();
        failNext();
        assert.throws(() => api.createFolder({ id: 'phantom', name: 'Phantom', spaceId: space.id }), {
          code: 'STORAGE_WRITE_FAILED'
        });
        assert.deepEqual(snapshot(), before);
        failNext();
        assert.throws(() => api.setFavorite({ id: note.id }, { favorite: true }), { code: 'STORAGE_WRITE_FAILED' });
        assert.deepEqual(snapshot(), before);
        api.createFolder({ id: 'real', name: 'Real', spaceId: space.id });
        assert.equal(
          createFileDataStore(file).state.folders.some(folder => folder.id === 'phantom'),
          false
        );
      });
    }
  },
  {
    name: 'local subtree cleanup commits once and restores references after a failed commit',
    run() {
      withFixture(({ api, space, snapshot, failNext, writes, file }) => {
        api.createFolder({ id: 'parent', name: 'Parent', spaceId: space.id });
        api.createFolder({ id: 'child', name: 'Child', parentId: 'parent', spaceId: space.id });
        api.createNote({ id: 'note-1', title: 'Note', rawMarkdown: 'text', folderId: 'child', spaceId: space.id });
        const before = snapshot();
        failNext();
        assert.throws(() => api.deleteFolder({ id: 'parent' }, { mode: 'keep', destinationId: null }), {
          code: 'STORAGE_WRITE_FAILED'
        });
        assert.deepEqual(snapshot(), before);
        assert.equal(createFileDataStore(file).state.folders.length, 2);
        const count = writes();
        api.deleteFolder({ id: 'parent' }, { mode: 'keep', destinationId: null });
        assert.equal(writes() - count, 1);
        const restarted = createFileDataStore(file);
        assert.equal(restarted.state.folders.length, 2);
        assert(restarted.state.folders.every(folder => folder.deletedAt));
        assert.equal(restarted.state.notes[0].folderId, null);
      });
    }
  },
  {
    name: 'local markdown batch failure leaves no earlier notes or versions, success commits once',
    run() {
      withFixture(({ api, space, snapshot, writes, file }) => {
        const input = { id: 'first', title: 'First', rawMarkdown: 'text', spaceId: space.id };
        const before = snapshot();
        assert.throws(() => api.importMarkdownBatch({ items: [input, { ...input, id: 'second' }] }), {
          code: 'SIBLING_NAME_CONFLICT'
        });
        assert.deepEqual(snapshot(), before);
        assert.equal(createFileDataStore(file).state.notes.length, 0);
        const count = writes();
        api.importMarkdownBatch({ items: [input, { ...input, id: 'second', title: 'Second' }] });
        assert.equal(writes() - count, 1);
        const restarted = createFileDataStore(file);
        assert.equal(restarted.state.notes.length, 2);
        assert.equal(restarted.state.noteVersions.length, 2);
      });
    }
  }
];

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileDataStore } from '../src/infrastructure/file-data-store.ts';
import { writeJsonFileAtomically } from '../src/infrastructure/atomic-json-file.ts';
import { createAppContext } from '../src/app.factory.js';
import { coreOperationScenarios } from './fixtures/core-operation-scenarios.js';

function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-core-receipt-'));
  const file = path.join(root, 'data.json');
  let store,
    api,
    fail = false;
  const restart = () => {
    store = createFileDataStore(file, {
      writeJson(target, value) {
        if (fail) {
          fail = false;
          throw new Error('injected disk failure');
        }
        writeJsonFileAtomically(target, value);
      }
    });
    api = createAppContext({
      dataStore: store,
      ownerId: 'test',
      uploadsDir: path.join(root, 'uploads'),
      storageRootDir: root
    }).http.knowledge;
  };
  try {
    restart();
    const space = api.createDefaultKnowledgeSpace();
    run({
      get store() {
        return store;
      },
      get api() {
        return api;
      },
      file,
      space,
      restart,
      failNext: () => {
        fail = true;
      },
      journal: () => JSON.stringify(store.getSyncJournal()),
      snapshot: () => ({ state: JSON.stringify(store.state), disk: fs.readFileSync(file, 'utf8') }),
      corruptAi: () => {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        value.aiRuntime = { broken: true };
        writeJsonFileAtomically(file, value);
      }
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
export const coreOperationStoreTests = [
  ...coreOperationScenarios(withFixture),
  {
    name: '损坏/未来 JSON 核心回执保留原文，只关闭操作入口且不能当空回执重写',
    run() {
      withFixture(f => {
        const document = JSON.parse(fs.readFileSync(f.file, 'utf8'));
        document.coreOperations = { version: 999, receipts: [{ doNotDiscard: true }] };
        writeJsonFileAtomically(f.file, document);
        f.restart();
        assert(f.store.coreOperationStoreError);
        assert.equal(f.store.coreOperationStore, null);
        f.api.createNote({ id: 'manual', title: '保留坏回执', rawMarkdown: '', spaceId: f.space.id });
        assert.deepEqual(JSON.parse(fs.readFileSync(f.file, 'utf8')).coreOperations, document.coreOperations);
      });
    }
  }
];

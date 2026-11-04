import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const fileDataStoreTests = [
  {
    name: 'afterCommit 在最外层事务写入后执行，嵌套推迟、回滚丢弃、事务外立即执行',
    async run() {
      const { createFileDataStore } = await import('../src/infrastructure/file-data-store.js');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-after-commit-'));
      try {
        const store = createFileDataStore(path.join(dir, 'data.json'));
        const calls = [];
        store.runTransaction(() => {
          store.runTransaction(() => store.afterCommit(() => calls.push('inner')));
          store.afterCommit(() => calls.push('outer'));
          assert.deepEqual(calls, []);
        });
        assert.deepEqual(calls, ['inner', 'outer']);
        assert.throws(
          () =>
            store.runTransaction(() => {
              store.afterCommit(() => calls.push('rolled-back'));
              throw new Error('回滚');
            }),
          /回滚/
        );
        store.afterCommit(() => calls.push('immediate'));
        assert.deepEqual(calls, ['inner', 'outer', 'immediate']);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'missing local data with interrupted replacement files refuses empty initialization',
    async run() {
      const { createFileDataStore } = await import('../src/infrastructure/file-data-store.js');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-recovery-'));
      const target = path.join(dir, 'data.json');
      try {
        const store = createFileDataStore(target);
        store.state.spaces.push(createSpace('space-1'));
        store.flush();
        const original = fs.readFileSync(target, 'utf8');
        const backup = path.join(dir, '.data.json.123-test.bak');
        fs.renameSync(target, backup);
        fs.writeFileSync(path.join(dir, '.data.json.123-test.tmp'), '{}');
        assert.throws(() => createFileDataStore(target), { code: 'STORAGE_RECOVERY_REQUIRED' });
        assert.equal(fs.existsSync(target), false);
        assert.equal(fs.readFileSync(backup, 'utf8'), original);
        // A restored valid main file takes precedence over leftover candidates.
        fs.copyFileSync(backup, target);
        assert.equal(createFileDataStore(target).state.spaces[0].id, 'space-1');
        fs.unlinkSync(target);
        fs.unlinkSync(backup);
        assert.throws(() => createFileDataStore(target), { code: 'STORAGE_RECOVERY_REQUIRED' });
        assert.equal(fs.existsSync(target), false);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'file data store exports versioned snapshots and imports legacy v1 data',
    async run() {
      const { createFileDataStore } = await import('../src/infrastructure/file-data-store.js');
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-store-'));
      const filePath = path.join(tempDir, 'knowledge-base.json');

      try {
        const store = createFileDataStore(filePath);
        store.state.spaces.push(createSpace('space-1'));
        store.state.notes.push(createNote('note-1', 'Original note'));
        store.flush();

        const exported = store.exportSnapshot();
        assert.equal(exported.version, 'v1-local-json');
        assert.equal(exported.schemaVersion, 8);
        assert.equal(exported.data.notes.length, 1);

        const imported = store.importSnapshot({
          version: 'v1-local-json',
          data: createSnapshotData({
            spaces: [createSpace('space-2')],
            folders: [
              {
                id: 'folder-1',
                spaceId: 'space-2',
                name: 'Imported Folder'
              }
            ],
            tags: [
              {
                id: 'tag-1',
                spaceId: 'space-2',
                name: 'Imported Tag'
              }
            ],
            notes: [createNote('note-2', 'Imported note')],
            contentAnnotations: [
              {
                id: 'annotation-1',
                spaceId: 'space-2',
                noteId: 'note-2',
                quoteText: 'Imported annotation'
              }
            ]
          })
        });

        assert.equal(imported.data.spaces[0].id, 'space-2');
        assert.equal(store.state.notes[0].id, 'note-2');

        const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        assert.equal(persisted.schemaVersion, 8);
        assert.equal(persisted.notes[0].id, 'note-2');
        assert.equal(persisted.contentAnnotations[0].id, 'annotation-1');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'file data store rejects unsupported versions and malformed collections before replacement',
    async run() {
      const { createFileDataStore } = await import('../src/infrastructure/file-data-store.js');
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-store-schema-'));
      const filePath = path.join(tempDir, 'knowledge-base.json');

      try {
        const store = createFileDataStore(filePath);
        store.state.spaces.push(createSpace('space-current'));
        store.flush();
        const persistedBefore = fs.readFileSync(filePath, 'utf8');

        assert.throws(
          () =>
            store.importSnapshot({
              version: 'v99-local-json',
              data: createSnapshotData()
            }),
          error => error.code === 'STORAGE_SNAPSHOT_VERSION_UNSUPPORTED'
        );
        assert.throws(
          () =>
            store.importSnapshot({
              version: 'v1-local-json',
              data: {
                ...createSnapshotData(),
                notes: {}
              }
            }),
          error => error.code === 'STORAGE_SNAPSHOT_INVALID'
        );

        assert.equal(store.state.spaces[0].id, 'space-current');
        assert.equal(fs.readFileSync(filePath, 'utf8'), persistedBefore);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'file data store rejects broken cross references and folder cycles',
    async run() {
      const { createFileDataStore } = await import('../src/infrastructure/file-data-store.js');
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-store-references-'));
      const filePath = path.join(tempDir, 'knowledge-base.json');

      try {
        const store = createFileDataStore(filePath);
        const snapshot = overrides => ({
          version: 'v1-local-json',
          data: createSnapshotData(overrides)
        });
        const expectInvalid = (payload, message) => {
          assert.throws(
            () => store.prepareImport(payload),
            error => error.code === 'STORAGE_SNAPSHOT_INVALID' && error.message.includes(message)
          );
        };

        expectInvalid(
          snapshot({
            spaces: [createSpace('space-1')],
            folders: [
              {
                id: 'folder-a',
                spaceId: 'space-1',
                parentId: 'folder-b',
                name: 'A'
              },
              {
                id: 'folder-b',
                spaceId: 'space-1',
                parentId: 'folder-a',
                name: 'B'
              }
            ]
          }),
          'cycle'
        );

        expectInvalid(
          snapshot({
            spaces: [createSpace('space-1'), createSpace('space-2')],
            tags: [
              {
                id: 'tag-2',
                spaceId: 'space-2',
                name: 'Other space'
              }
            ],
            notes: [
              createNote('note-1', 'Cross tag', {
                spaceId: 'space-1',
                tagIds: ['tag-2']
              })
            ]
          }),
          'must belong to the same space'
        );

        expectInvalid(
          snapshot({
            spaces: [createSpace('space-1')],
            attachments: [
              {
                id: 'attachment-orphan',
                noteId: 'note-missing',
                fileName: 'orphan.txt'
              }
            ]
          }),
          'references unknown note'
        );

        expectInvalid(
          snapshot({
            spaces: [createSpace('space-1'), createSpace('space-2')],
            notes: [
              createNote('note-1', 'Annotation source', {
                spaceId: 'space-1'
              })
            ],
            contentAnnotations: [
              {
                id: 'annotation-1',
                spaceId: 'space-2',
                noteId: 'note-1',
                quoteText: 'quote'
              }
            ]
          }),
          'must belong to the same space'
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'file data store keeps memory and disk unchanged when import persistence fails',
    async run() {
      const { createFileDataStore } = await import('../src/infrastructure/file-data-store.js');
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-store-failure-'));
      const filePath = path.join(tempDir, 'knowledge-base.json');
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          schemaVersion: 1,
          ...createSnapshotData({
            spaces: [createSpace('space-current')],
            notes: [createNote('note-current', 'Current')]
          })
        })
      );
      // 先完成旧fixture升级；本例只注入后续导入提交的磁盘故障。
      createFileDataStore(filePath);
      const persistedBefore = fs.readFileSync(filePath, 'utf8');
      const store = createFileDataStore(filePath, {
        writeJson() {
          throw new Error('simulated disk failure');
        }
      });

      try {
        assert.throws(
          () =>
            store.importSnapshot({
              data: createSnapshotData({
                spaces: [createSpace('space-imported')],
                notes: [createNote('note-imported', 'Imported')]
              })
            }),
          error => error.code === 'STORAGE_WRITE_FAILED'
        );

        assert.equal(store.state.spaces[0].id, 'space-current');
        assert.equal(store.state.notes[0].id, 'note-current');
        assert.equal(fs.readFileSync(filePath, 'utf8'), persistedBefore);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'file data store commits a local transaction once and restores memory when persistence fails',
    async run() {
      const { createFileDataStore } = await import('../src/infrastructure/file-data-store.js');
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-store-transaction-'));
      const filePath = path.join(tempDir, 'knowledge-base.json');
      let writeCount = 0;

      try {
        const store = createFileDataStore(filePath, {
          writeJson(targetPath, document) {
            writeCount += 1;
            fs.writeFileSync(targetPath, JSON.stringify(document));
          }
        });
        const initialWriteCount = writeCount;

        store.runTransaction(() => {
          store.state.spaces.push(createSpace('space-transaction'));
          store.flush();
          store.state.notes.push(
            createNote('note-transaction', 'Transaction note', {
              spaceId: 'space-transaction'
            })
          );
          store.flush();
        });

        assert.equal(writeCount, initialWriteCount + 1);
        assert.equal(store.state.notes[0].id, 'note-transaction');

        const stableWriteCount = writeCount;
        assert.throws(
          () =>
            store.runTransaction(() => {
              store.state.notes.push(
                createNote('note-rollback', 'Rollback note', {
                  spaceId: 'space-transaction'
                })
              );
              store.flush();
              throw new Error('abort transaction');
            }),
          /abort transaction/
        );
        assert.equal(writeCount, stableWriteCount);
        assert.equal(
          store.state.notes.some(note => note.id === 'note-rollback'),
          false
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'atomic JSON replacement restores the old file when fallback replacement fails',
    async run() {
      const { writeJsonFileAtomically } = await import('../src/infrastructure/atomic-json-file.ts');
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-atomic-json-'));
      const filePath = path.join(tempDir, 'knowledge-base.json');
      fs.writeFileSync(filePath, '{"value":"old"}');
      let temporaryReplaceAttempts = 0;
      const fileSystem = {
        ...fs,
        renameSync(sourcePath, targetPath) {
          if (targetPath === filePath && path.basename(sourcePath).endsWith('.tmp')) {
            temporaryReplaceAttempts += 1;
            const error = new Error('simulated rename failure');
            error.code = temporaryReplaceAttempts === 1 ? 'EPERM' : 'EIO';
            throw error;
          }
          return fs.renameSync(sourcePath, targetPath);
        }
      };

      try {
        assert.throws(
          () =>
            writeJsonFileAtomically(
              filePath,
              { value: 'new' },
              {
                fileSystem,
                createUniqueId: () => 'test-id'
              }
            ),
          /simulated rename failure/
        );
        assert.equal(fs.readFileSync(filePath, 'utf8'), '{"value":"old"}');
        assert.deepEqual(fs.readdirSync(tempDir), ['knowledge-base.json']);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  }
];

function createSpace(id) {
  return {
    id,
    userId: 'user-1',
    name: `Space ${id}`
  };
}

function createNote(id, title, overrides = {}) {
  return {
    id,
    title,
    rawMarkdown: `# ${title}`,
    tagIds: [],
    ...overrides
  };
}

function createSnapshotData(overrides = {}) {
  return {
    spaces: [],
    folders: [],
    tags: [],
    notes: [],
    attachments: [],
    contentAnnotations: [],
    ...overrides
  };
}

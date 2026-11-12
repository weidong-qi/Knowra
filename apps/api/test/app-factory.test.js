import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const appFactoryTests = [
  {
    name: 'persistent app context permanently deletes note dependents and attachment files',
    async run() {
      const { createPersistentAppContext } = await import('../src/app.factory.ts');
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'study-cascade-delete-'));
      const app = createPersistentAppContext({
        storageRootDir: tempRoot,
        ownerId: 'cascade-owner'
      });

      try {
        const space = app.http.knowledge.createDefaultKnowledgeSpace({});
        const note = app.http.knowledge.createNote({
          id: 'note-cascade',
          title: 'Cascade',
          rawMarkdown: 'body',
          spaceId: space.id
        });
        const attachment = app.http.storage.uploadAttachment({
          noteId: note.id,
          fileName: 'cascade.txt',
          contentBase64: Buffer.from('cascade').toString('base64')
        });
        app.dataStore.state.contentAnnotations.push({
          id: 'annotation-cascade',
          noteId: note.id,
          spaceId: space.id,
          quoteText: 'body',
          status: 'active'
        });
        app.dataStore.flush();
        const attachmentPath = path.resolve(tempRoot, attachment.storagePath);
        assert.equal(fs.existsSync(attachmentPath), true);
        assert.equal(app.dataStore.state.noteVersions.length, 1);

        app.http.knowledge.deleteNote({ id: note.id });
        app.http.knowledge.permanentlyDeleteNote({ id: note.id });

        assert.equal(app.dataStore.state.notes.length, 0);
        assert.equal(app.dataStore.state.noteVersions.length, 0);
        assert.equal(app.dataStore.state.attachments.length, 0);
        assert.equal(app.dataStore.state.contentAnnotations.length, 0);
        assert.equal(fs.existsSync(attachmentPath), false);

        const persisted = JSON.parse(
          fs.readFileSync(path.join(tempRoot, 'storage', 'data', 'knowledge-base.json'), 'utf8')
        );
        assert.equal(persisted.notes.length, 0);
        assert.equal(persisted.noteVersions.length, 0);
        assert.equal(persisted.attachments.length, 0);
        assert.equal(persisted.contentAnnotations.length, 0);

        const restarted = createPersistentAppContext({
          storageRootDir: tempRoot,
          ownerId: 'cascade-owner'
        });
        assert.equal(restarted.dataStore.state.notes.length, 0);
        assert.equal(restarted.dataStore.state.noteVersions.length, 0);
      } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'persistent recycle-bin cleanup preserves formal sources and atomically removes unreferenced note versions',
    async run() {
      const { createPersistentAppContext } = await import('../src/app.factory.ts');
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'study-recycle-version-cleanup-'));
      const app = createPersistentAppContext({
        storageRootDir: tempRoot,
        ownerId: 'recycle-owner'
      });

      try {
        const space = app.http.knowledge.createDefaultKnowledgeSpace({});
        const protectedNote = app.http.knowledge.createNote({
          id: 'note-protected-source',
          title: 'Protected source',
          rawMarkdown: 'formal source',
          spaceId: space.id
        });
        const disposableNote = app.http.knowledge.createNote({
          id: 'note-disposable-source',
          title: 'Disposable source',
          rawMarkdown: 'temporary source',
          spaceId: space.id
        });
        const protectedVersion = app.http.knowledge.listNoteVersions({
          id: protectedNote.id
        })[0];
        app.http.knowledge.createKnowledgeItem({
          title: 'Protected knowledge',
          canonicalStatement: 'Formal evidence must remain traceable.',
          sourceMode: 'selection',
          evidence: [
            {
              sourceType: 'noteVersion',
              noteVersionId: protectedVersion.id
            }
          ]
        });

        app.http.knowledge.deleteNote({ id: protectedNote.id });
        app.http.knowledge.deleteNote({ id: disposableNote.id });

        assert.throws(
          () => app.http.knowledge.emptyRecycleBin({}),
          error => error.code === 'NOTE_HAS_KNOWLEDGE_EVIDENCE'
        );
        assert.deepEqual(
          app.dataStore.state.notes.map(note => note.id).sort(),
          [disposableNote.id, protectedNote.id].sort()
        );
        assert.equal(app.dataStore.state.noteVersions.length, 2);

        app.http.knowledge.restoreNote({ id: protectedNote.id });
        const result = app.http.knowledge.emptyRecycleBin({});
        assert.deepEqual(result, {
          deletedCount: 1,
          noteIds: [disposableNote.id]
        });
        assert.deepEqual(
          app.dataStore.state.notes.map(note => note.id),
          [protectedNote.id]
        );
        assert.deepEqual(
          app.dataStore.state.noteVersions.map(version => version.noteId),
          [protectedNote.id]
        );

        const restarted = createPersistentAppContext({
          storageRootDir: tempRoot,
          ownerId: 'recycle-owner'
        });
        assert.deepEqual(
          restarted.dataStore.state.notes.map(note => note.id),
          [protectedNote.id]
        );
        assert.deepEqual(
          restarted.dataStore.state.noteVersions.map(version => version.noteId),
          [protectedNote.id]
        );
      } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'createAppContext rejects attachments for missing or deleted notes',
    async run() {
      const { createAppContext } = await import('../src/app.factory.ts');
      const uploaded = [];
      const dataStore = {
        state: {
          spaces: [],
          folders: [],
          tags: [],
          notes: [
            {
              id: 'note-active',
              title: 'Active',
              rawMarkdown: 'body',
              spaceId: 'space-1',
              deleted: false
            },
            {
              id: 'note-deleted',
              title: 'Deleted',
              rawMarkdown: 'body',
              spaceId: 'space-1',
              deleted: true
            }
          ],
          attachments: [],
          contentAnnotations: []
        },
        flush() {}
      };
      const attachmentStore = {
        uploadAttachment(body) {
          uploaded.push(body);
          return body;
        }
      };
      const app = createAppContext({
        dataStore,
        attachmentStore,
        enforceReferences: false
      });

      assert.throws(
        () =>
          app.http.storage.uploadAttachment({
            noteId: 'note-missing',
            fileName: 'missing.txt',
            contentBase64: 'YQ=='
          }),
        error => error.code === 'NOTE_NOT_FOUND'
      );
      assert.throws(
        () =>
          app.http.storage.uploadAttachment({
            noteId: 'note-deleted',
            fileName: 'deleted.txt',
            contentBase64: 'YQ=='
          }),
        error => error.code === 'NOTE_NOT_FOUND'
      );

      const result = app.http.storage.uploadAttachment({
        noteId: 'note-active',
        fileName: 'active.txt',
        contentBase64: 'YQ=='
      });
      assert.equal(result.noteId, 'note-active');
      assert.equal(uploaded.length, 1);
    }
  },
  {
    name: 'createAppContext wires knowledge module and handlers together',
    async run() {
      const { createAppContext } = await import('../src/app.factory.ts');

      const app = createAppContext();

      assert.equal(typeof app.modules.knowledge.noteService.createNote, 'function');
      assert.equal(typeof app.http.knowledge.createNote, 'function');
      assert.equal(typeof app.http.knowledge.searchNotes, 'function');
      assert.equal(typeof app.http.storage.exportKnowledgeBase, 'function');
      assert.equal(typeof app.http.storage.uploadAttachment, 'function');
      assert.equal(typeof app.http.storage.updateAttachment, 'function');
      assert.equal(typeof app.http.storage.deleteAttachment, 'function');
    }
  },
  {
    name: 'createAppContext storage handlers can export and import persistent data',
    async run() {
      const { createAppContext } = await import('../src/app.factory.ts');

      const dataStore = {
        state: {
          spaces: [{ id: 'space-1' }],
          folders: [],
          tags: [],
          notes: [
            {
              id: 'note-1',
              title: 'Persisted note',
              rawMarkdown: '# Persisted note'
            }
          ],
          attachments: [{ id: 'attachment-1', noteId: 'note-1', fileName: 'hello.txt' }]
        },
        flush() {},
        exportSnapshot() {
          return {
            exportedAt: '2026-06-02T00:00:00.000Z',
            version: 'v1-local-json',
            data: {
              spaces: [...this.state.spaces],
              folders: [...this.state.folders],
              tags: [...this.state.tags],
              notes: [...this.state.notes],
              attachments: [...this.state.attachments]
            }
          };
        },
        prepareImport(payload) {
          return {
            schemaVersion: 1,
            data: structuredClone(payload.data)
          };
        },
        commitImport(payload) {
          this.state.spaces.splice(0, this.state.spaces.length, ...payload.data.spaces);
          this.state.folders.splice(0, this.state.folders.length, ...payload.data.folders);
          this.state.tags.splice(0, this.state.tags.length, ...payload.data.tags);
          this.state.notes.splice(0, this.state.notes.length, ...payload.data.notes);
          this.state.attachments.splice(0, this.state.attachments.length, ...payload.data.attachments);
          return this.exportSnapshot();
        }
      };
      const attachmentStore = {
        exported: [
          {
            id: 'attachment-1',
            noteId: 'note-1',
            fileName: 'hello.txt',
            mimeType: 'text/plain',
            contentBase64: 'aGVsbG8='
          }
        ],
        exportAttachmentsSnapshot() {
          return this.exported;
        },
        prepareAttachmentsSnapshot(items) {
          return {
            records: items.map(({ contentBase64, ...item }) => item),
            commit() {},
            rollback() {},
            finalize: () => {
              this.exported = items;
            }
          };
        }
      };

      const app = createAppContext({ dataStore, attachmentStore });
      const exported = app.http.storage.exportKnowledgeBase();
      const imported = app.http.storage.importKnowledgeBase({
        data: {
          spaces: [{ id: 'space-2' }],
          folders: [],
          tags: [],
          notes: [
            {
              id: 'note-2',
              title: 'Imported note',
              rawMarkdown: '# Imported note'
            }
          ],
          attachments: [{ id: 'attachment-2', noteId: 'note-2', fileName: 'imported.txt' }]
        },
        attachmentFiles: [
          {
            id: 'attachment-2',
            noteId: 'note-2',
            fileName: 'imported.txt',
            mimeType: 'text/plain',
            contentBase64: 'aW1wb3J0ZWQ='
          }
        ]
      });

      assert.equal(exported.data.notes[0].id, 'note-1');
      assert.equal(exported.attachmentFiles[0].id, 'attachment-1');
      assert.equal(imported.data.notes[0].id, 'note-2');
      assert.equal(imported.attachmentFiles[0].id, 'attachment-2');
      assert.equal(dataStore.state.spaces[0].id, 'space-2');
    }
  },
  {
    name: 'createPersistentAppContext resolves storage paths from the workspace root instead of cwd',
    async run() {
      const { createPersistentAppContext, resolveStoragePath } = await import('../src/app.factory.ts');
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'study-app-factory-'));
      const originalCwd = process.cwd();
      const apiCwd = originalCwd.endsWith(path.join('apps', 'api'))
        ? originalCwd
        : path.join(originalCwd, 'apps', 'api');

      try {
        process.chdir(apiCwd);

        const app = createPersistentAppContext({ storageRootDir: tempRoot });
        const expectedDataFilePath = path.join(tempRoot, 'storage', 'data', 'knowledge-base.json');
        const expectedUploadsDir = path.join(tempRoot, 'storage', 'uploads');

        assert.equal(fs.existsSync(expectedDataFilePath), true);
        assert.equal(fs.existsSync(expectedUploadsDir), true);
        assert.equal(resolveStoragePath('storage/data/knowledge-base.json', tempRoot), expectedDataFilePath);
        assert.equal(app.dataStore.state.notes.length, 0);
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  }
];

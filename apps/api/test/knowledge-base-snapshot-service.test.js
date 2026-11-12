import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const knowledgeBaseSnapshotServiceTests = [
  {
    name: 'knowledge base import commits validated data and attachment files together',
    async run() {
      const fixture = await createFixture('success');
      try {
        const imported = fixture.storage.importKnowledgeBase(createImportedSnapshot());

        assert.equal(imported.schemaVersion, 8);
        assert.equal(imported.data.notes[0].id, 'note-imported');
        assert.equal(imported.attachmentFiles[0].id, 'attachment-imported');
        assert.equal(fixture.dataStore.state.notes[0].id, 'note-imported');
        assert.equal(
          fixture.attachmentStore.readAttachmentContent('attachment-imported').content.toString('utf8'),
          'imported attachment'
        );
        assert.equal(fixture.attachmentStore.getAttachment(fixture.oldAttachment.id), null);
      } finally {
        fixture.cleanup();
      }
    }
  },
  {
    name: 'knowledge base import rejects insecure images before changing data or attachments',
    async run() {
      const fixture = await createFixture('insecure-image');
      try {
        const before = fixture.readPersistedData();
        assert.throws(
          () =>
            fixture.storage.importKnowledgeBase({
              version: 'v1-local-json',
              schemaVersion: 1,
              data: createSnapshotData({
                spaces: [createSpace('space-imported')],
                notes: [
                  {
                    ...createNote('note-imported', 'Imported'),
                    rawMarkdown: '![unsafe](http://example.com/image.png)'
                  }
                ]
              }),
              attachmentFiles: []
            }),
          error => error.code === 'INSECURE_IMAGE_URL' && error.statusCode === 422
        );

        assert.equal(fixture.readPersistedData(), before);
        assert.equal(fixture.dataStore.state.notes[0].id, 'note-current');
        assert.equal(
          fixture.attachmentStore.readAttachmentContent(fixture.oldAttachment.id).content.toString('utf8'),
          'old attachment'
        );
      } finally {
        fixture.cleanup();
      }
    }
  },
  {
    name: 'knowledge base import restores old attachment files when JSON commit fails',
    async run() {
      const fixture = await createFixture('rollback');
      const persistedBefore = fixture.readPersistedData();
      const originalCommitImport = fixture.dataStore.commitImport;
      fixture.dataStore.commitImport = () => {
        throw new Error('simulated JSON commit failure');
      };

      try {
        assert.throws(
          () => fixture.storage.importKnowledgeBase(createImportedSnapshot()),
          /simulated JSON commit failure/
        );

        assert.equal(fixture.readPersistedData(), persistedBefore);
        assert.equal(fixture.dataStore.state.notes[0].id, 'note-current');
        assert.equal(
          fixture.attachmentStore.readAttachmentContent(fixture.oldAttachment.id).content.toString('utf8'),
          'old attachment'
        );
        assert.equal(fixture.attachmentStore.getAttachment('attachment-imported'), null);
      } finally {
        fixture.dataStore.commitImport = originalCommitImport;
        fixture.cleanup();
      }
    }
  },
  {
    name: 'knowledge base import validates every attachment before replacement',
    async run() {
      const fixture = await createFixture('attachment-validation');
      const persistedBefore = fixture.readPersistedData();
      const snapshot = createImportedSnapshot();
      snapshot.data.attachments.push({
        id: 'attachment-invalid',
        noteId: 'note-imported',
        fileName: 'invalid.txt',
        mimeType: 'text/plain'
      });
      snapshot.attachmentFiles.push({
        id: 'attachment-invalid',
        noteId: 'note-imported',
        fileName: 'invalid.txt',
        mimeType: 'text/plain',
        contentBase64: 'not-base64'
      });

      try {
        assert.throws(
          () => fixture.storage.importKnowledgeBase(snapshot),
          error => error.code === 'STORAGE_ATTACHMENT_SNAPSHOT_INVALID' && error.statusCode === 422
        );
        assert.equal(fixture.readPersistedData(), persistedBefore);
        assert.equal(fixture.dataStore.state.notes[0].id, 'note-current');
        assert.equal(
          fixture.attachmentStore.readAttachmentContent(fixture.oldAttachment.id).content.toString('utf8'),
          'old attachment'
        );
      } finally {
        fixture.cleanup();
      }
    }
  }
];

async function createFixture(suffix) {
  const { createAppContext } = await import('../src/app.factory.js');
  const { createFileDataStore } = await import('../src/infrastructure/file-data-store.js');
  const { createLocalAttachmentStore } = await import('../src/infrastructure/local-attachment-store.ts');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `study-import-${suffix}-`));
  const dataStore = createFileDataStore(path.join(tempDir, 'data', 'knowledge-base.json'));
  dataStore.state.spaces.push(createSpace('space-current'));
  dataStore.state.notes.push(createNote('note-current', 'Current'));
  dataStore.flush();

  const attachmentStore = createLocalAttachmentStore({
    dataStore,
    uploadsDir: path.join(tempDir, 'uploads'),
    storageRootDir: tempDir
  });
  const oldAttachment = attachmentStore.uploadAttachment({
    noteId: 'note-current',
    fileName: 'old.txt',
    mimeType: 'text/plain',
    contentBase64: Buffer.from('old attachment').toString('base64')
  });
  const app = createAppContext({ dataStore, attachmentStore });

  return {
    tempDir,
    dataStore,
    attachmentStore,
    oldAttachment,
    storage: app.http.storage,
    readPersistedData() {
      return fs.readFileSync(path.join(tempDir, 'data', 'knowledge-base.json'), 'utf8');
    },
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function createImportedSnapshot() {
  const fileName = 'imported.txt';
  return {
    version: 'v1-local-json',
    schemaVersion: 1,
    data: createSnapshotData({
      spaces: [createSpace('space-imported')],
      notes: [createNote('note-imported', 'Imported')],
      attachments: [
        {
          id: 'attachment-imported',
          noteId: 'note-imported',
          fileName,
          mimeType: 'text/plain',
          size: 19,
          storagePath: 'storage/uploads/attachment-imported-imported.txt'
        }
      ]
    }),
    attachmentFiles: [
      {
        id: 'attachment-imported',
        noteId: 'note-imported',
        fileName,
        mimeType: 'text/plain',
        contentBase64: Buffer.from('imported attachment').toString('base64')
      }
    ]
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

function createSpace(id) {
  return {
    id,
    userId: 'user-1',
    name: `Space ${id}`
  };
}

function createNote(id, title) {
  return {
    id,
    title,
    rawMarkdown: `# ${title}`,
    tagIds: []
  };
}

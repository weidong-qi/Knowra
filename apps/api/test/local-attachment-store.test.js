import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const localAttachmentStoreTests = [
  {
    name: 'attachment ids use UUID entropy instead of timestamp and Math.random fragments',
    async run() {
      const { createAttachmentId } = await import('../src/infrastructure/local-attachment-store-utils.ts');
      const firstId = createAttachmentId();
      const secondId = createAttachmentId();

      assert.match(firstId, /^attachment-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      assert.notEqual(firstId, secondId);
    }
  },
  {
    name: 'local attachment store uploads and lists note attachments',
    async run() {
      const { createLocalAttachmentStore } = await import('../src/infrastructure/local-attachment-store.ts');

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-attachments-'));
      const uploadsDir = path.join(tempDir, 'uploads');
      const dataStore = {
        state: {
          attachments: []
        },
        flush() {}
      };

      try {
        const store = createLocalAttachmentStore({ dataStore, uploadsDir });
        const uploaded = store.uploadAttachment({
          noteId: 'note-1',
          fileName: 'lesson.txt',
          mimeType: 'text/plain',
          contentBase64: Buffer.from('hello attachment').toString('base64')
        });

        const list = store.listAttachments({ noteId: 'note-1' });
        const content = store.readAttachmentContent(uploaded.id);

        assert.equal(list.length, 1);
        assert.equal(list[0].fileName, 'lesson.txt');
        assert.equal(content.attachment.id, uploaded.id);
        assert.equal(content.content.toString('utf8'), 'hello attachment');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'local attachment store exports and restores attachment file contents',
    async run() {
      const { createLocalAttachmentStore } = await import('../src/infrastructure/local-attachment-store.ts');

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-attachments-snapshot-'));
      const uploadsDir = path.join(tempDir, 'uploads');
      const dataStore = {
        state: {
          attachments: []
        },
        flush() {}
      };

      try {
        const store = createLocalAttachmentStore({ dataStore, uploadsDir });
        const uploaded = store.uploadAttachment({
          noteId: 'note-export',
          fileName: 'diagram.txt',
          mimeType: 'text/plain',
          contentBase64: Buffer.from('attachment snapshot body').toString('base64')
        });

        const exported = store.exportAttachmentsSnapshot();
        fs.rmSync(path.join(tempDir, uploaded.storagePath), { force: true });
        dataStore.state.attachments.splice(0, dataStore.state.attachments.length);

        const restored = store.importAttachmentsSnapshot(exported);
        const content = store.readAttachmentContent(uploaded.id);

        assert.equal(exported.length, 1);
        assert.equal(exported[0].contentBase64, Buffer.from('attachment snapshot body').toString('base64'));
        assert.equal(restored.length, 1);
        assert.equal(content.content.toString('utf8'), 'attachment snapshot body');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'local attachment store deletes attachment metadata and file content together',
    async run() {
      const { createLocalAttachmentStore } = await import('../src/infrastructure/local-attachment-store.ts');

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-attachments-delete-'));
      const uploadsDir = path.join(tempDir, 'uploads');
      const dataStore = {
        state: {
          attachments: []
        },
        flush() {}
      };

      try {
        const store = createLocalAttachmentStore({ dataStore, uploadsDir });
        const uploaded = store.uploadAttachment({
          noteId: 'note-delete',
          fileName: 'delete-me.txt',
          mimeType: 'text/plain',
          contentBase64: Buffer.from('delete attachment body').toString('base64')
        });

        const deleted = store.deleteAttachment(uploaded.id);

        assert.equal(deleted.id, uploaded.id);
        assert.equal(store.listAttachments({ noteId: 'note-delete' }).length, 0);
        assert.equal(fs.existsSync(path.join(tempDir, uploaded.storagePath)), false);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'local attachment upload removes the file and metadata when persistence fails',
    async run() {
      const { createLocalAttachmentStore } = await import('../src/infrastructure/local-attachment-store.ts');
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-attachments-upload-rollback-'));
      const uploadsDir = path.join(tempDir, 'uploads');
      const dataStore = {
        state: { attachments: [] },
        flush() {
          throw new Error('simulated persistence failure');
        }
      };

      try {
        const store = createLocalAttachmentStore({ dataStore, uploadsDir });

        assert.throws(
          () =>
            store.uploadAttachment({
              noteId: 'note-upload-rollback',
              fileName: 'rollback.txt',
              mimeType: 'text/plain',
              contentBase64: Buffer.from('rollback body').toString('base64')
            }),
          /simulated persistence failure/
        );
        assert.deepEqual(dataStore.state.attachments, []);
        assert.deepEqual(fs.readdirSync(uploadsDir), []);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'local attachment delete keeps the file and metadata when persistence fails',
    async run() {
      const { createLocalAttachmentStore } = await import('../src/infrastructure/local-attachment-store.ts');
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-attachments-delete-rollback-'));
      const uploadsDir = path.join(tempDir, 'uploads');
      let rejectFlush = false;
      const dataStore = {
        state: { attachments: [] },
        flush() {
          if (rejectFlush) {
            throw new Error('simulated persistence failure');
          }
        }
      };

      try {
        const store = createLocalAttachmentStore({ dataStore, uploadsDir });
        const uploaded = store.uploadAttachment({
          noteId: 'note-delete-rollback',
          fileName: 'keep-me.txt',
          mimeType: 'text/plain',
          contentBase64: Buffer.from('keep attachment body').toString('base64')
        });
        rejectFlush = true;

        assert.throws(() => store.deleteAttachment(uploaded.id), /simulated persistence failure/);
        assert.equal(dataStore.state.attachments[0].id, uploaded.id);
        assert.equal(fs.existsSync(path.join(uploadsDir, `${uploaded.id}-${uploaded.fileName}`)), true);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'local attachment store renames attachment metadata and file path together',
    async run() {
      const { createLocalAttachmentStore } = await import('../src/infrastructure/local-attachment-store.ts');

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-attachments-rename-'));
      const uploadsDir = path.join(tempDir, 'uploads');
      const dataStore = {
        state: {
          attachments: []
        },
        flush() {}
      };

      try {
        const store = createLocalAttachmentStore({ dataStore, uploadsDir });
        const uploaded = store.uploadAttachment({
          noteId: 'note-rename',
          fileName: 'before.png',
          mimeType: 'image/png',
          contentBase64: Buffer.from('rename attachment body').toString('base64')
        });

        const previousStoragePath = uploaded.storagePath;
        const renamed = store.renameAttachment(uploaded.id, 'after name.png');
        const content = store.readAttachmentContent(uploaded.id);
        const oldPath = path.join(uploadsDir, `${uploaded.id}-before.png`);
        const newPath = path.join(uploadsDir, `${uploaded.id}-after-name.png`);

        assert.equal(renamed.fileName, 'after name.png');
        assert.equal(previousStoragePath !== renamed.storagePath, true);
        assert.equal(fs.existsSync(oldPath), false);
        assert.equal(fs.existsSync(path.join(uploadsDir, `${uploaded.id}-after name.png`)), true);
        assert.equal(content.content.toString('utf8'), 'rename attachment body');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'local attachment store keeps chinese attachment file names when renaming',
    async run() {
      const { createLocalAttachmentStore } = await import('../src/infrastructure/local-attachment-store.ts');

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-attachments-rename-cn-'));
      const uploadsDir = path.join(tempDir, 'uploads');
      const dataStore = {
        state: {
          attachments: []
        },
        flush() {}
      };

      try {
        const store = createLocalAttachmentStore({ dataStore, uploadsDir });
        const uploaded = store.uploadAttachment({
          noteId: 'note-rename-cn',
          fileName: 'image.png',
          mimeType: 'image/png',
          contentBase64: Buffer.from('rename attachment cn body').toString('base64')
        });

        const renamed = store.renameAttachment(uploaded.id, '中文图片.png');

        assert.equal(renamed.fileName, '中文图片.png');
        assert.equal(fs.existsSync(path.join(uploadsDir, `${uploaded.id}-中文图片.png`)), true);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'local attachment rename restores the old path and metadata when persistence fails',
    async run() {
      const { createLocalAttachmentStore } = await import('../src/infrastructure/local-attachment-store.ts');
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-attachments-rename-rollback-'));
      const uploadsDir = path.join(tempDir, 'uploads');
      let rejectFlush = false;
      const dataStore = {
        state: { attachments: [] },
        flush() {
          if (rejectFlush) {
            throw new Error('simulated persistence failure');
          }
        }
      };

      try {
        const store = createLocalAttachmentStore({ dataStore, uploadsDir });
        const uploaded = store.uploadAttachment({
          noteId: 'note-rename-rollback',
          fileName: 'before.txt',
          mimeType: 'text/plain',
          contentBase64: Buffer.from('rename rollback body').toString('base64')
        });
        const originalStoragePath = uploaded.storagePath;
        rejectFlush = true;

        assert.throws(() => store.renameAttachment(uploaded.id, 'after.txt'), /simulated persistence failure/);
        assert.equal(uploaded.fileName, 'before.txt');
        assert.equal(uploaded.storagePath, originalStoragePath);
        assert.equal(fs.existsSync(path.join(uploadsDir, `${uploaded.id}-before.txt`)), true);
        assert.equal(fs.existsSync(path.join(uploadsDir, `${uploaded.id}-after.txt`)), false);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'readAttachmentContent returns 404 when the attachment record is missing',
    async run() {
      const { createLocalAttachmentStore } = await import('../src/infrastructure/local-attachment-store.ts');

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-attachments-missing-record-'));
      const dataStore = { state: { attachments: [] }, flush() {} };

      try {
        const store = createLocalAttachmentStore({ dataStore, uploadsDir: path.join(tempDir, 'uploads') });
        let captured;
        try {
          store.readAttachmentContent('attachment-does-not-exist');
        } catch (error) {
          captured = error;
        }

        assert.ok(captured, 'readAttachmentContent must throw when the record is missing');
        assert.equal(captured.statusCode, 404, 'missing record must surface as 404, not a generic 400');
        assert.equal(captured.code, 'ATTACHMENT_NOT_FOUND');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'readAttachmentContent returns 404 when the file is missing on disk',
    async run() {
      const { createLocalAttachmentStore } = await import('../src/infrastructure/local-attachment-store.ts');

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-attachments-missing-file-'));
      const uploadsDir = path.join(tempDir, 'uploads');
      fs.mkdirSync(uploadsDir, { recursive: true });

      const dataStore = {
        state: {
          attachments: [
            {
              id: 'attachment-orphan',
              noteId: 'note-1',
              fileName: 'picture.png',
              mimeType: 'image/png',
              size: 0,
              storagePath: path.join(uploadsDir, 'attachment-orphan-picture.png'),
              createdAt: new Date().toISOString()
            }
          ]
        },
        flush() {}
      };

      try {
        const store = createLocalAttachmentStore({ dataStore, uploadsDir });
        let captured;
        try {
          store.readAttachmentContent('attachment-orphan');
        } catch (error) {
          captured = error;
        }

        assert.ok(captured, 'readAttachmentContent must throw when the file is missing');
        assert.equal(captured.statusCode, 404, 'missing file must surface as 404, not a generic 400');
        assert.equal(captured.code, 'ATTACHMENT_FILE_MISSING');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'createLocalAttachmentStore normalizes Windows-style attachment paths to the current runtime uploads directory',
    async run() {
      const { createLocalAttachmentStore } = await import('../src/infrastructure/local-attachment-store.ts');

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-attachments-portable-path-'));
      const uploadsDir = path.join(tempDir, 'storage', 'uploads');
      fs.mkdirSync(uploadsDir, { recursive: true });

      const fileName = 'attachment-cross-platform-picture.png';
      fs.writeFileSync(path.join(uploadsDir, fileName), Buffer.from('portable path body'));

      const dataStore = {
        state: {
          attachments: [
            {
              id: 'attachment-cross-platform',
              noteId: 'note-1',
              fileName: 'picture.png',
              mimeType: 'image/png',
              size: 0,
              storagePath: `storage\\uploads\\${fileName}`,
              createdAt: new Date().toISOString()
            }
          ]
        },
        flush() {}
      };

      try {
        const store = createLocalAttachmentStore({ dataStore, uploadsDir, storageRootDir: tempDir });
        const content = store.readAttachmentContent('attachment-cross-platform');

        assert.equal(content.content.toString('utf8'), 'portable path body');
        assert.equal(
          dataStore.state.attachments[0].storagePath,
          'storage/uploads/attachment-cross-platform-picture.png'
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'createLocalAttachmentStore migrates legacy api upload files into the active runtime uploads directory',
    async run() {
      const { createLocalAttachmentStore } = await import('../src/infrastructure/local-attachment-store.ts');

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-attachments-legacy-migrate-'));
      const uploadsDir = path.join(tempDir, 'storage', 'uploads');
      const legacyUploadsDir = path.join(tempDir, 'apps', 'api', 'storage', 'uploads');
      fs.mkdirSync(legacyUploadsDir, { recursive: true });

      const fileName = 'attachment-legacy-picture.png';
      fs.writeFileSync(path.join(legacyUploadsDir, fileName), Buffer.from('legacy upload body'));

      const dataStore = {
        state: {
          attachments: [
            {
              id: 'attachment-legacy',
              noteId: 'note-1',
              fileName: 'picture.png',
              mimeType: 'image/png',
              size: 0,
              storagePath: `storage\\uploads\\${fileName}`,
              createdAt: new Date().toISOString()
            }
          ]
        },
        flush() {}
      };

      try {
        const store = createLocalAttachmentStore({
          dataStore,
          uploadsDir,
          storageRootDir: tempDir,
          legacyUploadsDirs: [legacyUploadsDir]
        });
        const content = store.readAttachmentContent('attachment-legacy');

        assert.equal(content.content.toString('utf8'), 'legacy upload body');
        assert.equal(fs.existsSync(path.join(uploadsDir, fileName)), true);
        assert.equal(dataStore.state.attachments[0].storagePath, 'storage/uploads/attachment-legacy-picture.png');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'attachment records cannot read or delete files outside the managed uploads directory',
    async run() {
      const { createLocalAttachmentStore } = await import('../src/infrastructure/local-attachment-store.ts');
      const tempContainer = fs.mkdtempSync(path.join(os.tmpdir(), 'study-attachments-containment-'));
      const storageRootDir = path.join(tempContainer, 'workspace');
      const uploadsDir = path.join(storageRootDir, 'storage', 'uploads');
      const outsidePath = path.join(tempContainer, 'outside-secret.txt');
      fs.mkdirSync(uploadsDir, { recursive: true });
      fs.writeFileSync(outsidePath, 'must stay outside');

      const dataStore = {
        state: {
          attachments: [
            {
              id: 'attachment-absolute',
              noteId: 'note-1',
              fileName: 'absolute.txt',
              mimeType: 'text/plain',
              size: 17,
              storagePath: outsidePath,
              createdAt: new Date().toISOString()
            },
            {
              id: 'attachment-traversal',
              noteId: 'note-1',
              fileName: 'traversal.txt',
              mimeType: 'text/plain',
              size: 17,
              storagePath: '../outside-secret.txt',
              createdAt: new Date().toISOString()
            }
          ]
        },
        flush() {}
      };

      try {
        const store = createLocalAttachmentStore({
          dataStore,
          uploadsDir,
          storageRootDir
        });

        for (const attachmentId of ['attachment-absolute', 'attachment-traversal']) {
          assert.throws(
            () => store.readAttachmentContent(attachmentId),
            error => error.code === 'ATTACHMENT_FILE_MISSING'
          );
        }

        store.deleteAttachment('attachment-absolute');
        store.deleteAttachment('attachment-traversal');
        assert.equal(fs.readFileSync(outsidePath, 'utf8'), 'must stay outside');
        assert.equal(dataStore.state.attachments.length, 0);
      } finally {
        fs.rmSync(tempContainer, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'attachment file cleanup rejects raw absolute, traversal and non-canonical managed paths',
    async run() {
      const { createLocalAttachmentFileManager } =
        await import('../src/infrastructure/local-attachment-file-manager.ts');
      const tempContainer = fs.mkdtempSync(path.join(os.tmpdir(), 'study-attachments-cleanup-path-'));
      const storageRootDir = path.join(tempContainer, 'workspace');
      const uploadsDir = path.join(storageRootDir, 'storage', 'uploads');
      const absoluteOutsidePath = path.join(tempContainer, 'absolute-outside.txt');
      const traversalOutsidePath = path.join(tempContainer, 'traversal-outside.txt');
      const unrelatedManagedPath = path.join(uploadsDir, 'attachment-victim-safe.txt');
      fs.mkdirSync(uploadsDir, { recursive: true });
      fs.writeFileSync(absoluteOutsidePath, 'absolute outside');
      fs.writeFileSync(traversalOutsidePath, 'traversal outside');
      fs.writeFileSync(unrelatedManagedPath, 'managed victim');

      try {
        const fileManager = createLocalAttachmentFileManager({
          uploadsDir,
          storageRootDir
        });

        fileManager.removeAttachmentFile(absoluteOutsidePath);
        fileManager.removeAttachmentFile('../traversal-outside.txt');
        fileManager.removeAttachmentFile('storage/uploads/attachment-victim-safe.txt');

        assert.equal(fs.readFileSync(absoluteOutsidePath, 'utf8'), 'absolute outside');
        assert.equal(fs.readFileSync(traversalOutsidePath, 'utf8'), 'traversal outside');
        assert.equal(fs.readFileSync(unrelatedManagedPath, 'utf8'), 'managed victim');
      } finally {
        fs.rmSync(tempContainer, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'attachment reads and deletes never follow a managed-file symbolic link',
    async run() {
      const { createLocalAttachmentStore } = await import('../src/infrastructure/local-attachment-store.ts');
      const tempContainer = fs.mkdtempSync(path.join(os.tmpdir(), 'study-attachments-symlink-'));
      const storageRootDir = path.join(tempContainer, 'workspace');
      const uploadsDir = path.join(storageRootDir, 'storage', 'uploads');
      const outsidePath = path.join(tempContainer, 'outside-secret.txt');
      const managedPath = path.join(uploadsDir, 'attachment-symlink-secret.txt');
      fs.mkdirSync(uploadsDir, { recursive: true });
      fs.writeFileSync(outsidePath, 'symbolic-link target');

      try {
        try {
          fs.symlinkSync(outsidePath, managedPath);
        } catch (error) {
          if (error.code === 'EPERM' || error.code === 'EACCES') {
            return;
          }
          throw error;
        }

        const dataStore = {
          state: {
            attachments: [
              {
                id: 'attachment-symlink',
                noteId: 'note-1',
                fileName: 'secret.txt',
                mimeType: 'text/plain',
                size: 20,
                storagePath: 'storage/uploads/attachment-symlink-secret.txt',
                createdAt: new Date().toISOString()
              }
            ]
          },
          flush() {}
        };
        const store = createLocalAttachmentStore({
          dataStore,
          uploadsDir,
          storageRootDir
        });

        assert.throws(
          () => store.readAttachmentContent('attachment-symlink'),
          error => error.code === 'ATTACHMENT_FILE_MISSING'
        );
        store.deleteAttachment('attachment-symlink');

        assert.equal(fs.readFileSync(outsidePath, 'utf8'), 'symbolic-link target');
        assert.equal(fs.existsSync(managedPath), false);
      } finally {
        fs.rmSync(tempContainer, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'legacy attachment migration refuses symbolic links that escape a trusted legacy directory',
    async run() {
      const { createLocalAttachmentStore } = await import('../src/infrastructure/local-attachment-store.ts');
      const tempContainer = fs.mkdtempSync(path.join(os.tmpdir(), 'study-attachments-legacy-symlink-'));
      const storageRootDir = path.join(tempContainer, 'workspace');
      const uploadsDir = path.join(storageRootDir, 'storage', 'uploads');
      const legacyUploadsDir = path.join(storageRootDir, 'apps', 'api', 'storage', 'uploads');
      const outsidePath = path.join(tempContainer, 'outside-secret.txt');
      const legacyPath = path.join(legacyUploadsDir, 'attachment-legacy-symlink-secret.txt');
      fs.mkdirSync(legacyUploadsDir, { recursive: true });
      fs.writeFileSync(outsidePath, 'legacy symbolic-link target');

      try {
        try {
          fs.symlinkSync(outsidePath, legacyPath);
        } catch (error) {
          if (error.code === 'EPERM' || error.code === 'EACCES') {
            return;
          }
          throw error;
        }

        const dataStore = {
          state: {
            attachments: [
              {
                id: 'attachment-legacy-symlink',
                noteId: 'note-1',
                fileName: 'secret.txt',
                mimeType: 'text/plain',
                size: 27,
                storagePath: 'storage/uploads/attachment-legacy-symlink-secret.txt',
                createdAt: new Date().toISOString()
              }
            ]
          },
          flush() {}
        };
        const store = createLocalAttachmentStore({
          dataStore,
          uploadsDir,
          storageRootDir,
          legacyUploadsDirs: [legacyUploadsDir]
        });

        assert.throws(
          () => store.readAttachmentContent('attachment-legacy-symlink'),
          error => error.code === 'ATTACHMENT_FILE_MISSING'
        );
        assert.equal(fs.existsSync(path.join(uploadsDir, 'attachment-legacy-symlink-secret.txt')), false);
        assert.equal(fs.readFileSync(outsidePath, 'utf8'), 'legacy symbolic-link target');
      } finally {
        fs.rmSync(tempContainer, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'deleteAttachment returns 404 when the record is missing',
    async run() {
      const { createLocalAttachmentStore } = await import('../src/infrastructure/local-attachment-store.ts');

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-attachments-delete-missing-'));
      const dataStore = { state: { attachments: [] }, flush() {} };

      try {
        const store = createLocalAttachmentStore({ dataStore, uploadsDir: path.join(tempDir, 'uploads') });
        let captured;
        try {
          store.deleteAttachment('attachment-does-not-exist');
        } catch (error) {
          captured = error;
        }

        assert.ok(captured, 'deleteAttachment must throw when the record is missing');
        assert.equal(captured.statusCode, 404);
        assert.equal(captured.code, 'ATTACHMENT_NOT_FOUND');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  }
];

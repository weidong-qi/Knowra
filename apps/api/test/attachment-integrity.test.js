import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const attachmentIntegrityTests = [
  {
    name: 'attachment integrity inspection identifies repairable metadata',
    async run() {
      const { createLocalAttachmentFileManager } =
        await import('../src/infrastructure/local-attachment-file-manager.ts');
      const { buildAttachmentRepairRecord, inspectAttachmentIntegrity } =
        await import('../src/infrastructure/attachment-integrity.js');
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-integrity-ready-'));
      try {
        const fileManager = createLocalAttachmentFileManager({
          uploadsDir: path.join(tempRoot, 'storage', 'uploads'),
          storageRootDir: tempRoot
        });
        const attachment = {
          id: 'attachment-ready',
          noteId: 'note-1',
          fileName: 'diagram.png',
          size: 999,
          storagePath: fileManager.buildStoragePath('attachment-ready', 'diagram.png')
        };
        fs.writeFileSync(path.join(tempRoot, 'storage', 'uploads', 'attachment-ready-diagram.png'), 'diagram');
        const report = inspectAttachmentIntegrity({
          attachments: [attachment],
          fileManager
        });
        assert.equal(report.status, 'needs-repair');
        assert.equal(report.counts.repairable, 1);
        assert.equal(report.items[0].observedStatus, 'ready');
        const repaired = buildAttachmentRepairRecord(attachment, report.items[0]);
        assert.equal(repaired.status, 'ready');
        assert.equal(repaired.size, 7);
        assert.match(repaired.sha256, /^[a-f0-9]{64}$/);
        assert.ok(repaired.verifiedAt);
      } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'attachment integrity inspection blocks a hash mismatch',
    async run() {
      const { createLocalAttachmentFileManager } =
        await import('../src/infrastructure/local-attachment-file-manager.ts');
      const { inspectAttachmentIntegrity } = await import('../src/infrastructure/attachment-integrity.js');
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-integrity-corrupt-'));
      try {
        const fileManager = createLocalAttachmentFileManager({
          uploadsDir: path.join(tempRoot, 'uploads'),
          storageRootDir: tempRoot
        });
        const filePath = path.join(tempRoot, 'uploads', 'attachment-corrupt-file.txt');
        fs.writeFileSync(filePath, 'actual');
        const report = inspectAttachmentIntegrity({
          attachments: [
            {
              id: 'attachment-corrupt',
              noteId: 'note-1',
              fileName: 'file.txt',
              size: 6,
              sha256: '0'.repeat(64),
              storagePath: fileManager.buildStoragePath('attachment-corrupt', 'file.txt')
            }
          ],
          fileManager
        });
        assert.equal(report.status, 'degraded');
        assert.equal(report.counts.corrupt, 1);
        assert.equal(report.errors[0].code, 'ATTACHMENT_HASH_MISMATCH');
      } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'attachment integrity inspection reports missing and orphan files',
    async run() {
      const { createLocalAttachmentFileManager } =
        await import('../src/infrastructure/local-attachment-file-manager.ts');
      const { inspectAttachmentIntegrity } = await import('../src/infrastructure/attachment-integrity.js');
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-integrity-missing-'));
      try {
        const uploadsDir = path.join(tempRoot, 'uploads');
        const fileManager = createLocalAttachmentFileManager({
          uploadsDir,
          storageRootDir: tempRoot
        });
        fs.writeFileSync(path.join(uploadsDir, 'orphan-file.png'), 'orphan');
        const report = inspectAttachmentIntegrity({
          attachments: [
            {
              id: 'attachment-missing',
              noteId: 'note-1',
              fileName: 'missing.png',
              size: 10,
              storagePath: fileManager.buildStoragePath('attachment-missing', 'missing.png')
            }
          ],
          fileManager
        });
        assert.equal(report.status, 'degraded');
        assert.equal(report.counts.missing, 1);
        assert.deepEqual(report.orphanFiles, ['orphan-file.png']);
        assert.equal(report.errors[0].code, 'ATTACHMENT_FILE_MISSING');
      } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'PostgreSQL attachment upload removes an orphan file when its pending row disappeared',
    async run() {
      const { createPostgresAttachmentStore } = await import('../src/infrastructure/postgres-attachment-store.js');
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-postgres-attachment-race-'));
      let saveCount = 0;
      const attachmentRepository = {
        async save(attachment) {
          saveCount += 1;
          if (saveCount === 1) return structuredClone(attachment);
          const error = new Error('note was deleted');
          error.code = 'P2003';
          throw error;
        },
        async findById() {
          return null;
        }
      };
      try {
        const store = createPostgresAttachmentStore({
          attachmentRepository,
          storageRootDir: tempRoot,
          uploadsDir: path.join(tempRoot, 'storage', 'uploads')
        });

        await assert.rejects(
          () =>
            store.uploadAttachment({
              noteId: 'note-deleted-during-upload',
              fileName: 'race.txt',
              contentBase64: Buffer.from('race').toString('base64')
            }),
          /note was deleted/
        );
        assert.deepEqual(fs.readdirSync(path.join(tempRoot, 'storage', 'uploads')), []);
      } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  }
];

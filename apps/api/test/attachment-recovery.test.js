import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLocalAttachmentStore } from '../src/infrastructure/local-attachment-store.js';
import { createAttachmentCleanupQueue } from '../src/infrastructure/attachment-cleanup-queue.js';
import { createLocalAttachmentFileManager } from '../src/infrastructure/local-attachment-file-manager.ts';
import { prepareAttachmentRestore } from '../src/infrastructure/attachment-recovery.ts';
import { inspectAttachmentDeletion } from '../src/infrastructure/attachment-deletion-preflight.js';
import { createHash } from 'node:crypto';

export const attachmentRecoveryTests = [
  {
    name: '同步遗留 6 MiB 附件可原 ID 恢复，超限及文件提交故障不覆盖原内容',
    run() {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-restore-limits-'));
      try {
        const bytes = Buffer.alloc(6 * 1024 * 1024, 1);
        const record = {
          id: 'attachment-legacy',
          noteId: 'note',
          fileName: '原文件.bin',
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          status: 'missing',
          verifiedAt: null,
          storagePath: 'uploads/attachment-legacy-原文件.bin'
        };
        const dataStore = { state: { attachments: [record] }, flush() {} };
        const store = createLocalAttachmentStore({
          dataStore,
          storageRootDir: root,
          uploadsDir: path.join(root, 'uploads')
        });
        const body = { contentBase64: bytes.toString('base64') };
        assert.equal(store.restoreAttachment(record.id, body).id, record.id);
        assert.throws(
          () =>
            store.restoreAttachment(record.id, { contentBase64: Buffer.alloc(bytes.length + 1).toString('base64') }),
          { code: 'ATTACHMENT_TOO_LARGE' }
        );
        const file = path.join(root, record.storagePath);
        fs.writeFileSync(file, 'bad');
        store.verifyAttachment(record.id);
        const rename = fs.renameSync;
        fs.renameSync = (source, destination) => {
          if (/\.restore-.*\.tmp$/.test(source)) throw new Error('故障注入：原子文件提交失败');
          return rename(source, destination);
        };
        try {
          assert.throws(() => store.restoreAttachment(record.id, body), /原子文件提交失败/);
        } finally {
          fs.renameSync = rename;
        }
        assert.equal(fs.readFileSync(file, 'utf8'), 'bad');
        assert.equal(store.getAttachment(record.id).sha256, record.sha256);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  },
  {
    name: '附件恢复中断后只继续同身份同哈希的原文件恢复，不复活已删除 ID',
    async run() {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-restore-crash-'));
      try {
        const dataStore = { state: { attachments: [] }, flush() {} };
        const uploadsDir = path.join(root, 'uploads');
        const store = createLocalAttachmentStore({ dataStore, storageRootDir: root, uploadsDir });
        const body = {
          noteId: 'note',
          fileName: '原文件.txt',
          contentBase64: Buffer.from('original').toString('base64')
        };
        const attachment = store.uploadAttachment(body);
        const file = path.join(root, attachment.storagePath);
        const manager = createLocalAttachmentFileManager({ storageRootDir: root, uploadsDir });
        fs.writeFileSync(file, 'bad');
        store.verifyAttachment(attachment.id);
        prepareAttachmentRestore(attachment, body, manager);
        const restarted = createLocalAttachmentStore({ dataStore, storageRootDir: root, uploadsDir });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(restarted.getAttachment(attachment.id).status, 'ready');
        assert.equal(fs.readFileSync(file, 'utf8'), 'original');
        assert(!fs.readdirSync(uploadsDir).some(name => name.startsWith('.restore-')));
        prepareAttachmentRestore(attachment, body, manager);
        dataStore.state.attachments = [];
        fs.unlinkSync(file);
        createLocalAttachmentStore({ dataStore, storageRootDir: root, uploadsDir });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(dataStore.state.attachments.length, 0);
        assert(!fs.existsSync(file));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  },
  {
    name: '附件运行中缺失、损坏及原文件恢复保留身份，健康读取不重复写入',
    run() {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-attachment-recovery-'));
      let writes = 0;
      let fail = false;
      const dataStore = {
        state: { attachments: [] },
        flush() {
          writes++;
          if (fail) throw new Error('commit failure');
        }
      };
      try {
        const store = createLocalAttachmentStore({
          dataStore,
          storageRootDir: root,
          uploadsDir: path.join(root, 'uploads')
        });
        const body = {
          noteId: 'note',
          fileName: '原文件.txt',
          contentBase64: Buffer.from('original').toString('base64')
        };
        const original = { ...store.uploadAttachment(body) };
        const file = path.join(root, original.storagePath);
        const count = writes;
        store.readAttachmentContent(original.id);
        store.readAttachmentContent(original.id);
        assert.equal(writes, count);
        fs.unlinkSync(file);
        assert.throws(() => store.readAttachmentContent(original.id), { code: 'ATTACHMENT_FILE_MISSING' });
        assert.equal(store.getAttachment(original.id).status, 'missing');
        assert.throws(
          () => store.restoreAttachment(original.id, { contentBase64: Buffer.from('different').toString('base64') }),
          { code: 'ATTACHMENT_RESTORE_MISMATCH' }
        );
        assert.equal(fs.existsSync(file), false);
        store.restoreAttachment(original.id, body);
        assert.equal(store.readAttachmentContent(original.id).content.toString(), 'original');
        fs.writeFileSync(file, 'bad');
        assert.throws(() => store.readAttachmentContent(original.id), { code: 'ATTACHMENT_FILE_CORRUPT' });
        assert.equal(store.getAttachment(original.id).size, original.size);
        assert.equal(store.getAttachment(original.id).sha256, original.sha256);
        fs.writeFileSync(file, 'original');
        assert.throws(() => store.readAttachmentContent(original.id), { code: 'ATTACHMENT_FILE_CORRUPT' });
        assert.equal(store.verifyAttachment(original.id).status, 'ready');
        fs.writeFileSync(file, 'bad');
        store.verifyAttachment(original.id);
        fail = true;
        assert.throws(() => store.restoreAttachment(original.id, body), /commit failure/);
        assert.equal(fs.readFileSync(file, 'utf8'), 'bad');
        fail = false;
        store.restoreAttachment(original.id, body);
        assert.equal(store.getAttachment(original.id).noteId, original.noteId);
        store.getAttachment(original.id).sha256 = null;
        assert.throws(() => store.restoreAttachment(original.id, body), { code: 'ATTACHMENT_RESTORE_UNVERIFIABLE' });
        assert.equal(store.verifyAttachment(original.id).status, 'failed');
        assert.throws(
          () =>
            store.uploadAttachment({ ...body, contentBase64: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64') }),
          { code: 'ATTACHMENT_TOO_LARGE' }
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  },
  {
    name: '附件编码引用与历史来源不能绕过删除预检',
    run() {
      const id = 'attachment-real';
      const url = '/api/storage/attachments/%61ttachment-real/content#attachment=wrong';
      const report = inspectAttachmentDeletion(id, {
        notes: [{ id: 'note', title: '正文', rawMarkdown: url }],
        annotationRevisions: [{ id: 'revision', content: url }],
        knowledgeEvidence: [{ id: 'evidence', sourceType: 'attachment', sourceId: id }]
      });
      assert.equal(report.references.length, 3);
      assert.equal(report.references[0].title, '正文');
    }
  },
  {
    name: '附件清理任务重启可见、失败可重试且不暴露路径',
    async run() {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-cleanup-status-'));
      try {
        const manager = createLocalAttachmentFileManager({
          uploadsDir: path.join(root, 'uploads'),
          storageRootDir: root
        });
        const record = { id: 'attachment-file', fileName: 'file.txt', noteId: 'note' };
        fs.writeFileSync(manager.resolveManagedAbsolutePath(record.id, record.fileName), 'x');
        const queue = createAttachmentCleanupQueue({
          storageRootDir: root,
          fileManager: {
            ...manager,
            removeAttachmentFile() {
              throw new Error('failure');
            }
          }
        });
        queue.enqueue(record);
        assert.equal(queue.finish(record), 'pending-retry');
        assert.equal((await queue.list(() => true)).pending, 0);
        const restarted = createAttachmentCleanupQueue({ storageRootDir: root, fileManager: manager });
        const list = await restarted.list(() => false);
        assert.equal(list.pending, 1);
        assert(!JSON.stringify(list).includes(root));
        assert.deepEqual(await restarted.retry(() => false), { completed: 1, pending: 0 });
        assert.equal((await restarted.list(() => false)).pending, 0);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
];

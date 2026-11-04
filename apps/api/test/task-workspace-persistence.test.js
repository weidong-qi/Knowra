import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createFileDataStore } from '../src/infrastructure/file-data-store.js';
import { createTaskWorkspaceService } from '../src/modules/task-workspaces/service.ts';
import { createTaskWorkspaceFiles } from '../src/infrastructure/task-workspace-files.ts';
import { acquireDataFileWriteLock } from '../src/infrastructure/data-file-write-lock.ts';
import sharp from 'sharp';
function open(file, files) {
  const data = createFileDataStore(file);
  const store = data.taskWorkspaceStore;
  const service = createTaskWorkspaceService({
    store,
    files,
    authorize: () => true
  });
  const ctx = {
    ...store.readSnapshot(tx => tx.identity()),
    actor: { kind: 'user', id: 'synthetic' },
    guard: () => true
  };
  return { data, store, service, ctx };
}
export const taskWorkspacePersistenceTests = [
  {
    name: 'task workspace real JSON atomic persistence restart and writer conflict',
    run() {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-workspace-json-'));
      try {
        const file = path.join(root, 'data.json');
        const a = open(file),
          b = open(file);
        const input = { operationId: randomUUID(), name: '持久化合成工作区' };
        const result = a.service.createWorkspace(a.ctx, input);
        assert.throws(
          () =>
            b.service.createWorkspace(b.ctx, {
              operationId: randomUUID(),
              name: '并发旧写入'
            }),
          { code: 'TASK_WORKSPACE_CONFLICT' }
        );
        const c = open(file);
        assert.equal(c.service.listWorkspaces(c.ctx).items.length, 1);
        assert.deepEqual(c.service.createWorkspace(c.ctx, input), {
          ...result,
          reused: true
        });
        const lock = acquireDataFileWriteLock(file);
        try {
          assert.throws(
            () =>
              c.service.createWorkspace(c.ctx, {
                operationId: randomUUID(),
                name: '锁内不能写'
              }),
            { code: 'TASK_WORKSPACE_UNAVAILABLE' }
          );
        } finally {
          lock.release();
        }
        assert.equal(open(file).service.listWorkspaces(c.ctx).items.length, 1);
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.equal(parsed.taskWorkspaces.workspaces.length, 1);
        assert.equal(parsed.notes.length, 0);
        assert.ok(!JSON.stringify(parsed.sync).includes(result.data.workspace.id));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'task workspace image upload version reference restart and bytes integrity',
    async run() {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-workspace-image-'));
      try {
        const file = path.join(root, 'data.json'),
          files = createTaskWorkspaceFiles({
            uploadsDirectory: path.join(root, 'uploads')
          });
        const a = open(file, files);
        const call = (kind, input) => a.service[kind](a.ctx, { operationId: randomUUID(), ...input });
        const workspace = call('createWorkspace', { name: '图片合成工作区' }).data.workspace;
        const d = call('createDocument', {
          workspaceId: workspace.id,
          title: '图片资料',
          markdown: '待插图'
        }).data.document;
        const bytes = await sharp({
          create: { width: 2, height: 3, channels: 3, background: '#abcdef' }
        })
          .png()
          .toBuffer();
        const input = {
          operationId: randomUUID(),
          workspaceId: workspace.id,
          documentId: d.id,
          expectedRevision: d.revision,
          fileName: 'synthetic.png',
          mimeType: 'image/png',
          bytes
        };
        const uploaded = await a.service.uploadAttachment(a.ctx, input);
        const replay = await a.service.uploadAttachment(a.ctx, input);
        assert.equal(replay.reused, true);
        assert.equal(replay.data.attachment.id, uploaded.data.attachment.id);
        assert.ok(!('storageKey' in uploaded.data.attachment));
        const updated = call('updateDocument', {
          workspaceId: workspace.id,
          documentId: d.id,
          expectedRevision: uploaded.data.documentRevision,
          markdown: `![合成图片](${uploaded.data.imageUri})`
        }).data.document;
        const b = open(file, files);
        const image = await b.service.readAttachment(b.ctx, {
          workspaceId: workspace.id,
          documentId: d.id,
          versionId: updated.version.id,
          attachmentId: uploaded.data.attachment.id
        });
        assert.deepEqual(image.bytes, bytes);
        assert.equal(image.width, 2);
        assert.equal(image.height, 3);
        await assert.rejects(
          () =>
            b.service.readAttachment(b.ctx, {
              workspaceId: workspace.id,
              documentId: d.id,
              versionId: d.version.id,
              attachmentId: uploaded.data.attachment.id
            }),
          { code: 'TASK_WORKSPACE_FORBIDDEN' }
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
];

taskWorkspacePersistenceTests.push({
  name: 'task workspace output revocation preserves committed attachment bytes',
  async run() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-workspace-late-output-'));
    try {
      const file = path.join(root, 'data.json');
      const files = createTaskWorkspaceFiles({
        uploadsDirectory: path.join(root, 'uploads')
      });
      const opened = open(file, files);
      const w = opened.service.createWorkspace(opened.ctx, {
        operationId: randomUUID(),
        name: '合成'
      }).data.workspace;
      const d = opened.service.createDocument(opened.ctx, {
        operationId: randomUUID(),
        workspaceId: w.id,
        title: '合成',
        markdown: ''
      }).data.document;
      let authorized = true;
      const wrapped = {
        ...files,
        async stage(input) {
          const staged = await files.stage(input);
          return {
            ...staged,
            commit() {
              staged.commit();
              authorized = false;
            }
          };
        }
      };
      const service = createTaskWorkspaceService({
        store: opened.store,
        files: wrapped,
        authorize: () => authorized
      });
      const bytes = await sharp({
        create: { width: 1, height: 1, channels: 3, background: '#000000' }
      })
        .png()
        .toBuffer();
      await assert.rejects(
        () =>
          service.uploadAttachment(opened.ctx, {
            operationId: randomUUID(),
            workspaceId: w.id,
            documentId: d.id,
            expectedRevision: 1,
            fileName: 'synthetic.png',
            mimeType: 'image/png',
            bytes
          }),
        { code: 'TASK_WORKSPACE_FORBIDDEN' }
      );
      const persisted = open(file, files).store.readSnapshot(tx => tx.get('documents', d.id));
      assert.equal(persisted.attachments.length, 1);
      assert.deepEqual((await files.read(persisted.attachments[0])).bytes, bytes);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

taskWorkspacePersistenceTests.push({
  name: 'task workspace JSON transaction handles expire and cannot persist escaped writes',
  run() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-workspace-escaped-tx-'));
    try {
      const file = path.join(root, 'data.json');
      const opened = open(file);
      let escaped, escapedRead;
      opened.store.runTransaction(tx => {
        escaped = tx;
      });
      opened.store.readSnapshot(tx => {
        escapedRead = tx;
      });
      for (const tx of [escaped, escapedRead]) {
        for (const action of [
          () => tx.identity(),
          () => tx.list('workspaces'),
          () => tx.get('workspaces', 'missing'),
          () => tx.insert('workspaces', { id: 'unvalidated' }),
          () => tx.replace('workspaces', { id: 'unvalidated' })
        ])
          assert.throws(action, { code: 'TASK_WORKSPACE_FORBIDDEN' });
      }
      opened.service.createWorkspace(opened.ctx, {
        operationId: randomUUID(),
        name: '唯一合成工作区'
      });
      const persisted = JSON.parse(fs.readFileSync(file, 'utf8')).taskWorkspaces;
      assert.equal(persisted.workspaces.length, 1);
      assert.equal(persisted.workspaces[0].name, '唯一合成工作区');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

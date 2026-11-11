import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

const attachmentUrl = id => `/api/storage/attachments/${id}/content`;

export const assetLifecycleStage0Tests = [
  {
    name: 'PostgreSQL 附件预检适配全部核心集合，并读取待办 JSONB 中的引用',
    async run() {
      const { inspectAttachmentDeletion, loadPostgresAttachmentReferenceState } =
        await import('../src/infrastructure/attachment-deletion-preflight.ts');
      const seen = new Set();
      const db = new Proxy(
        {},
        {
          get: (_, model) => {
            assert.notEqual(model, 'undefined');
            seen.add(model);
            return {
              findMany: async () =>
                model === 'personalTodo'
                  ? [{ data: { id: 'todo', title: '任务', note: attachmentUrl('todo-attachment') } }]
                  : []
            };
          }
        }
      );
      const state = await loadPostgresAttachmentReferenceState(db);
      assert(seen.has('personalTodo'));
      assert.deepEqual(
        inspectAttachmentDeletion('todo-attachment', state).references.map(row => [row.collection, row.id, row.title]),
        [['personalTodos', 'todo', '任务']]
      );
    }
  },
  {
    name: '附件只读预检区分正文、回收站、历史版本与业务来源引用',
    async run() {
      const { inspectAttachmentDeletion } = await import('../src/infrastructure/attachment-deletion-preflight.ts');
      const id = 'attachment-stage0';
      const state = {
        notes: [
          { id: 'active', rawMarkdown: `![图](${attachmentUrl(id)})` },
          { id: 'trash', deleted: true, rawMarkdown: attachmentUrl(id) }
        ],
        noteVersions: [{ id: 'version', content: attachmentUrl(id) }],
        analysisScopeSnapshots: [{ id: 'scope', segments: [{ text: attachmentUrl(id) }] }],
        questionSources: [{ id: 'source', locator: { attachmentId: id } }]
      };
      const before = structuredClone(state);
      const report = inspectAttachmentDeletion(id, state);
      assert.equal(report.decision, 'requires-dependency-action');
      assert.deepEqual(
        report.references.map(({ category, collection, id: refId }) => [category, collection, refId]),
        [
          ['shared', 'notes', 'active'],
          ['shared', 'notes', 'trash'],
          ['history', 'noteVersions', 'version'],
          ['independent', 'questionSources', 'source'],
          ['history', 'analysisScopeSnapshots', 'scope']
        ]
      );
      assert.equal(report.references.find(reference => reference.id === 'trash').retention, 'recycle-bin');
      assert.deepEqual(state, before);
      assert.equal(inspectAttachmentDeletion('unused', state).decision, 'can-purge-no-history');
    }
  },
  {
    name: '附件预检 HTTP 入口只读取引用并返回结构化结果',
    async run() {
      const { createServer } = await import('../src/server.js');
      let reads = 0;
      const server = createServer({
        appContext: {
          http: {
            knowledge: {},
            storage: {
              inspectAttachmentDeletion: ({ id }) => {
                reads += 1;
                return { asset: { type: 'attachment', id }, decision: 'requires-dependency-action', references: [] };
              },
              deleteAttachment: () => {
                throw new Error('unexpected deletion');
              }
            }
          }
        },
        logger: { error() {} }
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      try {
        const response = await fetch(
          `http://127.0.0.1:${server.address().port}/api/storage/attachments/example/deletion-preflight`
        );
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).data.asset, { type: 'attachment', id: 'example' });
        assert.equal(reads, 1);
      } finally {
        server.close();
        await once(server, 'close');
      }
    }
  },
  {
    name: 'JSON 附件删除在历史引用存在时保留元数据和文件，执行时重新预检',
    async run() {
      const { createLocalAttachmentStore } = await import('../src/infrastructure/local-attachment-store.js');
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-stage0-local-'));
      const state = { attachments: [], notes: [], noteVersions: [] };
      try {
        const store = createLocalAttachmentStore({
          dataStore: { state, flush() {} },
          uploadsDir: path.join(root, 'uploads'),
          storageRootDir: root
        });
        const attachment = store.uploadAttachment({
          noteId: 'note-1',
          fileName: 'keep.txt',
          contentBase64: Buffer.from('keep').toString('base64')
        });
        const file = path.join(root, 'uploads', `${attachment.id}-${attachment.fileName}`);
        assert.equal(store.inspectAttachmentDeletion(attachment.id).decision, 'can-purge-no-history');
        state.noteVersions.push({ id: 'version-1', content: attachmentUrl(attachment.id) });
        assert.throws(() => store.deleteAttachment(attachment.id), { code: 'ATTACHMENT_REFERENCED' });
        assert.equal(state.attachments.length, 1);
        assert.equal(fs.existsSync(file), true);
        state.noteVersions.length = 0;
        store.deleteAttachment(attachment.id);
        assert.equal(state.attachments.length, 0);
        assert.equal(fs.existsSync(file), false);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'PostgreSQL 附件删除在事务内复核引用，阻断时不删除记录',
    async run() {
      const { createPostgresAttachmentStore } = await import('../src/infrastructure/postgres-attachment-store.js');
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-stage0-postgres-'));
      const attachment = {
        id: 'attachment-pg',
        noteId: 'note-1',
        fileName: 'keep.txt',
        storagePath: 'storage/uploads/attachment-pg-keep.txt'
      };
      let deleted = false;
      let transactionCount = 0;
      const state = { noteVersions: [{ id: 'version-1', content: attachmentUrl(attachment.id) }] };
      try {
        const store = createPostgresAttachmentStore({
          attachmentRepository: {
            findById: async () => (deleted ? null : attachment),
            delete: async () => {
              deleted = true;
              return attachment;
            }
          },
          loadReferenceState: async () => state,
          runTransaction: async operation => {
            transactionCount += 1;
            return operation();
          },
          uploadsDir: path.join(root, 'storage', 'uploads'),
          storageRootDir: root
        });
        await assert.rejects(() => store.deleteAttachment(attachment.id), { code: 'ATTACHMENT_REFERENCED' });
        assert.equal(deleted, false);
        assert.equal(transactionCount, 1);
        state.noteVersions.length = 0;
        assert.equal((await store.inspectAttachmentDeletion(attachment.id)).decision, 'can-purge-no-history');
        state.notes = [{ id: 'note-1', rawMarkdown: attachmentUrl(attachment.id) }];
        await assert.rejects(() => store.deleteAttachment(attachment.id), { code: 'ATTACHMENT_REFERENCED' });
        assert.equal(deleted, false);
        const unguarded = createPostgresAttachmentStore({
          attachmentRepository: {
            findById: async () => attachment,
            delete: async () => {
              deleted = true;
              return attachment;
            }
          },
          loadReferenceState: async () => ({}),
          uploadsDir: path.join(root, 'storage', 'uploads'),
          storageRootDir: root
        });
        await assert.rejects(() => unguarded.deleteAttachment(attachment.id), {
          code: 'ATTACHMENT_PREFLIGHT_UNAVAILABLE'
        });
        assert.equal(deleted, false);
        state.notes.length = 0;
        await store.deleteAttachment(attachment.id);
        assert.equal(deleted, true);
        assert.equal(transactionCount, 3);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'JSON 笔记清理不能顺带删除其他笔记仍引用的附件',
    async run() {
      const { createLocalAttachmentStore } = await import('../src/infrastructure/local-attachment-store.js');
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-stage0-note-attachment-'));
      const state = { attachments: [], notes: [], noteVersions: [] };
      try {
        const store = createLocalAttachmentStore({
          dataStore: { state, flush() {} },
          uploadsDir: path.join(root, 'uploads'),
          storageRootDir: root
        });
        const attachment = store.uploadAttachment({
          noteId: 'note-owner',
          fileName: 'shared.txt',
          contentBase64: Buffer.from('shared').toString('base64')
        });
        state.notes.push({ id: 'note-other', rawMarkdown: attachmentUrl(attachment.id) });
        assert.throws(() => store.detachAttachmentsForNotes(['note-owner']), { code: 'ATTACHMENT_REFERENCED' });
        assert.equal(state.attachments.length, 1);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  },
  {
    name: '持久化笔记永久删除遇共享附件时保持笔记、版本和文件',
    async run() {
      const { createPersistentAppContext } = await import('../src/app.factory.js');
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-stage0-cascade-'));
      try {
        const app = createPersistentAppContext({ storageRootDir: root, ownerId: 'stage0-owner' });
        const space = app.http.knowledge.createDefaultKnowledgeSpace({});
        const owner = app.http.knowledge.createNote({
          id: 'stage0-owner-note',
          spaceId: space.id,
          title: '附件所属',
          rawMarkdown: '所属正文'
        });
        const attachment = app.http.storage.uploadAttachment({
          noteId: owner.id,
          fileName: 'shared.txt',
          contentBase64: Buffer.from('shared').toString('base64')
        });
        app.http.knowledge.createNote({
          id: 'stage0-other-note',
          spaceId: space.id,
          title: '其他正文',
          rawMarkdown: attachmentUrl(attachment.id)
        });
        app.http.knowledge.deleteNote({ id: owner.id });
        assert.throws(() => app.http.knowledge.permanentlyDeleteNote({ id: owner.id }), {
          code: 'ATTACHMENT_REFERENCED'
        });
        assert.equal(app.dataStore.state.notes.find(note => note.id === owner.id).deleted, true);
        assert.equal(
          app.dataStore.state.attachments.some(item => item.id === attachment.id),
          true
        );
        assert.equal(
          app.dataStore.state.noteVersions.some(version => version.noteId === owner.id),
          true
        );
        assert.equal(fs.existsSync(path.join(root, attachment.storagePath)), true);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'PostgreSQL 笔记清理在事务内阻止其他资产共用附件',
    async run() {
      const { createAsyncNoteDeletionCoordinator } =
        await import('../src/modules/knowledge/application/postgres-async/note-deletion-coordinator.js');
      let deleted = false;
      let includeOther = true;
      const coordinator = createAsyncNoteDeletionCoordinator({
        noteService: {
          async permanentlyDeleteNote() {
            deleted = true;
            return { id: 'note-owner' };
          }
        },
        attachmentStore: {
          async listAttachments() {
            return [{ id: 'shared', noteId: 'note-owner' }];
          },
          async inspectAttachmentDeletion() {
            return {
              references: [
                { collection: 'notes', id: 'note-owner' },
                { collection: 'noteVersions', id: 'version-owner', noteId: 'note-owner' },
                ...(includeOther ? [{ collection: 'notes', id: 'note-other' }] : [])
              ]
            };
          }
        },
        runTransaction: async operation => operation()
      });
      await assert.rejects(() => coordinator.permanentlyDeleteNote('note-owner'), { code: 'ATTACHMENT_REFERENCED' });
      assert.equal(deleted, false);
      includeOther = false;
      await coordinator.permanentlyDeleteNote('note-owner');
      assert.equal(deleted, true);
    }
  },
  {
    name: '同步批次不能删除仍被历史版本引用的附件',
    async run() {
      const { createEmptyLocalState } = await import('../src/infrastructure/local-data-schema.js');
      const { prepareBatchState } = await import('../src/modules/sync/batch-domain.ts');
      const before = createEmptyLocalState();
      before.attachments.push({ id: 'attachment-sync' });
      before.noteVersions.push({ id: 'version-sync', content: attachmentUrl('attachment-sync') });
      assert.throws(
        () =>
          prepareBatchState(
            before,
            [
              {
                collection: 'attachments',
                id: 'attachment-sync',
                value: null
              }
            ],
            'demo'
          ),
        { code: 'ATTACHMENT_REFERENCED' }
      );
      assert.equal(before.attachments.length, 1);
    }
  },
  {
    name: '笔记永久删除继续阻止被分析快照引用的历史版本',
    async run() {
      const { createKnowledgeModule } = await import('../src/modules/knowledge/index.js');
      const snapshots = [];
      const knowledge = createKnowledgeModule({ analysisScopeSnapshots: snapshots });
      const note = knowledge.noteService.createNote({
        id: 'stage0-protected-note',
        spaceId: 'space-demo',
        title: '来源',
        rawMarkdown: '保留正文'
      });
      const version = knowledge.noteVersionService.listVersions({ noteId: note.id })[0];
      snapshots.push({ id: 'scope-1', noteVersions: [{ noteVersionId: version.id }] });
      knowledge.noteService.deleteNote(note.id);
      assert.throws(() => knowledge.noteService.permanentlyDeleteNote(note.id), { code: 'NOTE_HAS_ANALYSIS_SCOPE' });
      assert.equal(knowledge.noteVersionService.listVersions({ noteId: note.id }).length, 1);
    }
  }
];

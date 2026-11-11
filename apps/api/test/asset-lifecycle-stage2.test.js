import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKnowledgeModule } from '../src/modules/knowledge/index.ts';
import { createFileDataStore } from '../src/infrastructure/file-data-store.ts';
import { createAppContext } from '../src/app.factory.ts';
import { createAttachmentCleanupQueue } from '../src/infrastructure/attachment-cleanup-queue.ts';
import { buildNoteVersionPrunePreview } from '../src/modules/knowledge/application/note-version-prune-preview.ts';

export const assetLifecycleStage2Tests = [
  {
    name: '阶段2 JSON 永久清理重复提交只返回墓碑结果，不再次扩大删除范围',
    run() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-stage2-repeat-'));
      try {
        const store = createFileDataStore(path.join(dir, 'data.json'));
        const app = createAppContext({ dataStore: store, storageRootDir: dir, uploadsDir: path.join(dir, 'uploads') });
        const { item } = app.modules.knowledge.knowledgeItemService.createCandidate({
          title: '重复清理',
          canonicalStatement: '测试'
        });
        const trashed = app.modules.knowledge.knowledgeItemService.trash(item.id);
        const first = app.modules.knowledge.permanentlyDeleteKnowledgeItem(item.id, {
          expectedUpdatedAt: trashed.updatedAt
        });
        assert.equal(first.status, 'subject-purged');
        const before = store.getSyncJournal().head;
        const repeated = app.modules.knowledge.permanentlyDeleteKnowledgeItem(item.id, {
          expectedUpdatedAt: trashed.updatedAt
        });
        assert.equal(repeated.status, 'already-purged');
        assert.equal(store.getSyncJournal().head, before);
        assert.throws(
          () =>
            app.modules.knowledge.knowledgeItemService.createCandidate({
              id: item.id,
              title: '迟到的 AI 回写',
              canonicalStatement: '旧内容'
            }),
          { code: 'KNOWLEDGE_ITEM_ID_DELETED' }
        );
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  },
  {
    name: '阶段2 知识点永久删除按实际引用阻断，执行前复核新增引用并清理专属来源',
    run() {
      const knowledge = createKnowledgeModule();
      const { item, evidence } = knowledge.knowledgeItemService.createCandidate({
        id: 'purge-k',
        title: '概念',
        canonicalStatement: '定义',
        sourceMode: 'manual',
        evidence: [{ sourceType: 'manual', quoteText: '专属摘录' }]
      });
      const trashed = knowledge.knowledgeItemService.trash(item.id);
      const preview = knowledge.inspectKnowledgePurge(item.id);
      assert.equal(preview.decision, 'can-purge-no-history');
      assert.deepEqual(preview.exclusiveRecords.knowledgeEvidenceIds, [evidence[0].id]);
      knowledge.repositories.questionSourceRepository.save({
        id: 'source-1',
        questionId: 'question-1',
        sourceType: 'knowledgeItem',
        sourceId: item.id
      });
      assert.throws(() => knowledge.permanentlyDeleteKnowledgeItem(item.id, { expectedUpdatedAt: trashed.updatedAt }), {
        code: 'KNOWLEDGE_ITEM_PURGE_BLOCKED'
      });
      assert(knowledge.repositories.knowledgeItemRepository.findById(item.id));
      knowledge.repositories.questionSourceRepository.replaceForQuestion('question-1', []);
      assert.throws(() => knowledge.permanentlyDeleteKnowledgeItem(item.id, { expectedUpdatedAt: item.updatedAt }), {
        code: 'KNOWLEDGE_ITEM_UPDATE_CONFLICT'
      });
      const result = knowledge.permanentlyDeleteKnowledgeItem(item.id, { expectedUpdatedAt: trashed.updatedAt });
      assert.equal(result.exclusiveRecordsDeleted.knowledgeEvidence, 1);
      assert.equal(knowledge.repositories.knowledgeItemRepository.findById(item.id), null);
      assert.equal(knowledge.repositories.knowledgeEvidenceRepository.findById(evidence[0].id), null);
    }
  },
  {
    name: '阶段2 本地墓碑在旧备份导入后仍保留并阻止旧 ID 复活',
    run() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-stage2-import-'));
      try {
        const store = createFileDataStore(path.join(dir, 'data.json'));
        store.state.spaces.push({ id: 'space-1', userId: 'demo', name: '资料库' });
        store.state.tags.push({ id: 'tag-1', spaceId: 'space-1', name: '旧标签' });
        store.flush();
        const oldBackup = store.exportSnapshot();
        store.state.tags.splice(0, 1);
        store.flush();
        assert.equal(store.getSyncJournal().tombstones[JSON.stringify(['tags', 'tag-1'])].id, 'tag-1');
        assert.throws(() => store.importSnapshot(oldBackup), { code: 'IMPORT_DELETED_ID' });
        const safeBackup = store.exportSnapshot();
        store.importSnapshot(safeBackup);
        assert(store.getSyncJournal().tombstones[JSON.stringify(['tags', 'tag-1'])]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  },
  {
    name: '阶段2 文件清理任务先落盘，元数据仍在时重试不删除文件',
    async run() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-stage2-cleanup-'));
      try {
        let removed = 0;
        let failOnce = true;
        const queue = createAttachmentCleanupQueue({
          storageRootDir: dir,
          fileManager: {
            resolveManagedAttachmentPath: attachment => path.join(dir, `${attachment.id}.bin`),
            removeAttachmentFile: () => {
              if (failOnce) {
                failOnce = false;
                throw new Error('temporary cleanup failure');
              }
              removed++;
            }
          }
        });
        const attachment = { id: 'attachment-1', fileName: 'file.bin' };
        queue.enqueue(attachment);
        // 未提交删除的意图保留，但不计入已提交删除的待清理文件。
        assert.equal((await queue.retry(() => true)).pending, 0);
        assert.equal((await queue.list(() => true)).pending, 0);
        assert.equal(removed, 0);
        assert.deepEqual(await queue.retry(() => false), { completed: 0, pending: 1 });
        assert.deepEqual(await queue.retry(() => false), { completed: 1, pending: 0 });
        assert.equal(removed, 1);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  },
  {
    name: '阶段2 版本预览保护当前正文与正式来源，缺少保留点元数据时不自动裁剪',
    run() {
      const note = { id: 'note-1', rawMarkdown: '当前内容' };
      const versions = [
        { id: 'old', contentHash: 'old', createdAt: '2026-01-01', createdBy: 'user' },
        { id: 'current', contentHash: 'current', createdAt: '2026-01-02', createdBy: 'user' }
      ];
      const preview = buildNoteVersionPrunePreview({
        note,
        versions,
        evidence: [{ id: 'e1', noteVersionId: 'old' }],
        questionSources: [],
        annotations: [],
        exclusions: [],
        analysisScopes: []
      });
      assert.equal(preview.mode, 'preview-only');
      assert.equal(preview.versions[0].reason, 'retained-reference');
      assert.equal(
        preview.versions.every(version => !version.canPruneNow),
        true
      );
    }
  },
  {
    name: '阶段2 空空间可删除，默认外壳与回收站内容均受到预检保护',
    run() {
      const knowledge = createKnowledgeModule();
      const spaces = knowledge.repositories.knowledgeSpaceRepository;
      spaces.save({
        id: 'default',
        userId: 'demo',
        name: '默认空间',
        defaultFlag: true,
        updatedAt: '2026-09-23T00:00:00Z'
      });
      spaces.save({
        id: 'other',
        userId: 'demo',
        name: '其他空间',
        defaultFlag: false,
        updatedAt: '2026-09-23T00:00:00Z'
      });
      assert.equal(knowledge.inspectEmptySpaceDeletion('default').decision, 'system-shell-protected');
      assert.throws(() => knowledge.deleteEmptySpace('default', { expectedUpdatedAt: '2026-09-23T00:00:00Z' }), {
        code: 'KNOWLEDGE_SPACE_DELETE_BLOCKED'
      });
      knowledge.noteService.createNote({ id: 'deleted-note', spaceId: 'other', title: '已回收', rawMarkdown: '' });
      knowledge.noteService.deleteNote('deleted-note');
      assert.equal(knowledge.inspectEmptySpaceDeletion('other').decision, 'requires-content-action');
      assert.throws(() => knowledge.deleteEmptySpace('other', { expectedUpdatedAt: '2026-09-23T00:00:00Z' }), {
        code: 'KNOWLEDGE_SPACE_DELETE_BLOCKED'
      });
      knowledge.repositories.noteRepository.delete('deleted-note');
      knowledge.repositories.noteVersionRepository.deleteByNoteIds(['deleted-note']);
      assert.equal(
        knowledge.deleteEmptySpace('other', { expectedUpdatedAt: '2026-09-23T00:00:00Z' }).status,
        'empty-container-deleted'
      );
      assert.equal(spaces.findById('other'), null);
    }
  },
  {
    name: '阶段2 整包迁移空间内资产，预览过期不扩大范围，默认空间外壳保留',
    run() {
      const knowledge = createKnowledgeModule();
      const source = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
      const target = {
        id: 'space-new',
        userId: 'demo',
        name: '新空间',
        defaultFlag: false,
        updatedAt: '2026-09-23T00:00:00Z'
      };
      knowledge.repositories.knowledgeSpaceRepository.save(target);
      const group = knowledge.repositories.tagGroupRepository
        .list({ spaceId: source.id })
        .find(record => record.code === 'ordinary');
      knowledge.repositories.tagRepository.save({
        id: 'moving-tag',
        spaceId: source.id,
        groupId: group.id,
        name: '迁移标签'
      });
      knowledge.noteService.createNote({
        id: 'moving-note',
        spaceId: source.id,
        title: '迁移笔记',
        rawMarkdown: '正文',
        tagIds: ['moving-tag']
      });
      const before = knowledge.previewSpaceMigration(source.id, target.id);
      assert.equal(before.decision, 'can-migrate');
      knowledge.repositories.tagRepository.save({
        id: 'late-tag',
        spaceId: source.id,
        groupId: group.id,
        name: '新标签'
      });
      assert.throws(
        () =>
          knowledge.migrateSpaceAssets(source.id, {
            targetSpaceId: target.id,
            expectedPreviewHash: before.previewHash
          }),
        { code: 'SPACE_MIGRATION_PREVIEW_STALE' }
      );
      const fresh = knowledge.previewSpaceMigration(source.id, target.id);
      const result = knowledge.migrateSpaceAssets(source.id, {
        targetSpaceId: target.id,
        expectedPreviewHash: fresh.previewHash
      });
      assert.equal(result.status, 'scoped-assets-migrated');
      assert.equal(knowledge.repositories.noteRepository.findById('moving-note').spaceId, target.id);
      assert.equal(knowledge.repositories.tagRepository.findById('moving-tag').spaceId, target.id);
      assert.equal(
        knowledge.repositories.tagRepository.findById('moving-tag').groupId,
        `tag-group-${target.id}-ordinary`
      );
      assert(knowledge.repositories.knowledgeSpaceRepository.findById(source.id));
    }
  }
];

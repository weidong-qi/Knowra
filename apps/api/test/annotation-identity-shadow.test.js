import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  anchorFromProjectedRange,
  projectMarkdown,
  calculateContentHash,
  identityQuoteHash,
  sourceEdit,
  updateStructure
} from '@study-accelerator/content-anchor';
import { createKnowledgeModule } from '../src/modules/knowledge/index.js';

function fixture(sink) {
  const module = createKnowledgeModule({ annotationShadowSink: sink });
  const note = module.noteService.createNote({
    id: 'shadow-note',
    spaceId: 'space',
    title: '影子',
    rawMarkdown: '## A\n\n重要文字\n\n尾段'
  });
  const projection = projectMarkdown(note.rawMarkdown);
  const anchor = anchorFromProjectedRange(projection, 2, 6);
  const annotation = module.contentAnnotationService.createAnnotation({
    noteId: note.id,
    spaceId: note.spaceId,
    schemaVersion: 2,
    scopeType: 'selection',
    anchor,
    quoteText: anchor.quoteText,
    fromPosition: anchor.sourceStart,
    toPosition: anchor.sourceEnd,
    anchorFingerprint: 'fixture',
    noteContentHash: calculateContentHash(note.rawMarkdown),
    idempotencyKey: 'create'
  });
  return { module, note, annotation };
}
function editorState(markdown, annotations) {
  return {
    formatVersion: 2,
    targetContentHash: calculateContentHash(markdown),
    blocks: [
      { id: 'h', type: 'heading', empty: false },
      { id: 'p1', type: 'paragraph', empty: false },
      { id: 'p2', type: 'paragraph', empty: false }
    ],
    annotations
  };
}
function save(module, before, after, state) {
  return module.noteService.updateNote(before.id, {
    rawMarkdown: after,
    expectedUpdatedAt: before.updatedAt,
    annotationMapping: {
      formatVersion: 1,
      operationId: 'edit',
      baseContentHash: calculateContentHash(before.rawMarkdown),
      targetContentHash: calculateContentHash(after),
      edits: [sourceEdit(before.rawMarkdown, after)],
      ...(state === undefined ? {} : { editorState: state })
    }
  });
}

export const annotationIdentityShadowTests = [
  {
    name: '身份影子：保存后比较编辑器身份与旧链路结果并记录结论',
    run() {
      const entries = [];
      const { module, note, annotation } = fixture(entry => entries.push(entry));
      const after = note.rawMarkdown.replace('重要文字', '重要的文字');
      save(
        module,
        note,
        after,
        editorState(after, [
          {
            id: annotation.id,
            scopeType: 'selection',
            present: true,
            startBlockId: 'p1',
            endBlockId: 'p1',
            quoteHash: identityQuoteHash('重要的文字')
          }
        ])
      );
      assert.equal(entries.length, 1);
      assert.equal(entries[0].noteId, note.id);
      assert.equal(entries[0].status, 'compared');
      assert.equal(entries[0].compared, 1);
      assert.deepEqual(entries[0].divergences, []);
      assert.equal(JSON.stringify(entries[0]).includes('重要'), false);
    }
  },
  {
    name: '身份影子：身份丢失与块不一致都被记录，旧链路结果不受影响',
    run() {
      const entries = [];
      const { module, note, annotation } = fixture(entry => entries.push(entry));
      const after = note.rawMarkdown.replace('尾段', '尾段补充');
      save(
        module,
        note,
        after,
        editorState(after, [
          {
            id: annotation.id,
            scopeType: 'selection',
            present: true,
            startBlockId: 'p2',
            endBlockId: 'p2',
            quoteHash: identityQuoteHash('重要文字')
          }
        ])
      );
      assert.deepEqual(
        entries[0].divergences.map(item => item.kind),
        ['blockMismatch']
      );
      assert.equal(module.contentAnnotationService.getAnnotation(annotation.id).anchorStatus, 'resolved');
    }
  },
  {
    name: '身份影子：没有快照、快照不合法或日志写入失败时保存照常完成',
    run() {
      const entries = [];
      const { module, note } = fixture(entry => entries.push(entry));
      const first = save(module, note, note.rawMarkdown + '\n\n追加');
      assert.equal(entries.length, 0);
      const second = save(module, first, first.rawMarkdown + '一', { formatVersion: 9 });
      assert.equal(entries.at(-1).status, 'invalidState');
      const failing = fixture(() => {
        throw new Error('磁盘已满');
      });
      const after = failing.note.rawMarkdown + '二';
      const saved = save(failing.module, failing.note, after, editorState(after, []));
      assert.equal(saved.rawMarkdown, after);
      assert.ok(second.rawMarkdown.endsWith('一'));
    }
  },
  {
    name: '身份影子：保存所在事务回滚时不记录样本',
    run() {
      const entries = [];
      let queue = null;
      let failCommit = false;
      // 与本地存储一致：嵌套调用直接执行，只有最外层负责提交或回滚。
      const runTransaction = operation => {
        if (queue) return operation();
        queue = [];
        let callbacks = [];
        try {
          const result = operation();
          if (failCommit) throw new Error('提交失败');
          callbacks = queue;
          return result;
        } finally {
          queue = null;
          callbacks.forEach(callback => callback());
        }
      };
      const afterCommit = callback => (queue ? queue.push(callback) : callback());
      const module = createKnowledgeModule({
        annotationShadowSink: entry => entries.push(entry),
        runTransaction,
        afterCommit
      });
      const note = module.noteService.createNote({
        id: 'rollback-note',
        spaceId: 'space',
        title: '回滚',
        rawMarkdown: '甲'
      });
      failCommit = true;
      assert.throws(() => save(module, note, '甲乙', editorState('甲乙', [])), /提交失败/);
      assert.equal(entries.length, 0);
      failCommit = false;
      // 内存仓库不会真正回滚，第二次保存以当前记录为基线；真实存储的回滚由桌面 SQLite 测试覆盖。
      const current = module.noteService.getNote(note.id);
      const after = `${current.rawMarkdown}丙`;
      save(module, current, after, editorState(after, []));
      assert.equal(entries.length, 1);
    }
  },
  {
    name: '块身份表：对齐的编辑器快照写入 annotationStructure.identity，旧链路节点不变',
    run() {
      const { module, note } = fixture(() => {});
      const after = note.rawMarkdown.replace('尾段', '尾段补充');
      const saved = save(module, note, after, editorState(after, []));
      assert.deepEqual(saved.annotationStructure.identity.blocks, [
        { id: 'h', type: 'heading' },
        { id: 'p1', type: 'paragraph' },
        { id: 'p2', type: 'paragraph' }
      ]);
      assert.equal(saved.annotationStructure.identity.contentHash, calculateContentHash(after));
      assert.ok(saved.annotationStructure.nodes.every(node => node.id.startsWith('block-')));
    }
  },
  {
    name: '块身份表：正文不变时沿用，外部改写或快照无法对齐时失效',
    run() {
      const { module, note } = fixture(() => {});
      const after = note.rawMarkdown + '\n\n追加';
      const first = save(module, note, after, {
        ...editorState(after, []),
        blocks: [...editorState(after, []).blocks, { id: 'p3', type: 'paragraph', empty: false }]
      });
      assert.deepEqual(
        first.annotationStructure.identity.blocks.map(block => block.id),
        ['h', 'p1', 'p2', 'p3']
      );
      const same = module.noteService.updateNote(note.id, { rawMarkdown: after, expectedUpdatedAt: first.updatedAt });
      assert.deepEqual(same.annotationStructure.identity, first.annotationStructure.identity);
      const external = module.noteService.updateNote(note.id, {
        rawMarkdown: `${after}改`,
        expectedUpdatedAt: same.updatedAt
      });
      assert.equal(external.annotationStructure.identity, undefined);
      const misaligned = save(
        module,
        external,
        `${external.rawMarkdown}再改`,
        editorState(`${external.rawMarkdown}再改`, [])
      );
      assert.equal(misaligned.annotationStructure.identity, undefined);
    }
  },
  {
    name: '块身份表：JSON 存储重启后保留并通过本地数据校验',
    async run() {
      const { createFileDataStore } = await import('../src/infrastructure/file-data-store.js');
      const { createAppContext } = await import('../src/app.factory.js');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-identity-'));
      try {
        const open = () =>
          createAppContext({
            dataStore: createFileDataStore(path.join(dir, 'data.json')),
            storageRootDir: dir,
            uploadsDir: path.join(dir, 'uploads'),
            ownerId: 'demo',
            annotationShadowSink: () => {}
          });
        const context = open();
        const knowledge = context.modules.knowledge;
        const space = knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
        const note = knowledge.noteService.createNote({
          title: '身份',
          rawMarkdown: '## A\n\n重要文字\n\n尾段',
          spaceId: space.id
        });
        const after = note.rawMarkdown + '补充';
        save(knowledge, note, after, editorState(after, []));
        const reopened = open().modules.knowledge.noteService.getNote(note.id);
        assert.deepEqual(
          reopened.annotationStructure.identity.blocks.map(block => block.id),
          ['h', 'p1', 'p2']
        );
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  },
  {
    name: '块身份表：同步批次保留合法表，丢弃与正文不对应的表而不拒绝批次',
    async run() {
      const { createEmptyLocalState } = await import('../src/infrastructure/local-data-schema.js');
      const { prepareBatchState } = await import('../src/modules/sync/batch-domain.ts');
      const before = createEmptyLocalState();
      before.spaces.push({
        id: 'space-sync',
        userId: 'demo',
        name: '空间',
        createdAt: '2026-10-12T00:00:00.000Z',
        updatedAt: '2026-10-12T00:00:00.000Z'
      });
      const markdown = '## A\n\n重要文字\n\n尾段';
      const identity = {
        formatVersion: 2,
        contentHash: calculateContentHash(markdown),
        blocks: [
          { id: 'h', type: 'heading' },
          { id: 'p1', type: 'paragraph' },
          { id: 'p2', type: 'paragraph' }
        ]
      };
      const note = (id, table) => ({
        collection: 'notes',
        id,
        value: {
          id,
          title: id,
          rawMarkdown: markdown,
          spaceId: 'space-sync',
          folderId: null,
          tagIds: [],
          annotationStructure: { ...updateStructure('', markdown), identity: table }
        }
      });
      const { createHash } = await import('node:crypto');
      for (const id of ['kept', 'dropped', 'empty-id']) {
        before.noteVersions.push({
          id: `version-${id}`,
          noteId: id,
          content: markdown,
          contentHash: createHash('sha256').update(markdown).digest('hex'),
          createdAt: '2026-10-12T00:00:00.000Z',
          createdBy: 'demo'
        });
      }
      const emptyId = {
        ...identity,
        blocks: identity.blocks.map((block, index) => (index === 0 ? { ...block, id: '' } : block))
      };
      const { state } = prepareBatchState(
        before,
        [
          note('kept', identity),
          note('dropped', { ...identity, blocks: identity.blocks.slice(1) }),
          note('empty-id', emptyId)
        ],
        'demo'
      );
      assert.deepEqual(state.notes.find(item => item.id === 'kept').annotationStructure.identity, identity);
      assert.equal(state.notes.find(item => item.id === 'dropped').annotationStructure.identity, undefined);
      const fallback = state.notes.find(item => item.id === 'empty-id');
      assert.equal(fallback.annotationStructure.identity, undefined);
      assert.equal(fallback.rawMarkdown, markdown);
      assert.deepEqual(fallback.annotationStructure.nodes, updateStructure('', markdown).nodes);
    }
  }
];

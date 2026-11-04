import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  anchorForSection,
  anchorFromProjectedRange,
  bindingSourceRange,
  calculateContentHash,
  identityFromEditorState,
  parseIdentityBlocks,
  projectMarkdown,
  sourceEdit
} from '@study-accelerator/content-anchor';
import { prepareBatchState } from '../src/modules/sync/batch-domain.ts';
import { applyPostgresState } from '../src/modules/sync/postgres-batch.ts';
import { createEmptyLocalState } from '../src/infrastructure/local-data-schema.js';
import { nextIdentityBindings } from '../src/modules/knowledge/application/annotation-identity-binding.js';
import { createAppContext } from '../src/app.factory.js';
import { createFileDataStore } from '../src/infrastructure/file-data-store.js';
import { createKnowledgeModule } from '../src/modules/knowledge/index.js';

const markdown = '## A\n\n前文重要文字后文\n\n尾段';
const blockIds = md => parseIdentityBlocks(md).map((block, index) => `${block.type}-${index}`);
const editorState = (md, annotations = []) => ({
  formatVersion: 2,
  targetContentHash: calculateContentHash(md),
  blocks: parseIdentityBlocks(md).map((block, index) => ({ id: blockIds(md)[index], type: block.type, empty: false })),
  annotations
});
const mapping = (before, after, state) => ({
  formatVersion: 1,
  operationId: randomUUID(),
  baseContentHash: calculateContentHash(before),
  targetContentHash: calculateContentHash(after),
  edits: [sourceEdit(before, after)],
  ...(state ? { editorState: state } : {})
});
const createSelection = (service, note, text) => {
  const projection = projectMarkdown(note.rawMarkdown);
  const start = projection.text.indexOf(text);
  const anchor = anchorFromProjectedRange(projection, start, start + text.length);
  return service.createAnnotation({
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
    idempotencyKey: randomUUID()
  });
};

/** 建立带身份表的笔记：首次保存附带编辑器快照。 */
function noteWithIdentity(module, spaceId = 'space') {
  const created = module.noteService.createNote({
    id: `binding-${randomUUID()}`,
    spaceId,
    title: '绑定',
    rawMarkdown: markdown
  });
  const after = `${markdown}。`;
  return module.noteService.updateNote(created.id, {
    rawMarkdown: after,
    expectedUpdatedAt: created.updatedAt,
    annotationMapping: mapping(markdown, after, editorState(after))
  });
}

export const annotationIdentityBindingTests = [
  ...[
    {
      markdown: 'abc\n\n<div>html</div>',
      blocks: [
        { id: 'p', type: 'paragraph', empty: false },
        { id: 'html', type: 'paragraph', empty: false }
      ],
      name: '块级 HTML 与编辑器段落对齐'
    },
    {
      markdown: 'abc',
      blocks: [
        { id: 'p', type: 'paragraph', empty: false },
        { id: 'extra', type: 'paragraph', empty: true }
      ],
      name: '编辑器额外尾部空段落'
    }
  ].map(({ markdown: md, blocks, name }) => ({
    name: `重点绑定：${name}的合法上报优先于旧锚点，错 ID 仍拒绝`,
    run() {
      const state = {
        formatVersion: 2,
        targetContentHash: calculateContentHash(md),
        blocks,
        annotations: [
          {
            id: 'selection',
            scopeType: 'selection',
            present: true,
            start: { blockId: 'p', offset: 1 },
            end: { blockId: 'p', offset: 2 }
          }
        ]
      };
      const identity = identityFromEditorState(md, state);
      assert.ok(identity, '与正文对齐的编辑器快照可以生成身份表');
      const note = { rawMarkdown: md, annotationStructure: { identity } };
      const anchor = anchorFromProjectedRange(projectMarkdown(md), 0, 1);
      const annotation = { id: 'selection', scopeType: 'selection', anchorStatus: 'resolved', anchor };
      const [change] = nextIdentityBindings(note, [annotation], state);
      assert.deepEqual(bindingSourceRange(md, identity, change.identityBinding), { sourceStart: 1, sourceEnd: 2 });
      const wrongIds = { ...state, blocks: blocks.map(block => ({ ...block, id: `wrong-${block.id}` })) };
      const [fallback] = nextIdentityBindings(note, [annotation], wrongIds);
      assert.deepEqual(bindingSourceRange(md, identity, fallback.identityBinding), { sourceStart: 0, sourceEnd: 1 });
    }
  })),
  {
    name: '重点绑定：过期编辑器快照不可覆盖同正文保留的身份表，刷新不跨正文复用',
    run() {
      const module = createKnowledgeModule();
      const note = noteWithIdentity(module);
      const annotation = createSelection(module.contentAnnotationService, note, '重要文字');
      const state = editorState(note.rawMarkdown, [
        {
          id: annotation.id,
          scopeType: 'selection',
          present: true,
          start: { blockId: blockIds(note.rawMarkdown)[1], offset: 0 },
          end: { blockId: blockIds(note.rawMarkdown)[1], offset: 2 }
        }
      ]);
      state.targetContentHash = calculateContentHash('过期正文');
      assert.deepEqual(nextIdentityBindings(note, [annotation], state), []);
      const otherModule = createKnowledgeModule();
      const other = noteWithIdentity(otherModule);
      const otherAnnotation = createSelection(otherModule.contentAnnotationService, other, '前文');
      assert.equal(nextIdentityBindings(other, [otherAnnotation])[0], undefined);
      assert.deepEqual(
        annotation.identityBinding,
        module.contentAnnotationService.getAnnotation(annotation.id).identityBinding
      );
    }
  },
  {
    name: '重点绑定：JSON 同正文换 ID 后重启保持绑定，回读不改变旧字段',
    run() {
      const root = mkdtempSync(path.join(tmpdir(), 'knowra-binding-json-'));
      try {
        const file = path.join(root, 'data.json');
        const dataStore = createFileDataStore(file);
        const module = createAppContext({ dataStore, storageRootDir: root }).modules.knowledge;
        const space = module.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
        const note = noteWithIdentity(module, space.id);
        const annotation = createSelection(module.contentAnnotationService, note, '重要文字');
        const state = editorState(note.rawMarkdown);
        state.blocks = state.blocks.map(block => ({ ...block, id: `json-${block.id}` }));
        const saved = module.noteService.updateNote(note.id, {
          rawMarkdown: note.rawMarkdown,
          expectedUpdatedAt: note.updatedAt,
          annotationMapping: { ...mapping(note.rawMarkdown, note.rawMarkdown, state), edits: [] }
        });
        const reopened = createAppContext({ dataStore: createFileDataStore(file), storageRootDir: root }).modules
          .knowledge;
        const restored = reopened.contentAnnotationService.getAnnotation(annotation.id);
        assert.equal(restored.identityBinding.start.blockId, saved.annotationStructure.identity.blocks[1].id);
        assert.equal(restored.revision, annotation.revision);
        assert.deepEqual(restored.originSnapshot, annotation.originSnapshot);
        const beforeSync = dataStore.exportSnapshot().data;
        const syncNote = {
          ...saved,
          annotationStructure: {
            ...saved.annotationStructure,
            identity: {
              ...saved.annotationStructure.identity,
              blocks: saved.annotationStructure.identity.blocks.map(block => ({ ...block, id: `sync-${block.id}` }))
            }
          }
        };
        const { state: synced } = prepareBatchState(
          beforeSync,
          [{ collection: 'notes', id: saved.id, value: syncNote }],
          'demo'
        );
        const syncAnnotation = synced.contentAnnotations.find(item => item.id === annotation.id);
        assert.equal(syncAnnotation.identityBinding.start.blockId, syncNote.annotationStructure.identity.blocks[1].id);
        const { identityBinding: _storedBinding, ...oldFields } = restored;
        const { identityBinding: _syncBinding, ...syncFields } = syncAnnotation;
        assert.deepEqual(syncFields, oldFields);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  },
  {
    name: '重点绑定：同正文换身份 ID 同事务刷新，旧链路状态和修订不变',
    run() {
      const module = createKnowledgeModule();
      const note = noteWithIdentity(module);
      const annotation = createSelection(module.contentAnnotationService, note, '重要文字');
      const state = editorState(note.rawMarkdown);
      state.blocks = state.blocks.map(block => ({ ...block, id: `new-${block.id}` }));
      const saved = module.noteService.updateNote(note.id, {
        rawMarkdown: note.rawMarkdown,
        expectedUpdatedAt: note.updatedAt,
        annotationMapping: { ...mapping(note.rawMarkdown, note.rawMarkdown, state), edits: [] }
      });
      const updated = module.contentAnnotationService.getAnnotation(annotation.id);
      assert.equal(updated.identityBinding.start.blockId, saved.annotationStructure.identity.blocks[1].id);
      const { identityBinding: _oldBinding, ...oldFields } = annotation;
      const { identityBinding: _newBinding, ...newFields } = updated;
      assert.deepEqual(newFields, oldFields);
    }
  },
  {
    name: '重点绑定：笔记已有身份表时，新建重点即推出绑定且换算回原范围',
    run() {
      const module = createKnowledgeModule();
      const note = noteWithIdentity(module);
      const annotation = createSelection(module.contentAnnotationService, note, '重要文字');
      assert.equal(annotation.identityBinding.scopeType, 'selection');
      assert.equal(annotation.identityBinding.start.blockId, blockIds(note.rawMarkdown)[1]);
      assert.deepEqual(
        bindingSourceRange(note.rawMarkdown, note.annotationStructure.identity, annotation.identityBinding),
        { sourceStart: annotation.anchor.sourceStart, sourceEnd: annotation.anchor.sourceEnd }
      );
    }
  },
  {
    name: '重点绑定：保存时采用编辑器上报的位置，旧链路状态与摘录不受影响',
    run() {
      const module = createKnowledgeModule();
      const note = noteWithIdentity(module);
      const annotation = createSelection(module.contentAnnotationService, note, '重要文字');
      const after = note.rawMarkdown.replace('前文', '前文新增');
      const id = blockIds(after)[1];
      module.noteService.updateNote(note.id, {
        rawMarkdown: after,
        expectedUpdatedAt: note.updatedAt,
        annotationMapping: mapping(
          note.rawMarkdown,
          after,
          editorState(after, [
            {
              id: annotation.id,
              scopeType: 'selection',
              present: true,
              start: { blockId: id, offset: 4 },
              end: { blockId: id, offset: 8 }
            }
          ])
        )
      });
      const updated = module.contentAnnotationService.getAnnotation(annotation.id);
      assert.deepEqual([updated.identityBinding.start.offset, updated.identityBinding.end.offset], [4, 8]);
      assert.equal(updated.identityBinding.contentHash, calculateContentHash(after));
      assert.equal(updated.anchorStatus, 'resolved');
      assert.equal(updated.quoteText, '重要文字');
    }
  },
  {
    name: '重点绑定：没有编辑器上报时由已定位锚点推出；外部改写使身份表失效时保持原绑定',
    run() {
      const module = createKnowledgeModule();
      const note = noteWithIdentity(module);
      const annotation = createSelection(module.contentAnnotationService, note, '重要文字');
      const original = annotation.identityBinding;
      const same = module.noteService.updateNote(note.id, {
        rawMarkdown: note.rawMarkdown,
        expectedUpdatedAt: note.updatedAt
      });
      assert.deepEqual(module.contentAnnotationService.getAnnotation(annotation.id).identityBinding, original);
      const external = `${same.rawMarkdown}\n\n外部追加`;
      const saved = module.noteService.updateNote(note.id, {
        rawMarkdown: external,
        expectedUpdatedAt: same.updatedAt
      });
      assert.equal(saved.annotationStructure.identity, undefined);
      assert.deepEqual(module.contentAnnotationService.getAnnotation(annotation.id).identityBinding, original);
    }
  },
  {
    name: '重点绑定：原文被删除、编辑器也报告不存在时清空绑定',
    run() {
      const module = createKnowledgeModule();
      const note = noteWithIdentity(module);
      const annotation = createSelection(module.contentAnnotationService, note, '重要文字');
      const after = '## A\n\n尾段。';
      module.noteService.updateNote(note.id, {
        rawMarkdown: after,
        expectedUpdatedAt: note.updatedAt,
        annotationMapping: mapping(
          note.rawMarkdown,
          after,
          editorState(after, [{ id: annotation.id, scopeType: 'selection', present: false }])
        )
      });
      const updated = module.contentAnnotationService.getAnnotation(annotation.id);
      assert.equal(updated.anchorStatus, 'missing');
      assert.equal(updated.identityBinding, null);
    }
  }
];

export const annotationIdentityBindingPostgresTests = process.env.KNOWRA_SYNC_TEST_DATABASE_URL
  ? [
      {
        name: '真实 PostgreSQL：块身份表与重点绑定随保存写入并可读回',
        async run() {
          const { createPostgresTestDatabase } =
            await import('../../../scripts/test-support/postgres-test-database.mjs');
          const { createPostgresAppContext } = await import('../src/postgres-app.factory.js');
          const root = mkdtempSync(path.join(tmpdir(), 'knowra-binding-pg-'));
          let database, app;
          try {
            database = await createPostgresTestDatabase();
            app = await createPostgresAppContext({ databaseUrl: database.databaseUrl, storageRootDir: root });
            const k = app.modules.knowledge;
            const space = await k.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
            const created = await k.noteService.createNote({
              id: randomUUID(),
              spaceId: space.id,
              title: randomUUID(),
              rawMarkdown: markdown
            });
            const after = `${markdown}。`;
            const note = await k.noteService.updateNote(created.id, {
              rawMarkdown: after,
              expectedUpdatedAt: created.updatedAt,
              annotationMapping: mapping(markdown, after, editorState(after))
            });
            assert.deepEqual(
              note.annotationStructure.identity.blocks.map(block => block.id),
              blockIds(after)
            );
            const projection = projectMarkdown(after);
            const section = anchorForSection(projection, 0);
            const annotation = await k.contentAnnotationService.createAnnotation({
              spaceId: space.id,
              noteId: note.id,
              schemaVersion: 2,
              scopeType: 'section',
              anchor: section,
              quoteText: section.quoteText,
              fromPosition: section.sourceStart,
              toPosition: section.sourceEnd,
              anchorFingerprint: 'fixture',
              noteContentHash: calculateContentHash(after),
              idempotencyKey: randomUUID()
            });
            assert.equal(annotation.identityBinding.rootBlockId, blockIds(after)[0]);
            const next = after.replace('尾段', '尾段补充');
            await k.noteService.updateNote(note.id, {
              rawMarkdown: next,
              expectedUpdatedAt: note.updatedAt,
              annotationMapping: mapping(
                after,
                next,
                editorState(next, [
                  { id: annotation.id, scopeType: 'section', present: true, rootBlockId: blockIds(next)[0] }
                ])
              )
            });
            const reloaded = await k.contentAnnotationService.getAnnotation(annotation.id);
            assert.equal(reloaded.identityBinding.rootBlockId, blockIds(next)[0]);
            assert.equal(reloaded.identityBinding.contentHash, calculateContentHash(next));
            // 同步清空及旧客户端省略字段都必须实际写入 SQL NULL，而不是忽略更新。
            for (const value of [null, undefined]) {
              const before = { ...createEmptyLocalState(), contentAnnotations: [reloaded] };
              const after = {
                ...createEmptyLocalState(),
                contentAnnotations: [{ ...reloaded, identityBinding: value }]
              };
              await app.prisma.$transaction(tx => applyPostgresState(tx, before, after));
              assert.equal((await k.contentAnnotationService.getAnnotation(annotation.id)).identityBinding, null);
              await app.repositories.contentAnnotationRepository.save(reloaded);
            }
            const sameState = editorState(next);
            sameState.blocks = sameState.blocks.map(block => ({ ...block, id: `new-${block.id}` }));
            const currentNote = await k.noteService.getNote(note.id);
            const sameSaved = await k.noteService.updateNote(note.id, {
              rawMarkdown: next,
              expectedUpdatedAt: currentNote.updatedAt,
              annotationMapping: { ...mapping(next, next, sameState), edits: [] }
            });
            const sameAnnotation = await k.contentAnnotationService.getAnnotation(annotation.id);
            assert.equal(
              sameAnnotation.identityBinding.rootBlockId,
              sameSaved.annotationStructure.identity.blocks[0].id
            );
            const { identityBinding: _beforeBinding, ...oldFields } = reloaded;
            const { identityBinding: _afterBinding, ...newFields } = sameAnnotation;
            assert.deepEqual(newFields, oldFields);
            const nullable = await app.prisma
              .$queryRaw`SELECT is_nullable, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ContentAnnotation' AND column_name = 'identityBinding'`;
            assert.deepEqual(nullable, [{ is_nullable: 'YES', data_type: 'jsonb' }]);
            // 绑定刷新失败必须与同正文身份表更新一起回滚。
            await app.prisma.$executeRawUnsafe(
              `CREATE FUNCTION fail_identity_binding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected binding failure'; END $$`
            );
            await app.prisma.$executeRawUnsafe(
              `CREATE TRIGGER identity_binding_failure BEFORE UPDATE OF "identityBinding" ON "ContentAnnotation" FOR EACH ROW EXECUTE FUNCTION fail_identity_binding()`
            );
            try {
              const failedState = {
                ...sameState,
                blocks: sameState.blocks.map(block => ({ ...block, id: `failed-${block.id}` }))
              };
              await assert.rejects(
                k.noteService.updateNote(note.id, {
                  rawMarkdown: next,
                  expectedUpdatedAt: sameSaved.updatedAt,
                  annotationMapping: { ...mapping(next, next, failedState), edits: [] }
                })
              );
              assert.deepEqual(
                (await k.noteService.getNote(note.id)).annotationStructure.identity,
                sameSaved.annotationStructure.identity
              );
              assert.deepEqual(await k.contentAnnotationService.getAnnotation(annotation.id), sameAnnotation);
            } finally {
              await app.prisma.$executeRawUnsafe('DROP TRIGGER identity_binding_failure ON "ContentAnnotation"');
              await app.prisma.$executeRawUnsafe('DROP FUNCTION fail_identity_binding()');
            }
          } finally {
            try {
              await app?.close();
            } finally {
              try {
                await database?.close();
              } finally {
                rmSync(root, { recursive: true, force: true });
              }
            }
          }
        }
      }
    ]
  : [];

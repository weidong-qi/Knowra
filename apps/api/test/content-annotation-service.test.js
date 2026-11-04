import assert from 'node:assert/strict';
import { AppError } from '../src/errors/app-error.js';
import { createContentAnnotationService } from '../src/modules/knowledge/application/content-annotation-service.js';
import { createInMemoryContentAnnotationRepository } from '../src/modules/knowledge/infrastructure/content-annotation-repository.js';
import { ContentAnnotation } from '../src/modules/knowledge/domain/content-annotation.js';
import { createKnowledgeModule } from '../src/modules/knowledge/index.js';
import { createAsyncContentAnnotationService } from '../src/modules/knowledge/application/postgres-async/content-annotation-service.js';
import { resolveLegacyAnnotationAnchor } from '../src/modules/knowledge/application/legacy-annotation-anchor.ts';
import {
  anchorForListItem,
  anchorForSection,
  anchorForSourceRange,
  projectMarkdown
} from '@study-accelerator/content-anchor';

// 重点内联化 I4b：重点只能写在正文标记里。库里残留的旧格式行（v1）仍可取消、归档和改备注。
const legacyRow = (overrides = {}) =>
  new ContentAnnotation({
    id: 'annotation-legacy',
    spaceId: 'space-1',
    noteId: 'note-1',
    quoteText: 'important',
    fromPosition: 6,
    toPosition: 15,
    anchorFingerprint: 'fingerprint',
    noteContentHash: 'hash',
    idempotencyKey: 'legacy-key',
    schemaVersion: 1,
    ...overrides
  });

function serviceWith(rows = [legacyRow()], options = {}) {
  const repository = createInMemoryContentAnnotationRepository();
  for (const row of rows) repository.save(row);
  return { repository, service: createContentAnnotationService({ repository, ...options }) };
}

const legacyRemoved = error => {
  assert.ok(error instanceof AppError);
  assert.equal(error.code, 'ANNOTATION_LEGACY_REMOVED');
  assert.equal(error.statusCode, 410);
  return true;
};

export const contentAnnotationServiceTests = [
  {
    name: '只改变正文标记时，旧重点协调不读取历史版本',
    async run() {
      const before = '原文 其他';
      const anchor = anchorForSourceRange(projectMarkdown(before), 0, 2);
      const { repository } = serviceWith([
        legacyRow({
          schemaVersion: 2,
          anchor,
          noteVersionId: 'old-version',
          quoteText: '原文',
          originSnapshot: { noteVersionId: 'old-version', quoteText: '原文', segments: anchor.segments }
        })
      ]);
      const options = {
        repository,
        noteRepository: { findById: () => ({ rawMarkdown: '原文 <mark data-k="m">其他</mark>' }) },
        noteVersionRepository: {
          findById: () => {
            throw new Error('标记调整不应读取历史版本');
          }
        }
      };
      const expected = { annotations: [], contentChangedAnnotationIds: [] };
      assert.deepEqual(
        createContentAnnotationService(options).reconcileForNote('note-1', 'hash', { before }),
        expected
      );
      assert.deepEqual(
        await createAsyncContentAnnotationService(options).reconcileForNote('note-1', 'hash', { before }),
        expected
      );
    }
  },
  {
    name: '旧锚点来源版本不匹配时，即使当前正文碰巧相同也不猜测原位置',
    run() {
      const anchor = anchorForSourceRange(projectMarkdown('旧重点'), 0, '旧重点'.length);
      assert.equal(resolveLegacyAnnotationAnchor('旧重点', anchor, '其他内容').status, 'needsReview');
    }
  },
  {
    name: '旧来源版本含行尾块级标记时，章节、列表和跨段选区的旧锚点仍可解析',
    run() {
      const cases = [
        ['# 标题 <!--k already s=section-->\n\n正文\n', m => anchorForSection(projectMarkdown(m), 0)],
        [
          '- 条目 <!--k already s=list-->\n- 其他\n',
          m => {
            const projection = projectMarkdown(m);
            return anchorForListItem(projection, projection.listItems[0].path, false);
          }
        ],
        [
          '甲段 <!--k already s=block-->\n\n乙段\n',
          m => anchorForSourceRange(projectMarkdown(m), 0, m.indexOf('乙') + 1, { scopeType: 'selection' })
        ]
      ];
      for (const [source, build] of cases) {
        const anchor = build(source);
        assert.equal(resolveLegacyAnnotationAnchor(`${source}\n追加`, anchor, source).status, 'resolved');
        assert.equal(
          resolveLegacyAnnotationAnchor(
            source.replace('甲', '丙').replace('条目', '改动').replace('标题', '改题'),
            anchor,
            source.replace('甲', '丙').replace('条目', '改动').replace('标题', '改题')
          ).status,
          'needsReview'
        );
      }
    }
  },
  {
    name: '旧重点之前新增正文标记与后续无关编辑不改变来源预览、分析范围和证据',
    run() {
      const module = createKnowledgeModule();
      const original = '前言\n\n旧重点\n\n结尾';
      let note = module.noteService.createNote({
        id: 'legacy-marked',
        spaceId: 'space-old',
        title: '旧重点',
        rawMarkdown: original
      });
      const version = module.noteVersionService.listVersions({ noteId: note.id })[0];
      const start = original.indexOf('旧重点');
      const anchor = anchorForSourceRange(projectMarkdown(original), start, start + '旧重点'.length);
      const row = legacyRow({
        id: 'legacy-after-mark',
        spaceId: note.spaceId,
        noteId: note.id,
        quoteText: '旧重点',
        fromPosition: anchor.sourceStart,
        toPosition: anchor.sourceEnd,
        schemaVersion: 2,
        anchor,
        noteContentHash: version.contentHash,
        noteVersionId: version.id,
        originSnapshot: {
          noteVersionId: version.id,
          contentHash: version.contentHash,
          quoteText: '旧重点',
          segments: anchor.segments
        }
      });
      module.repositories.contentAnnotationRepository.save(row);
      const { item, evidence } = module.knowledgeItemService.createCandidate({
        spaceId: note.spaceId,
        title: '旧重点来源',
        canonicalStatement: '来源知识',
        knowledgeType: 'concept',
        sourceMode: 'annotation',
        evidence: [{ sourceType: 'annotation', annotationId: row.id }]
      });
      module.knowledgeItemService.confirmItem(item.id);
      note = module.noteService.updateNote(note.id, {
        rawMarkdown: '<mark data-k="new">前言</mark>\n\n旧<mark data-k="inside">重点</mark>\n\n结尾'
      });
      assert.equal(module.annotationScopeService.previewAnnotation(row.id).resolution.status, 'resolved');
      note = module.noteService.updateNote(note.id, { rawMarkdown: `${note.rawMarkdown}修改` });
      assert.equal(module.annotationScopeService.previewAnnotation(row.id).resolution.status, 'resolved');
      const scope = module.annotationScopeService.previewAnalysisScope({
        spaceId: note.spaceId,
        mode: 'marked',
        annotationIds: [row.id]
      });
      assert.equal(scope.segments.map(segment => segment.markdown).join(''), '旧重点');
      assert.equal(module.repositories.knowledgeEvidenceRepository.findById(evidence[0].id).status, 'valid');
      assert.equal(module.repositories.knowledgeItemRepository.findById(item.id).reviewStatus, 'confirmed');
      module.noteService.updateNote(note.id, { rawMarkdown: note.rawMarkdown.replace('旧<mark', '新<mark') });
      assert.equal(module.repositories.knowledgeEvidenceRepository.findById(evidence[0].id).status, 'stale');
      assert.equal(module.repositories.knowledgeItemRepository.findById(item.id).reviewStatus, 'needsRevision');
    }
  },
  {
    name: '旧选区的来源版本本身含标记时，去标记后的真实范围仍可验证',
    run() {
      const module = createKnowledgeModule();
      const original = '前<mark data-k="existing">旧</mark>重点后\n\n结尾';
      let note = module.noteService.createNote({
        id: 'legacy-existing-mark',
        spaceId: 'space-old',
        title: '旧重点',
        rawMarkdown: original
      });
      const version = module.noteVersionService.listVersions({ noteId: note.id })[0];
      const anchor = anchorForSourceRange(projectMarkdown(original), original.indexOf('旧'), original.indexOf('后'));
      const row = legacyRow({
        id: 'old-with-mark',
        idempotencyKey: 'old-with-mark',
        spaceId: note.spaceId,
        noteId: note.id,
        quoteText: anchor.quoteText,
        fromPosition: anchor.sourceStart,
        toPosition: anchor.sourceEnd,
        schemaVersion: 2,
        anchor,
        noteContentHash: version.contentHash,
        noteVersionId: version.id,
        originSnapshot: {
          noteVersionId: version.id,
          contentHash: version.contentHash,
          quoteText: anchor.quoteText,
          segments: anchor.segments
        }
      });
      module.repositories.contentAnnotationRepository.save(row);
      const marked = original.replace('前', '<mark data-k="lead">前</mark>');
      note = module.noteService.updateNote(note.id, { rawMarkdown: marked });
      note = module.noteService.updateNote(note.id, { rawMarkdown: `${note.rawMarkdown}！` });
      assert.equal(module.annotationScopeService.previewAnnotation(row.id).resolution.status, 'resolved');
      const scope = module.annotationScopeService.previewAnalysisScope({
        spaceId: note.spaceId,
        mode: 'marked',
        annotationIds: [row.id]
      });
      assert.equal(scope.segments.map(segment => segment.markdown).join(''), '旧重点');
    }
  },
  {
    name: '旧章节与列表范围在标记偏移变化后仍按原始版本精确读取，排除部分不泄漏',
    run() {
      const module = createKnowledgeModule();
      const cases = [
        {
          name: 'section',
          before: '前言\n\n# 标题\n\n保留<mark data-k="existing">内容</mark>\n\n秘密内容\n\n# 下一节\n\n结尾',
          anchor: projection => anchorForSection(projection, 0),
          excluded: '秘密内容'
        },
        {
          name: 'list',
          before: '前言\n\n- 保留<mark data-k="existing">内容</mark>\n  - 子项\n\n结尾',
          anchor: projection => anchorForListItem(projection, projection.listItems[0].path)
        }
      ];
      for (const entry of cases) {
        let note = module.noteService.createNote({
          id: `legacy-${entry.name}`,
          spaceId: 'space-old',
          title: entry.name,
          rawMarkdown: entry.before
        });
        const version = module.noteVersionService.listVersions({ noteId: note.id })[0];
        const anchor = entry.anchor(projectMarkdown(entry.before));
        const row = legacyRow({
          id: `old-${entry.name}`,
          idempotencyKey: `old-${entry.name}`,
          spaceId: note.spaceId,
          noteId: note.id,
          quoteText: anchor.quoteText,
          fromPosition: anchor.sourceStart,
          toPosition: anchor.sourceEnd,
          schemaVersion: 2,
          scopeType: entry.name,
          anchor,
          noteContentHash: version.contentHash,
          noteVersionId: version.id,
          originSnapshot: {
            noteVersionId: version.id,
            contentHash: version.contentHash,
            quoteText: anchor.quoteText,
            segments: anchor.segments
          }
        });
        module.repositories.contentAnnotationRepository.save(row);
        if (entry.excluded) {
          const start = entry.before.indexOf(entry.excluded);
          module.repositories.annotationExclusionRepository.save({
            id: 'old-exclusion',
            parentAnnotationId: row.id,
            noteVersionId: version.id,
            status: 'active',
            anchor: anchorForSourceRange(projectMarkdown(entry.before), start, start + entry.excluded.length)
          });
        }
        let marked = entry.before.replace('前言', '<mark data-k="lead">前言</mark>');
        if (entry.excluded) marked = marked.replace('秘密内容', '秘密<mark data-k="inside">内容</mark>');
        note = module.noteService.updateNote(note.id, { rawMarkdown: marked });
        note = module.noteService.updateNote(note.id, { rawMarkdown: `${note.rawMarkdown}！` });
        assert.equal(module.annotationScopeService.previewAnnotation(row.id).resolution.status, 'resolved');
        const scope = module.annotationScopeService.previewAnalysisScope({
          spaceId: note.spaceId,
          mode: 'marked',
          annotationIds: [row.id]
        });
        const text = scope.segments.map(segment => segment.markdown).join('');
        assert.match(text, /保留内容/);
        assert.doesNotMatch(text, /秘密|<mark/);
        if (entry.excluded) {
          const outside = entry.before.lastIndexOf('结尾');
          const exclusion = module.repositories.annotationExclusionRepository.findById('old-exclusion');
          module.repositories.annotationExclusionRepository.save({
            ...exclusion,
            anchor: anchorForSourceRange(projectMarkdown(entry.before), outside, outside + '结尾'.length)
          });
          assert.throws(
            () =>
              module.annotationScopeService.previewAnalysisScope({
                spaceId: note.spaceId,
                mode: 'marked',
                annotationIds: [row.id]
              }),
            { code: 'ANNOTATION_EXCLUSION_CONFLICT' }
          );
        }
        if (entry.name === 'list') {
          module.noteService.updateNote(note.id, { rawMarkdown: note.rawMarkdown.replace('- 保留', '1. 保留') });
          assert.equal(module.annotationScopeService.previewAnnotation(row.id).resolution.status, 'needsReview');
        }
      }
    }
  },
  {
    name: '残留旧重点：只改标记保留证据，原文改写和清空分别降级',
    run() {
      const module = createKnowledgeModule();
      let note = module.noteService.createNote({
        id: 'legacy-note',
        spaceId: 'space-old',
        title: '旧重点',
        rawMarkdown: '原文 其他'
      });
      const version = module.noteVersionService.listVersions({ noteId: note.id })[0];
      const anchor = anchorForSourceRange(projectMarkdown(note.rawMarkdown), 0, 2);
      const row = legacyRow({
        id: 'old-row',
        spaceId: note.spaceId,
        noteId: note.id,
        quoteText: '原文',
        fromPosition: 0,
        toPosition: 2,
        schemaVersion: 2,
        anchor,
        noteContentHash: version.contentHash,
        noteVersionId: version.id,
        originSnapshot: {
          noteVersionId: version.id,
          contentHash: version.contentHash,
          quoteText: '原文',
          segments: anchor.segments
        }
      });
      module.repositories.contentAnnotationRepository.save({ ...row, revision: '1' });
      const { item, evidence } = module.knowledgeItemService.createCandidate({
        spaceId: note.spaceId,
        title: '旧重点来源',
        canonicalStatement: '来源知识',
        knowledgeType: 'concept',
        sourceMode: 'annotation',
        evidence: [{ sourceType: 'annotation', annotationId: row.id }]
      });
      module.knowledgeItemService.confirmItem(item.id);
      const status = () => module.repositories.knowledgeEvidenceRepository.findById(evidence[0].id).status;
      const update = rawMarkdown => {
        note = module.noteService.updateNote(note.id, { rawMarkdown, expectedUpdatedAt: note.updatedAt });
      };
      update('原文 <mark data-k="m">其他</mark>');
      assert.equal(status(), 'valid');
      update('改写 其他');
      assert.equal(status(), 'stale');
      assert.equal(module.repositories.contentAnnotationRepository.findById(row.id).anchorStatus, 'needsReview');
      assert.equal(module.repositories.contentAnnotationRepository.findById(row.id).revision, 2);
      assert.equal(module.repositories.knowledgeItemRepository.findById(item.id).reviewStatus, 'needsRevision');
      update('');
      assert.equal(status(), 'insufficient');
      assert.equal(module.repositories.contentAnnotationRepository.findById(row.id).anchorStatus, 'missing');
    }
  },
  {
    name: '异步旧重点协调只在来源无法确认时降级',
    async run() {
      const before = '原文 其他';
      const anchor = anchorForSourceRange(projectMarkdown(before), 0, 2);
      const { repository } = serviceWith([
        legacyRow({
          schemaVersion: 2,
          quoteText: '原文',
          fromPosition: 0,
          toPosition: 2,
          anchor,
          originSnapshot: { quoteText: '原文', segments: anchor.segments }
        })
      ]);
      let markdown = '原文 其他！';
      const service = createAsyncContentAnnotationService({
        repository,
        noteRepository: { findById: async () => ({ rawMarkdown: markdown }) }
      });
      assert.deepEqual((await service.reconcileForNote('note-1', 'hash', { before })).contentChangedAnnotationIds, []);
      markdown = '改写其他';
      assert.deepEqual((await service.reconcileForNote('note-1', 'hash', { before })).contentChangedAnnotationIds, [
        'annotation-legacy'
      ]);
      assert.equal(repository.findById('annotation-legacy').anchorStatus, 'needsReview');
      markdown = '';
      await service.reconcileForNote('note-1', 'hash', { before: '改写其他' });
      assert.equal(repository.findById('annotation-legacy').anchorStatus, 'missing');
    }
  },
  {
    name: '旧格式重点不再新建、改范围、确认范围或恢复，统一返回 ANNOTATION_LEGACY_REMOVED',
    async run() {
      const { service } = serviceWith([
        legacyRow(),
        legacyRow({ id: 'annotation-deleted', idempotencyKey: 'deleted', lifecycleStatus: 'deleted' })
      ]);
      assert.throws(() => service.createAnnotation({ noteId: 'note-1', schemaVersion: 2 }), legacyRemoved);
      assert.throws(() => service.updateAnnotationAnchor('annotation-legacy', {}), legacyRemoved);
      assert.throws(() => service.confirmAnnotationRange('annotation-legacy', {}), legacyRemoved);
      assert.throws(() => service.restoreAnnotation('annotation-deleted'), legacyRemoved);
      assert.equal(service.restoreAnnotation('annotation-legacy').id, 'annotation-legacy');
      assert.deepEqual(service.reconcileForNote('note-1', 'hash'), {
        annotations: [],
        contentChangedAnnotationIds: []
      });
    }
  },
  {
    name: '残留的旧格式重点仍可改备注、归档和取消，并受修订号保护',
    async run() {
      const { service } = serviceWith();
      const updated = service.updateAnnotation('annotation-legacy', {
        expectedRevision: 1,
        comment: '待核对',
        importance: 'core'
      });
      assert.equal(updated.revision, 2);
      assert.equal(updated.importance, 'core');
      assert.throws(
        () => service.updateAnnotation('annotation-legacy', { expectedRevision: 1, comment: '覆盖' }),
        error => error.code === 'ANNOTATION_REVISION_CONFLICT'
      );
      assert.equal(service.archiveAnnotation('annotation-legacy', { expectedRevision: 2 }).lifecycleStatus, 'archived');
      assert.equal(service.deleteAnnotation('annotation-legacy', { expectedRevision: 3 }).lifecycleStatus, 'deleted');
      assert.equal(service.listAnnotationsByNote({ noteId: 'note-1' }).length, 0);
    }
  },
  {
    name: 'content annotation service uses the shared AppError contract',
    async run() {
      const { service } = serviceWith([]);
      assert.throws(
        () => service.getAnnotation('missing'),
        error => {
          assert.ok(error instanceof AppError);
          assert.equal(error.code, 'ANNOTATION_NOT_FOUND');
          assert.equal(error.statusCode, 404);
          return true;
        }
      );
    }
  },
  {
    name: 'archiving a reading mark does not invalidate historical evidence',
    async run() {
      let archivedCallbackCount = 0;
      const { service } = serviceWith([legacyRow()], {
        onAnnotationArchived: () => {
          archivedCallbackCount += 1;
        }
      });
      const archived = service.archiveAnnotation('annotation-legacy', { expectedRevision: 1 });
      assert.equal(archived.lifecycleStatus, 'archived');
      assert.equal(archivedCallbackCount, 0);
    }
  }
];

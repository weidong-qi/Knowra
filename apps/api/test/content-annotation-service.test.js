import assert from 'node:assert/strict';
import { AppError } from '../src/errors/app-error.js';
import { createContentAnnotationService } from '../src/modules/knowledge/application/content-annotation-service.js';
import { createInMemoryContentAnnotationRepository } from '../src/modules/knowledge/infrastructure/content-annotation-repository.js';
import { ContentAnnotation } from '../src/modules/knowledge/domain/content-annotation.js';
import { createKnowledgeModule } from '../src/modules/knowledge/index.js';
import { createAsyncContentAnnotationService } from '../src/modules/knowledge/application/postgres-async/content-annotation-service.js';
import { anchorForSourceRange, projectMarkdown } from '@study-accelerator/content-anchor';

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

import assert from 'node:assert/strict';
import { AppError } from '../src/errors/app-error.js';
import { createContentAnnotationService } from '../src/modules/knowledge/application/content-annotation-service.js';
import { createInMemoryContentAnnotationRepository } from '../src/modules/knowledge/infrastructure/content-annotation-repository.js';
import { ContentAnnotation } from '../src/modules/knowledge/domain/content-annotation.js';

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

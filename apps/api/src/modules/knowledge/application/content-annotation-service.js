import crypto from 'node:crypto';
import { calculateContentHash } from '@study-accelerator/content-anchor';
import { createAppError } from '../../../errors/app-error.js';
import { ContentAnnotation, INLINE_ANNOTATION_SCHEMA } from '../domain/content-annotation.js';
import { buildUpdateContentAnnotationDto } from './dto/content-annotation-dto.js';
import { createInMemoryContentAnnotationRepository } from '../infrastructure/content-annotation-repository.js';

const contentHash = calculateContentHash;
const fail = (code, message, statusCode = 400) => createAppError(code, message, statusCode);
/** 重点内联化 I4b：重点只能写在正文标记里，旧格式重点不再新建、改范围、确认范围、排除或恢复。 */
export const legacyAnnotationRemoved = () => fail('ANNOTATION_LEGACY_REMOVED', '重点写在正文里，请在笔记中标记', 410);

export function createContentAnnotationService({
  repository = createInMemoryContentAnnotationRepository(),
  revisionRepository = null,
  onSourceChanged = null
} = {}) {
  function requireAnnotation(id) {
    const annotation = repository.findById(id);
    if (!annotation) throw fail('ANNOTATION_NOT_FOUND', '标注不存在', 404);
    return annotation;
  }
  // 重点内联化 v3：类型、重要程度、范围与取消/恢复都写在正文标记里，由保存时派生；这里只允许改备注。
  function assertNotTextOwned(annotation, dto = null) {
    if (annotation.schemaVersion !== INLINE_ANNOTATION_SCHEMA) return;
    if (dto && dto.kind === undefined && dto.importance === undefined) return;
    throw fail('ANNOTATION_INLINE_TEXT_OWNED', '这个重点写在正文里，请在笔记中修改', 409);
  }
  function assertRevision(annotation, expectedRevision) {
    if (expectedRevision === undefined || expectedRevision === null || Number.isNaN(expectedRevision)) return;
    if (annotation.revision !== Number(expectedRevision))
      throw fail('ANNOTATION_REVISION_CONFLICT', '标注已被其他操作修改，请刷新后重试', 409);
  }
  function recordRevision(annotation, operation, oldAnchor = null, reason = null) {
    revisionRepository?.save({
      id: `annotation-revision-${crypto.randomUUID()}`,
      annotationId: annotation.id,
      revision: annotation.revision,
      operation,
      oldAnchor: oldAnchor ? structuredClone(oldAnchor) : null,
      newAnchor: annotation.anchor ? structuredClone(annotation.anchor) : null,
      rangeSummary: { scopeType: annotation.scopeType, quoteText: annotation.quoteText },
      reason,
      createdAt: new Date().toISOString()
    });
  }
  function saveUpdated(annotation, changes, operation, reason = null) {
    const updated = repository.save(
      new ContentAnnotation({
        ...annotation,
        ...changes,
        revision: annotation.revision + 1,
        updatedAt: new Date().toISOString()
      })
    );
    recordRevision(updated, operation, annotation.anchor, reason);
    if (updated.quoteText !== annotation.quoteText || updated.anchorStatus !== 'resolved') onSourceChanged?.(updated);
    return updated;
  }
  return {
    createAnnotation() {
      throw legacyAnnotationRemoved();
    },
    listAnnotationsByNote(options) {
      return repository.list(options);
    },
    getAnnotation(id) {
      return requireAnnotation(id);
    },
    updateAnnotation(id, input) {
      const annotation = requireAnnotation(id);
      const dto = buildUpdateContentAnnotationDto(input);
      assertNotTextOwned(annotation, dto);
      assertRevision(annotation, dto.expectedRevision);
      return saveUpdated(annotation, dto, 'metadataUpdated');
    },
    archiveAnnotation(id, input = {}) {
      const annotation = requireAnnotation(id);
      assertNotTextOwned(annotation);
      assertRevision(annotation, input.expectedRevision);
      return saveUpdated(annotation, { lifecycleStatus: 'archived', deletedAt: new Date().toISOString() }, 'archived');
    },
    deleteAnnotation(id, input = {}) {
      const annotation = requireAnnotation(id);
      assertNotTextOwned(annotation);
      assertRevision(annotation, input.expectedRevision);
      if (annotation.lifecycleStatus === 'deleted') return annotation;
      return saveUpdated(annotation, { lifecycleStatus: 'deleted', deletedAt: new Date().toISOString() }, 'deleted');
    },
    restoreAnnotation(id) {
      const annotation = requireAnnotation(id);
      assertNotTextOwned(annotation);
      if (annotation.lifecycleStatus === 'active') return annotation;
      throw legacyAnnotationRemoved();
    },
    updateAnnotationAnchor() {
      throw legacyAnnotationRemoved();
    },
    confirmAnnotationRange() {
      throw legacyAnnotationRemoved();
    },
    // 保存时不再跟随旧重点（位置在正文标记里，由派生维护）；保留方法以维持依赖级联的冻结调用序列。
    reconcileForNote() {
      return { annotations: [], contentChangedAnnotationIds: [] };
    }
  };
}

export { contentHash as calculateNoteContentHash };

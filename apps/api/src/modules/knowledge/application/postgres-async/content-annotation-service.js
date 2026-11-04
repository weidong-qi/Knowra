import crypto from 'node:crypto';
import { createAppError } from '../../../../errors/app-error.js';
import { ContentAnnotation, INLINE_ANNOTATION_SCHEMA } from '../../domain/content-annotation.ts';
import { buildUpdateContentAnnotationDto } from '../dto/content-annotation-dto.ts';
import { legacyAnnotationRemoved, legacyAnnotationSourceChange } from '../content-annotation-service.js';
import { sameKnowraText } from '@study-accelerator/shared/knowra-marks';

const fail = (code, message, statusCode = 400) => createAppError(code, message, statusCode);

/** @param {import('./service-dependencies.ts').ContentAnnotationDependencies} dependencies */
export function createAsyncContentAnnotationService({
  repository,
  noteRepository,
  noteVersionRepository = null,
  revisionRepository = null,
  onSourceChanged = null
} = {}) {
  if (!repository || !noteRepository)
    throw new TypeError('Async annotation service requires annotation and note repositories');

  async function requireAnnotation(id) {
    const annotation = await repository.findById(id);
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
  async function recordRevision(annotation, operation, oldAnchor = null, reason = null) {
    await revisionRepository?.save({
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
  async function saveUpdated(annotation, changes, operation, reason = null) {
    const updated = await repository.save(
      new ContentAnnotation({
        ...annotation,
        ...changes,
        revision: annotation.revision + 1,
        updatedAt: new Date().toISOString()
      })
    );
    await recordRevision(updated, operation, annotation.anchor, reason);
    if (updated.quoteText !== annotation.quoteText || updated.anchorStatus !== 'resolved')
      await onSourceChanged?.(updated);
    return updated;
  }

  return {
    async createAnnotation() {
      throw legacyAnnotationRemoved();
    },
    listAnnotationsByNote(options) {
      return repository.list(options);
    },
    getAnnotation: requireAnnotation,
    async updateAnnotation(id, input) {
      const annotation = await requireAnnotation(id);
      const dto = buildUpdateContentAnnotationDto(input);
      assertNotTextOwned(annotation, dto);
      assertRevision(annotation, dto.expectedRevision);
      return saveUpdated(annotation, dto, 'metadataUpdated');
    },
    async archiveAnnotation(id, input = {}) {
      const annotation = await requireAnnotation(id);
      assertNotTextOwned(annotation);
      assertRevision(annotation, input.expectedRevision);
      return saveUpdated(annotation, { lifecycleStatus: 'archived', deletedAt: new Date().toISOString() }, 'archived');
    },
    async deleteAnnotation(id, input = {}) {
      const annotation = await requireAnnotation(id);
      assertNotTextOwned(annotation);
      assertRevision(annotation, input.expectedRevision);
      if (annotation.lifecycleStatus === 'deleted') return annotation;
      return saveUpdated(annotation, { lifecycleStatus: 'deleted', deletedAt: new Date().toISOString() }, 'deleted');
    },
    async restoreAnnotation(id) {
      const annotation = await requireAnnotation(id);
      assertNotTextOwned(annotation);
      if (annotation.lifecycleStatus === 'active') return annotation;
      throw legacyAnnotationRemoved();
    },
    async updateAnnotationAnchor() {
      throw legacyAnnotationRemoved();
    },
    async confirmAnnotationRange() {
      throw legacyAnnotationRemoved();
    },
    // 不恢复旧锚点跟随，只在旧来源无法确认时保守降级。
    async reconcileForNote(noteId, _contentHash, context = null) {
      const rows = (await repository.list({ noteId, includeDeleted: true })).filter(
        row => row.schemaVersion !== INLINE_ANNOTATION_SCHEMA
      );
      const note = rows.length && typeof context?.before === 'string' ? await noteRepository.findById(noteId) : null;
      if (!note || note.deleted || sameKnowraText(context.before, note.rawMarkdown))
        return { annotations: [], contentChangedAnnotationIds: [] };
      const annotations = [];
      for (const row of rows) {
        const sourceVersion =
          row.schemaVersion === 2 && row.anchor && row.noteVersionId
            ? await noteVersionRepository?.findById(row.noteVersionId)
            : null;
        const change = legacyAnnotationSourceChange(row, context.before, note.rawMarkdown, sourceVersion);
        if (!change) continue;
        const updated = await repository.save(
          new ContentAnnotation(
            /** @type {import('../../domain/content-annotation.ts').ContentAnnotationConstructorInput} */ (
              /** @type {unknown} */ ({
                ...row,
                ...change,
                revision: row.revision + 1,
                updatedAt: new Date().toISOString()
              })
            )
          )
        );
        await recordRevision(updated, 'anchorStatusChanged', row.anchor, change.anchorReason);
        annotations.push(updated);
      }
      return { annotations, contentChangedAnnotationIds: annotations.map(annotation => annotation.id) };
    }
  };
}

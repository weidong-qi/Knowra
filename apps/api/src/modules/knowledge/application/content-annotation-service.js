import { assertRangeConfirmation } from './annotation-range-preview.js';
import { reconcileAnnotationSource, reconciledAnnotationFields } from './reconcile-annotation-source.js';
import { initialIdentityBinding } from './annotation-identity-binding.js';
import { resolveStoredAnnotation } from './resolve-stored-annotation.js';
import crypto from 'node:crypto';
import {
  calculateContentHash,
  listTracking,
  anchorForSection,
  followSectionAnchor,
  headingPathForSourceOffset,
  projectMarkdown,
  relocateAnchor,
  resolveAnchor
} from '@study-accelerator/content-anchor';
import { createAppError } from '../../../errors/app-error.js';
import { ContentAnnotation, INLINE_ANNOTATION_SCHEMA } from '../domain/content-annotation.js';
import {
  buildCreateContentAnnotationDto,
  buildUpdateAnnotationAnchorDto,
  buildUpdateContentAnnotationDto
} from './dto/content-annotation-dto.js';
import { createInMemoryContentAnnotationRepository } from '../infrastructure/content-annotation-repository.js';

const contentHash = calculateContentHash;
const fail = (code, message, statusCode = 400) => createAppError(code, message, statusCode);
const requestHash = value => contentHash(JSON.stringify(value));

/** @param {import('./service-dependencies.ts').ContentAnnotationDependencies} dependencies */
export function createContentAnnotationService({
  repository = createInMemoryContentAnnotationRepository(),
  noteRepository,
  noteVersionRepository,
  revisionRepository = null,
  exclusionRepository = null,
  onSourceChanged = null
} = {}) {
  function requireAnnotation(id) {
    const annotation = repository.findById(id);
    if (!annotation) throw fail('ANNOTATION_NOT_FOUND', '标注不存在', 404);
    return annotation;
  }
  function assertCurrentNote(dto) {
    const note = noteRepository?.findById(dto.noteId);
    if (!note || note.deleted) throw fail('ANNOTATION_NOTE_NOT_FOUND', '笔记不存在', 404);
    if (note.spaceId !== dto.spaceId) throw fail('ANNOTATION_SPACE_MISMATCH', '标注空间与笔记不一致', 409);
    if (contentHash(note.rawMarkdown) !== dto.noteContentHash)
      throw fail('ANNOTATION_CONTENT_CONFLICT', '笔记内容已变化，请重新选择标注范围', 409);
    return note;
  }
  function nextId() {
    return `annotation-${crypto.randomUUID()}`;
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
  function authoritativeAnchor(note, dto) {
    if (dto.anchor?.tracking?.empty) throw fail('ANNOTATION_ANCHOR_UNRESOLVED', '空块不能用于新建或重新选择重点', 409);
    const result = resolveAnchor(note.rawMarkdown, dto.anchor);
    if (result.status !== 'resolved')
      throw fail('ANNOTATION_ANCHOR_UNRESOLVED', '无法在当前笔记版本中确认标注范围', 409);
    if (result.quoteText !== dto.quoteText)
      throw fail('ANNOTATION_QUOTE_MISMATCH', '所选文字与当前笔记版本不一致', 409);
    const projection = result.projection;
    const sourceStart = dto.anchor.segments[0].start;
    const anchor = {
      ...structuredClone(dto.anchor.scopeType === 'list' ? result.anchor : dto.anchor),
      tracking:
        dto.anchor.scopeType === 'list'
          ? listTracking(result.projection, result.anchor, note.annotationStructure)
          : { formatVersion: 1, structureRevision: note.annotationStructure?.revision ?? 0 },
      pending: null,
      noteVersionId: null,
      quoteText: result.quoteText,
      prefixText: dto.anchor.prefixText ?? '',
      suffixText: dto.anchor.suffixText ?? ''
    };
    return {
      anchor,
      projection,
      quoteText: result.quoteText,
      headingPath: headingPathForSourceOffset(projection, sourceStart),
      fromPosition: dto.anchor.sourceStart,
      toPosition: dto.anchor.sourceEnd,
      prefixText: anchor.prefixText,
      suffixText: anchor.suffixText,
      anchorFingerprint: contentHash(
        JSON.stringify({ segments: anchor.segments, structurePath: anchor.structurePath })
      ),
      resolvedContentHash: contentHash(result.quoteText),
      boundaryFingerprint: anchor.list?.memberFingerprint ?? dto.anchor.section?.memberFingerprint ?? null
    };
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
    createAnnotation(input) {
      const dto = buildCreateContentAnnotationDto(input);
      const hashedRequest = requestHash(dto);
      const idempotent = repository.findByIdempotencyKey(dto.noteId, dto.idempotencyKey);
      if (idempotent) {
        if (idempotent.requestHash && idempotent.requestHash !== hashedRequest)
          throw fail('ANNOTATION_IDEMPOTENCY_CONFLICT', '同一幂等键不能用于不同的标注请求', 409);
        return idempotent;
      }
      const note = assertCurrentNote(dto);
      const version = noteVersionRepository?.findByNoteIdAndContentHash(dto.noteId, dto.noteContentHash);
      const source = dto.schemaVersion === 2 ? authoritativeAnchor(note, dto) : dto;
      if (dto.schemaVersion === 2 && !version) throw fail('ANNOTATION_VERSION_NOT_FOUND', '当前笔记版本尚未保存', 409);
      const duplicateInput = { ...dto, ...source };
      if (repository.findDuplicate(duplicateInput)) throw fail('ANNOTATION_DUPLICATE', '该范围已存在同类型标记', 409);
      const anchor = source.anchor
        ? { ...source.anchor, noteVersionId: /** @type {string} */ (version?.id) ?? null }
        : null;
      const originSnapshot = anchor
        ? {
            noteVersionId: /** @type {string} */ (version.id),
            contentHash: dto.noteContentHash,
            scopeType: dto.scopeType,
            segments: structuredClone(anchor.segments),
            quoteText: source.quoteText,
            headingPath: source.headingPath
          }
        : null;
      const created = repository.save(
        new ContentAnnotation({
          ...dto,
          ...source,
          anchor,
          originSnapshot,
          identityBinding: anchor ? initialIdentityBinding(note, { scopeType: dto.scopeType, anchor }) : null,
          noteVersionId: /** @type {string} */ (version?.id) ?? null,
          lifecycleStatus: 'active',
          anchorStatus: 'resolved',
          anchorReason: null,
          requestHash: hashedRequest,
          id: nextId()
        })
      );
      recordRevision(created, 'created');
      return created;
    },
    listAnnotationsByNote(options) {
      return repository.list(options);
    },
    getAnnotation(id) {
      return requireAnnotation(id);
    },
    advanceRevision(id, input = {}) {
      const annotation = requireAnnotation(id);
      assertNotTextOwned(annotation);
      assertRevision(annotation, input.expectedRevision);
      return saveUpdated(annotation, {}, input.operation ?? 'rangeChanged', input.reason ?? null);
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
    restoreAnnotation(id, input = {}) {
      const annotation = requireAnnotation(id);
      assertNotTextOwned(annotation);
      assertRevision(annotation, input.expectedRevision);
      if (annotation.lifecycleStatus === 'active') return annotation;
      const parent = noteRepository?.findById(/** @type {string} */ (annotation.noteId));
      if (!parent || parent.deleted) throw fail('ANNOTATION_NOTE_IN_TRASH', '请先恢复来源笔记，再恢复标注。', 409);
      if (annotation.schemaVersion !== 2 || !annotation.anchor)
        return saveUpdated(
          annotation,
          {
            lifecycleStatus: 'active',
            anchorStatus: annotation.status === 'stale' ? 'needsReview' : 'resolved',
            deletedAt: null
          },
          'restored'
        );
      const note = noteRepository?.findById(/** @type {string} */ (annotation.noteId));
      if (!note || note.deleted)
        return saveUpdated(
          annotation,
          { lifecycleStatus: 'active', anchorStatus: 'missing', anchorReason: 'sourceDeleted', deletedAt: null },
          'restored',
          'sourceDeleted'
        );
      const oldVersion = noteVersionRepository?.findById(/** @type {string} */ (annotation.noteVersionId));
      const result = reconcileAnnotationSource({ ...annotation, anchorStatus: 'resolved' }, note, oldVersion, null);
      if (annotation.scopeType === 'list') {
        const version = noteVersionRepository?.findByNoteIdAndContentHash(
          note.id,
          calculateContentHash(note.rawMarkdown)
        );
        return saveUpdated(
          annotation,
          {
            ...reconciledAnnotationFields(annotation, note, version, result),
            lifecycleStatus: 'active',
            deletedAt: null
          },
          'restored',
          result.reason
        );
      }
      return saveUpdated(
        annotation,
        {
          lifecycleStatus: 'active',
          deletedAt: null,
          anchorStatus: result.status,
          anchorReason: result.reason,
          ...(result.status === 'resolved' && result.anchor
            ? {
                anchor: { ...result.anchor, noteVersionId: annotation.noteVersionId },
                quoteText: result.quoteText,
                fromPosition: result.anchor.sourceStart,
                toPosition: result.anchor.sourceEnd,
                resolvedContentHash: contentHash(result.quoteText)
              }
            : {})
        },
        'restored',
        result.reason
      );
    },
    updateAnnotationAnchor(id, input) {
      const annotation = requireAnnotation(id);
      assertNotTextOwned(annotation);
      const dto = buildUpdateAnnotationAnchorDto(input);
      if (annotation.scopeType === 'list' && dto.anchor?.scopeType !== 'list')
        throw fail('ANNOTATION_RANGE_INVALID', '列表重点的新来源必须是完整列表项', 409);
      assertRevision(annotation, dto.expectedRevision);
      const note = assertCurrentNote({ ...annotation, ...dto });
      const version = noteVersionRepository?.findByNoteIdAndContentHash(
        /** @type {string} */ (annotation.noteId),
        dto.noteContentHash
      );
      const source = dto.anchor ? authoritativeAnchor(note, { ...dto, schemaVersion: 2 }) : dto;
      if (annotation.schemaVersion === 2 && !version)
        throw fail('ANNOTATION_VERSION_NOT_FOUND', '当前笔记版本尚未保存', 409);
      return saveUpdated(
        annotation,
        {
          ...source,
          noteContentHash: dto.noteContentHash,
          scopeType: source.anchor?.scopeType ?? annotation.scopeType,
          anchor: source.anchor
            ? { ...source.anchor, noteVersionId: /** @type {string} */ (version?.id) ?? null }
            : annotation.anchor,
          noteVersionId: /** @type {string} */ (version?.id) ?? null,
          anchorStatus: 'resolved',
          anchorReason: null,
          lifecycleStatus: 'active',
          deletedAt: null
        },
        'anchorUpdated'
      );
    },
    confirmAnnotationRange(id, input) {
      const annotation = requireAnnotation(id);
      assertNotTextOwned(annotation);
      const note = noteRepository.findById(/** @type {string} */ (annotation.noteId));
      if (!note || note.deleted) throw fail('ANNOTATION_NOTE_NOT_FOUND', '笔记不存在', 404);
      const anchor = assertRangeConfirmation(annotation, note, input);
      const version = noteVersionRepository.findByNoteIdAndContentHash(note.id, input.noteContentHash);
      const result = {
        status: 'resolved',
        reason: null,
        anchor,
        projection: resolveAnchor(note.rawMarkdown, anchor).projection
      };
      return saveUpdated(annotation, reconciledAnnotationFields(annotation, note, version, result), 'rangeConfirmed');
    },
    reconcileForNote(noteId, currentContentHash, context = null) {
      const note = noteRepository?.findById(noteId);
      if (!note || note.deleted) return { annotations: [], contentChangedAnnotationIds: [] };
      const version = noteVersionRepository?.findByNoteIdAndContentHash(noteId, currentContentHash);
      const changed = [];
      const contentChangedAnnotationIds = [];
      for (const annotation of repository.list({ noteId, includeDeleted: true })) {
        // v3 的位置在正文标记里，由保存后的派生维护，不参与旧链路跟随。
        if (annotation.schemaVersion === INLINE_ANNOTATION_SCHEMA) continue;
        if (
          annotation.lifecycleStatus !== 'active' ||
          (annotation.noteContentHash === currentContentHash && !context?.edits?.length)
        )
          continue;
        if (annotation.schemaVersion !== 2 || !annotation.anchor) {
          changed.push(
            saveUpdated(
              annotation,
              { anchorStatus: 'needsReview', anchorReason: 'legacyUnverified', noteContentHash: currentContentHash },
              'anchorStatusChanged',
              'legacyUnverified'
            )
          );
          continue;
        }
        const oldVersion = noteVersionRepository?.findById(/** @type {string} */ (annotation.noteVersionId));
        let result = reconcileAnnotationSource(annotation, note, oldVersion, context);
        if (context?.edits?.at(-1)?.history && version) {
          const revisions = revisionRepository?.list({ annotationId: annotation.id }) ?? [];
          const historical = [
            /** @type {import('@study-accelerator/content-anchor').ContentAnchor & { noteVersionId?: string }} */ (
              annotation.anchor
            ),
            ...revisions.flatMap(item => [item.newAnchor, item.oldAnchor]).reverse()
          ].find(
            candidate =>
              candidate?.noteVersionId === version.id &&
              !candidate.pending &&
              resolveAnchor(note.rawMarkdown, candidate).status === 'resolved'
          );
          if (historical) result = { ...resolveAnchor(note.rawMarkdown, historical), anchor: historical };
        }
        const fields = reconciledAnnotationFields(annotation, note, version, result);
        if (result.status !== 'resolved' || fields.resolvedContentHash !== annotation.resolvedContentHash)
          contentChangedAnnotationIds.push(annotation.id);
        changed.push(saveUpdated(annotation, fields, 'sourceReconciled', result.reason));
        const parentRange = result.status === 'resolved' ? fields.anchor : fields.anchor?.pending?.anchor;
        for (const exclusion of exclusionRepository?.list({ parentAnnotationId: annotation.id }) ?? []) {
          const exclusionVersion = noteVersionRepository?.findById(exclusion.noteVersionId);
          const resolution = reconcileAnnotationSource(
            {
              ...annotation,
              scopeType: exclusion.anchor.scopeType,
              anchor: exclusion.anchor,
              anchorStatus: exclusion.anchor.unresolved ? 'needsReview' : 'resolved'
            },
            note,
            exclusionVersion,
            context
          );
          exclusionRepository.save({
            ...exclusion,
            revision: exclusion.revision + 1,
            anchor: {
              ...(resolution.anchor ?? exclusion.anchor),
              unresolved:
                resolution.status !== 'resolved' ||
                !parentRange ||
                (resolution.anchor ?? exclusion.anchor).sourceStart < parentRange.sourceStart ||
                (resolution.anchor ?? exclusion.anchor).sourceEnd > parentRange.sourceEnd
            },
            ...(resolution.status === 'resolved' ? { noteVersionId: /** @type {string} */ (version.id) } : {})
          });
        }
      }
      return { annotations: changed, contentChangedAnnotationIds };
    },
    markStaleForNote(noteId, currentContentHash) {
      return repository.markStaleByNoteId?.(noteId, currentContentHash) ?? [];
    },
    markAnnotationStale(id) {
      const annotation = requireAnnotation(id);
      return annotation.lifecycleStatus !== 'active' || annotation.schemaVersion === INLINE_ANNOTATION_SCHEMA
        ? annotation
        : saveUpdated(
            annotation,
            { anchorStatus: 'needsReview', anchorReason: 'contentChanged' },
            'anchorStatusChanged',
            'contentChanged'
          );
    }
  };
}

export { contentHash as calculateNoteContentHash };

import { assertRangeConfirmation } from '../annotation-range-preview.js';
import { reconcileAnnotationSource, reconciledAnnotationFields } from '../reconcile-annotation-source.js';
import { initialIdentityBinding } from '../annotation-identity-binding.js';
import { resolveStoredAnnotation } from '../resolve-stored-annotation.js';
import crypto from 'node:crypto';
import {
  listTracking,
  anchorForSection,
  calculateContentHash,
  followSectionAnchor,
  headingPathForSourceOffset,
  relocateAnchor,
  resolveAnchor
} from '@study-accelerator/content-anchor';
import { createAppError } from '../../../../errors/app-error.js';
import { ContentAnnotation, INLINE_ANNOTATION_SCHEMA } from '../../domain/content-annotation.js';
import {
  buildCreateContentAnnotationDto,
  buildUpdateAnnotationAnchorDto,
  buildUpdateContentAnnotationDto
} from '../dto/content-annotation-dto.js';

const fail = (code, message, statusCode = 400) => createAppError(code, message, statusCode);
const requestHash = value => calculateContentHash(JSON.stringify(value));

/** @param {import('./service-dependencies.ts').ContentAnnotationDependencies} dependencies */
export function createAsyncContentAnnotationService({
  repository,
  noteRepository,
  noteVersionRepository,
  revisionRepository = null,
  exclusionRepository = null,
  onSourceChanged = null
} = {}) {
  if (!repository || !noteRepository)
    throw new TypeError('Async annotation service requires annotation and note repositories');

  async function requireAnnotation(id) {
    const annotation = await repository.findById(id);
    if (!annotation) throw fail('ANNOTATION_NOT_FOUND', '标注不存在', 404);
    return annotation;
  }
  async function assertCurrentNote(dto) {
    const note = await noteRepository.findById(dto.noteId);
    if (!note || note.deleted) throw fail('ANNOTATION_NOTE_NOT_FOUND', '笔记不存在', 404);
    if (note.spaceId !== dto.spaceId) throw fail('ANNOTATION_SPACE_MISMATCH', '标注空间与笔记不一致', 409);
    if (calculateContentHash(note.rawMarkdown) !== dto.noteContentHash)
      throw fail('ANNOTATION_CONTENT_CONFLICT', '笔记内容已变化，请重新选择标注范围', 409);
    return note;
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
    const anchor = {
      ...structuredClone(dto.anchor.scopeType === 'list' ? result.anchor : dto.anchor),
      tracking:
        dto.anchor.scopeType === 'list'
          ? listTracking(result.projection, result.anchor, note.annotationStructure)
          : { formatVersion: 1, structureRevision: note.annotationStructure?.revision ?? 0 },
      pending: null,
      noteVersionId: null,
      quoteText: result.quoteText
    };
    return {
      anchor,
      quoteText: result.quoteText,
      headingPath: headingPathForSourceOffset(result.projection, dto.anchor.segments[0].start),
      fromPosition: dto.anchor.sourceStart,
      toPosition: dto.anchor.sourceEnd,
      prefixText: anchor.prefixText ?? '',
      suffixText: anchor.suffixText ?? '',
      anchorFingerprint: calculateContentHash(
        JSON.stringify({ segments: anchor.segments, structurePath: anchor.structurePath })
      ),
      resolvedContentHash: calculateContentHash(result.quoteText),
      boundaryFingerprint: anchor.list?.memberFingerprint ?? dto.anchor.section?.memberFingerprint ?? null
    };
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
    async createAnnotation(input) {
      const dto = buildCreateContentAnnotationDto(input);
      const hashedRequest = requestHash(dto);
      const idempotent = await repository.findByIdempotencyKey(dto.noteId, dto.idempotencyKey);
      if (idempotent) {
        if (idempotent.requestHash && idempotent.requestHash !== hashedRequest)
          throw fail('ANNOTATION_IDEMPOTENCY_CONFLICT', '同一幂等键不能用于不同的标注请求', 409);
        return idempotent;
      }
      const note = await assertCurrentNote(dto);
      const version = await noteVersionRepository?.findByNoteIdAndContentHash(dto.noteId, dto.noteContentHash);
      const source = dto.schemaVersion === 2 ? authoritativeAnchor(note, dto) : dto;
      if (dto.schemaVersion === 2 && !version) throw fail('ANNOTATION_VERSION_NOT_FOUND', '当前笔记版本尚未保存', 409);
      if (await repository.findDuplicate({ ...dto, ...source }))
        throw fail('ANNOTATION_DUPLICATE', '该范围已存在同类型标记', 409);
      const anchor = source.anchor ? { ...source.anchor, noteVersionId: version?.id ?? null } : null;
      const originSnapshot = anchor
        ? {
            noteVersionId: version.id,
            contentHash: dto.noteContentHash,
            scopeType: dto.scopeType,
            segments: structuredClone(anchor.segments),
            quoteText: source.quoteText,
            headingPath: source.headingPath
          }
        : null;
      const created = await repository.save(
        new ContentAnnotation({
          ...dto,
          ...source,
          anchor,
          originSnapshot,
          identityBinding: anchor ? initialIdentityBinding(note, { scopeType: dto.scopeType, anchor }) : null,
          noteVersionId: version?.id ?? null,
          lifecycleStatus: 'active',
          anchorStatus: 'resolved',
          anchorReason: null,
          requestHash: hashedRequest,
          id: `annotation-${crypto.randomUUID()}`
        })
      );
      await recordRevision(created, 'created');
      return created;
    },
    listAnnotationsByNote(options) {
      return repository.list(options);
    },
    getAnnotation: requireAnnotation,
    async advanceRevision(id, input = {}) {
      const annotation = await requireAnnotation(id);
      assertNotTextOwned(annotation);
      assertRevision(annotation, input.expectedRevision);
      return saveUpdated(annotation, {}, input.operation ?? 'rangeChanged', input.reason ?? null);
    },
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
    async restoreAnnotation(id, input = {}) {
      const annotation = await requireAnnotation(id);
      assertNotTextOwned(annotation);
      assertRevision(annotation, input.expectedRevision);
      if (annotation.lifecycleStatus === 'active') return annotation;
      const parent = await noteRepository.findById(annotation.noteId);
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
      const note = await noteRepository.findById(annotation.noteId);
      if (!note || note.deleted)
        return saveUpdated(
          annotation,
          { lifecycleStatus: 'active', anchorStatus: 'missing', anchorReason: 'sourceDeleted', deletedAt: null },
          'restored',
          'sourceDeleted'
        );
      const oldVersion = await noteVersionRepository?.findById(annotation.noteVersionId);
      const result = reconcileAnnotationSource({ ...annotation, anchorStatus: 'resolved' }, note, oldVersion, null);
      if (annotation.scopeType === 'list') {
        const version = await noteVersionRepository?.findByNoteIdAndContentHash(
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
                resolvedContentHash: calculateContentHash(result.quoteText)
              }
            : {})
        },
        'restored',
        result.reason
      );
    },
    async updateAnnotationAnchor(id, input) {
      const annotation = await requireAnnotation(id);
      assertNotTextOwned(annotation);
      const dto = buildUpdateAnnotationAnchorDto(input);
      if (annotation.scopeType === 'list' && dto.anchor?.scopeType !== 'list')
        throw fail('ANNOTATION_RANGE_INVALID', '列表重点的新来源必须是完整列表项', 409);
      assertRevision(annotation, dto.expectedRevision);
      const note = await assertCurrentNote({ ...annotation, ...dto });
      const version = await noteVersionRepository?.findByNoteIdAndContentHash(annotation.noteId, dto.noteContentHash);
      const source = dto.anchor ? authoritativeAnchor(note, dto) : dto;
      if (annotation.schemaVersion === 2 && !version)
        throw fail('ANNOTATION_VERSION_NOT_FOUND', '当前笔记版本尚未保存', 409);
      return saveUpdated(
        annotation,
        {
          ...source,
          noteContentHash: dto.noteContentHash,
          scopeType: source.anchor?.scopeType ?? annotation.scopeType,
          anchor: source.anchor ? { ...source.anchor, noteVersionId: version?.id ?? null } : annotation.anchor,
          noteVersionId: version?.id ?? null,
          anchorStatus: 'resolved',
          anchorReason: null,
          lifecycleStatus: 'active',
          deletedAt: null
        },
        'anchorUpdated'
      );
    },
    async confirmAnnotationRange(id, input) {
      const annotation = await requireAnnotation(id);
      assertNotTextOwned(annotation);
      const note = await noteRepository.findById(annotation.noteId);
      if (!note || note.deleted) throw fail('ANNOTATION_NOTE_NOT_FOUND', '笔记不存在', 404);
      const anchor = assertRangeConfirmation(annotation, note, input);
      const version = await noteVersionRepository.findByNoteIdAndContentHash(note.id, input.noteContentHash);
      const result = {
        status: 'resolved',
        reason: null,
        anchor,
        projection: resolveAnchor(note.rawMarkdown, anchor).projection
      };
      return saveUpdated(annotation, reconciledAnnotationFields(annotation, note, version, result), 'rangeConfirmed');
    },
    async reconcileForNote(noteId, currentContentHash, context = null) {
      const note = await noteRepository.findById(noteId);
      if (!note || note.deleted) return { annotations: [], contentChangedAnnotationIds: [] };
      const version = await noteVersionRepository?.findByNoteIdAndContentHash(noteId, currentContentHash);
      const changed = [];
      const contentChangedAnnotationIds = [];
      for (const annotation of await repository.list({ noteId, includeDeleted: true })) {
        // v3 的位置在正文标记里，由保存后的派生维护，不参与旧链路跟随。
        if (annotation.schemaVersion === INLINE_ANNOTATION_SCHEMA) continue;
        if (
          annotation.lifecycleStatus !== 'active' ||
          (annotation.noteContentHash === currentContentHash && !context?.edits?.length)
        )
          continue;
        if (annotation.schemaVersion !== 2 || !annotation.anchor) {
          changed.push(
            await saveUpdated(
              annotation,
              { anchorStatus: 'needsReview', anchorReason: 'legacyUnverified', noteContentHash: currentContentHash },
              'anchorStatusChanged',
              'legacyUnverified'
            )
          );
          continue;
        }
        const oldVersion = await noteVersionRepository?.findById(annotation.noteVersionId);
        let result = reconcileAnnotationSource(annotation, note, oldVersion, context);
        if (context?.edits?.at(-1)?.history && version) {
          const revisions = (await revisionRepository?.list({ annotationId: annotation.id })) ?? [];
          const historical = [
            annotation.anchor,
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
        changed.push(await saveUpdated(annotation, fields, 'sourceReconciled', result.reason));
        const parentRange = result.status === 'resolved' ? fields.anchor : fields.anchor?.pending?.anchor;
        for (const exclusion of (await exclusionRepository?.list({ parentAnnotationId: annotation.id })) ?? []) {
          const exclusionVersion = await noteVersionRepository?.findById(exclusion.noteVersionId);
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
          await exclusionRepository.save({
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
            ...(resolution.status === 'resolved' ? { noteVersionId: version.id } : {})
          });
        }
      }
      return { annotations: changed, contentChangedAnnotationIds };
    },
    async markAnnotationStale(id) {
      const annotation = await requireAnnotation(id);
      return annotation.lifecycleStatus === 'archived' || annotation.schemaVersion === INLINE_ANNOTATION_SCHEMA
        ? annotation
        : saveUpdated(
            annotation,
            { anchorStatus: 'needsReview', anchorReason: 'contentChanged' },
            'anchorStatusChanged',
            'contentChanged'
          );
    },
    markStaleForNote(noteId, currentContentHash) {
      return repository.markStaleByNoteId?.(noteId, currentContentHash) ?? Promise.resolve([]);
    }
  };
}

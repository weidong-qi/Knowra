import crypto from 'node:crypto';
import { calculateContentHash } from '@study-accelerator/content-anchor';
import { sameKnowraText, stripKnowraMarks } from '@study-accelerator/shared/knowra-marks';
import { createAppError } from '../../../errors/app-error.ts';
import { ContentAnnotation, INLINE_ANNOTATION_SCHEMA } from '../domain/content-annotation.ts';
import { buildUpdateContentAnnotationDto } from './dto/content-annotation-dto.ts';
import { createInMemoryContentAnnotationRepository } from '../infrastructure/content-annotation-repository.ts';
import { resolveLegacyAnnotationAnchor, sameAnchorText } from './legacy-annotation-anchor.ts';

import type { ContentAnchor } from '@study-accelerator/content-anchor';
import type { ContentAnnotationConstructorInput } from '../domain/content-annotation.ts';
import type {
  ContentAnnotationRecord,
  ContentAnnotationRepository
} from '../infrastructure/content-annotation-repository.ts';
import type { AnnotationDtoInput } from './dto/content-annotation-dto.ts';
import type { ContentAnnotationDependencies } from './service-dependencies.ts';

interface AnnotationServiceDependencies {
  repository?: Pick<ContentAnnotationRepository, 'findById' | 'list' | 'save'>;
  noteRepository?: ContentAnnotationDependencies['noteRepository'] | null;
  noteVersionRepository?: Pick<NonNullable<ContentAnnotationDependencies['noteVersionRepository']>, 'findById'> | null;
  revisionRepository?: { save(record: AnnotationRevisionWrite): object } | null;
  onSourceChanged?: ContentAnnotationDependencies['onSourceChanged'] | null;
  // 旧排除入口已移除，装配仍可传入，但本服务不读取或调用它。
  exclusionRepository?: object;
}
/** 修订记录保留仓储原值，不把历史字段当成已通过领域校验。 */
export interface AnnotationRevisionWrite {
  id: string;
  annotationId: ContentAnnotationRecord['id'];
  revision: ContentAnnotationRecord['revision'];
  operation: string;
  oldAnchor: ContentAnnotationRecord['anchor'];
  newAnchor: ContentAnnotationRecord['anchor'];
  rangeSummary: Pick<ContentAnnotationRecord, 'scopeType' | 'quoteText'>;
  reason: string | null;
  createdAt: string;
}
export interface AnnotationReconcileContext {
  before?: unknown;
}

const contentHash = calculateContentHash;
const fail = (code: string, message: string, statusCode = 400) => createAppError(code, message, statusCode);
/** 重点内联化 I4b：重点只能写在正文标记里，旧格式重点不再新建、改范围、确认范围、排除或恢复。 */
export const legacyAnnotationRemoved = () => fail('ANNOTATION_LEGACY_REMOVED', '重点写在正文里，请在笔记中标记', 410);

/** 历史记录可能只有旧 status 字段；与仓储读取时采用相同的默认值。 */
export function legacyAnnotationHealth<Record extends ContentAnnotationRecord>(annotation: Record | null | undefined) {
  return {
    lifecycleStatus: (annotation?.lifecycleStatus ?? (annotation?.status === 'archived' ? 'archived' : 'active')) as
      NonNullable<Record['lifecycleStatus']> | 'archived' | 'active',
    anchorStatus: (annotation?.anchorStatus ?? (annotation?.status === 'stale' ? 'needsReview' : 'resolved')) as
      NonNullable<Record['anchorStatus']> | 'needsReview' | 'resolved'
  };
}

/**
 * 旧重点不再跟随正文；无法确认原摘录时，保守降级其来源。
 * @param {{noteId?: unknown, content?: unknown} | null} [sourceVersion]
 */
export function legacyAnnotationSourceChange(
  annotation: ContentAnnotationRecord | null | undefined,
  before: unknown,
  after: unknown,
  sourceVersion: { noteId?: unknown; content?: unknown } | null | undefined = null
) {
  const { lifecycleStatus, anchorStatus } = legacyAnnotationHealth(annotation);
  if (
    !annotation ||
    annotation.schemaVersion === INLINE_ANNOTATION_SCHEMA ||
    lifecycleStatus !== 'active' ||
    typeof before !== 'string' ||
    typeof after !== 'string' ||
    sameKnowraText(before, after)
  )
    return null;
  if (!stripKnowraMarks(after).trim()) {
    return anchorStatus === 'missing' ? null : { anchorStatus: 'missing', anchorReason: 'sourceDeleted' };
  }
  if (anchorStatus === 'missing' || anchorStatus === 'needsReview') return null;
  if (annotation.schemaVersion === 2 && annotation.anchor) {
    try {
      const source =
        sourceVersion?.noteId === annotation.noteId && typeof sourceVersion!.content === 'string'
          ? sourceVersion!.content
          : null;
      const resolved = resolveLegacyAnnotationAnchor(after, annotation.anchor as ContentAnchor, source);
      if (
        resolved.status === 'resolved' &&
        sameAnchorText(resolved.quoteText, annotation.quoteText as string | null | undefined)
      )
        return null;
    } catch {
      // 损坏的旧锚点不应阻止正文保存，需要用户核对。
    }
  }
  return { anchorStatus: 'needsReview', anchorReason: 'sourceChanged' };
}

export function createContentAnnotationService({
  repository = createInMemoryContentAnnotationRepository(),
  noteRepository = null,
  noteVersionRepository = null,
  revisionRepository = null,
  onSourceChanged = null
}: AnnotationServiceDependencies = {}) {
  function requireAnnotation(id: string) {
    const annotation = repository.findById(id);
    if (!annotation) throw fail('ANNOTATION_NOT_FOUND', '标注不存在', 404);
    return annotation;
  }
  // 重点内联化 v3：类型、重要程度、范围与取消/恢复都写在正文标记里，由保存时派生；这里只允许改备注。
  function assertNotTextOwned(
    annotation: ContentAnnotationRecord,
    dto: ReturnType<typeof buildUpdateContentAnnotationDto> | null = null
  ) {
    if (annotation.schemaVersion !== INLINE_ANNOTATION_SCHEMA) return;
    if (dto && dto.kind === undefined && dto.importance === undefined) return;
    throw fail('ANNOTATION_INLINE_TEXT_OWNED', '这个重点写在正文里，请在笔记中修改', 409);
  }
  function assertRevision(annotation: ContentAnnotationRecord, expectedRevision: unknown) {
    if (expectedRevision === undefined || expectedRevision === null || Number.isNaN(expectedRevision)) return;
    if (annotation.revision !== Number(expectedRevision))
      throw fail('ANNOTATION_REVISION_CONFLICT', '标注已被其他操作修改，请刷新后重试', 409);
  }
  function recordRevision(
    annotation: ContentAnnotationRecord,
    operation: string,
    oldAnchor: ContentAnnotationRecord['anchor'] = null,
    reason: string | null = null
  ) {
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
  function saveUpdated(
    annotation: ContentAnnotationRecord,
    changes: Partial<ContentAnnotationRecord>,
    operation: string,
    reason: string | null = null
  ) {
    const updated = repository.save(
      new ContentAnnotation({
        ...annotation,
        ...changes,
        revision: (annotation.revision as number) + 1,
        updatedAt: new Date().toISOString()
      } as ContentAnnotationConstructorInput)
    );
    recordRevision(updated, operation, annotation.anchor, reason);
    if (updated.quoteText !== annotation.quoteText || updated.anchorStatus !== 'resolved') onSourceChanged?.(updated);
    return updated;
  }
  return {
    createAnnotation() {
      throw legacyAnnotationRemoved();
    },
    listAnnotationsByNote(options: Parameters<ContentAnnotationRepository['list']>[0]) {
      return repository.list(options);
    },
    getAnnotation(id: string) {
      return requireAnnotation(id);
    },
    updateAnnotation(id: string, input: AnnotationDtoInput) {
      const annotation = requireAnnotation(id);
      const dto = buildUpdateContentAnnotationDto(input);
      assertNotTextOwned(annotation, dto);
      assertRevision(annotation, dto.expectedRevision);
      return saveUpdated(annotation, dto, 'metadataUpdated');
    },
    archiveAnnotation(id: string, input: Pick<AnnotationDtoInput, 'expectedRevision'> = {}) {
      const annotation = requireAnnotation(id);
      assertNotTextOwned(annotation);
      assertRevision(annotation, input.expectedRevision);
      return saveUpdated(annotation, { lifecycleStatus: 'archived', deletedAt: new Date().toISOString() }, 'archived');
    },
    deleteAnnotation(id: string, input: Pick<AnnotationDtoInput, 'expectedRevision'> = {}) {
      const annotation = requireAnnotation(id);
      assertNotTextOwned(annotation);
      assertRevision(annotation, input.expectedRevision);
      if (annotation.lifecycleStatus === 'deleted') return annotation;
      return saveUpdated(annotation, { lifecycleStatus: 'deleted', deletedAt: new Date().toISOString() }, 'deleted');
    },
    restoreAnnotation(id: string) {
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
    // 不恢复旧锚点跟随，只在旧来源无法确认时保守降级。
    reconcileForNote(noteId: string, _contentHash: unknown, context: AnnotationReconcileContext | null = null) {
      const rows = repository
        .list({ noteId, includeDeleted: true })
        .filter(row => row.schemaVersion !== INLINE_ANNOTATION_SCHEMA);
      const note = rows.length && typeof context?.before === 'string' ? noteRepository?.findById(noteId) : null;
      if (!note || note.deleted || sameKnowraText(context!.before as string, note.rawMarkdown))
        return { annotations: [], contentChangedAnnotationIds: [] };
      const annotations = [];
      for (const row of rows) {
        const sourceVersion =
          row.schemaVersion === 2 && row.anchor && row.noteVersionId
            ? noteVersionRepository?.findById(row.noteVersionId as string)
            : null;
        const change = legacyAnnotationSourceChange(row, context!.before, note.rawMarkdown, sourceVersion);
        if (!change) continue;
        // 旧记录由领域构造器校验；revision 可能来自历史存储中的数字字符串。
        const input = {
          ...row,
          ...change,
          revision: Number(row.revision) + 1,
          updatedAt: new Date().toISOString()
        } as ContentAnnotationConstructorInput;
        const updated = repository.save(new ContentAnnotation(input));
        recordRevision(updated, 'anchorStatusChanged', row.anchor, change.anchorReason);
        annotations.push(updated);
      }
      return { annotations, contentChangedAnnotationIds: annotations.map(annotation => annotation.id) };
    }
  };
}

export { contentHash as calculateNoteContentHash };

import { inlineAnnotationSourceRanges } from './inline-annotation-ranges.js';
import { legacyAnnotationRemoved } from './content-annotation-service.js';
import crypto from 'node:crypto';
import { calculateContentHash, projectMarkdown, resolveAnchor } from '@study-accelerator/content-anchor';
import { createAppError } from '../../../errors/app-error.js';

const fail = (code, message, statusCode = 400) => createAppError(code, message, statusCode);
const newId = prefix => `${prefix}-${crypto.randomUUID()}`;

export function createAnnotationScopeService({
  annotationRepository,
  exclusionRepository,
  analysisScopeRepository,
  noteRepository,
  noteVersionRepository,
  evidenceRepository,
  knowledgeItemRepository
}) {
  function requireAnnotation(id) {
    const annotation = annotationRepository.findById(id);
    if (!annotation) throw fail('ANNOTATION_NOT_FOUND', '标注不存在', 404);
    return annotation;
  }
  function requireNote(id) {
    const note = noteRepository.findById(id);
    if (!note || note.deleted) throw fail('ANNOTATION_NOTE_NOT_FOUND', '笔记不存在', 404);
    return note;
  }
  function requireVersion(note) {
    const hash = calculateContentHash(note.rawMarkdown);
    const version = noteVersionRepository.findByNoteIdAndContentHash(note.id, hash);
    if (!version) throw fail('ANNOTATION_VERSION_NOT_FOUND', '当前笔记版本尚未保存', 409);
    return version;
  }

  function previewAnnotation(id) {
    const annotation = requireAnnotation(id);
    const note = requireNote(annotation.noteId);
    // v3 的位置在正文标记里，状态由保存时派生。
    const resolution =
      annotation.schemaVersion === 3
        ? { status: annotation.anchorStatus ?? 'resolved', reason: annotation.anchorReason ?? null }
        : annotation.anchorStatus === 'resolved' && annotation.schemaVersion === 2 && annotation.anchor
          ? resolveAnchor(note.rawMarkdown, annotation.anchor)
          : { status: annotation.anchorStatus ?? 'needsReview', reason: annotation.anchorReason ?? 'legacyUnverified' };
    return {
      annotation,
      pendingRange: null,
      currentContentHash: calculateContentHash(note.rawMarkdown),
      resolution: summarizeResolution(resolution),
      exclusions: exclusionRepository.list({ parentAnnotationId: id, includeDeleted: true })
    };
  }

  // 排除写在正文标记里（`<!--k- id-->`）；旧格式重点的排除不再新增或移除。
  function createExclusion() {
    throw legacyAnnotationRemoved();
  }

  function deleteExclusion() {
    throw legacyAnnotationRemoved();
  }

  function getKnowledgeLinks(annotationId) {
    requireAnnotation(annotationId);
    const evidence = evidenceRepository.list({ annotationId });
    const links = evidence
      .map(item => ({
        evidence: item,
        knowledgeItem: knowledgeItemRepository.findById(item.knowledgeItemId)
      }))
      .filter(item => item.knowledgeItem);
    return {
      annotationId,
      candidates: links.filter(item => item.knowledgeItem.reviewStatus === 'candidate'),
      confirmed: links.filter(item => item.knowledgeItem.reviewStatus === 'confirmed'),
      evidenceStatus: links.map(item => ({ id: item.evidence.id, status: item.evidence.status }))
    };
  }

  function previewAnalysisScope(input = {}) {
    const normalized = normalizeScopeInput(input);
    const annotations = normalized.annotationIds.map(requireAnnotation);
    const noteIds = new Set(normalized.noteIds);
    annotations.forEach(annotation => noteIds.add(annotation.noteId));
    normalized.selections.forEach(selection => noteIds.add(selection.noteId));
    if (noteIds.size === 0) throw fail('ANALYSIS_SCOPE_EMPTY', '请选择至少一篇笔记或一个重点范围', 400);

    const notes = [...noteIds].map(requireNote);
    if (notes.some(note => note.spaceId !== normalized.spaceId))
      throw fail('ANNOTATION_SPACE_MISMATCH', '分析范围包含其他知识空间', 409);
    const noteVersions = notes.map(note => ({ note, version: requireVersion(note) }));
    const versionByNote = new Map(noteVersions.map(item => [item.note.id, item.version]));
    const noteById = new Map(notes.map(note => [note.id, note]));
    const omittedItems = [];
    const contributions = [];
    const inlineExclusions = [];

    if (normalized.mode === 'all') {
      for (const note of notes) {
        if (note.rawMarkdown.length > 0)
          contributions.push({ noteId: note.id, start: 0, end: note.rawMarkdown.length, annotationId: null });
      }
    } else {
      for (const annotation of annotations) {
        if (annotation.lifecycleStatus !== 'active') continue;
        if (annotation.scopeType === 'list' && annotation.anchor?.tracking?.empty)
          throw fail('ANALYSIS_SCOPE_EMPTY', '空列表项不能用于分析', 409);
        if (annotation.schemaVersion === 3) {
          inlineContributions(
            annotation,
            noteById.get(annotation.noteId),
            contributions,
            inlineExclusions,
            omittedItems
          );
          continue;
        }
        if (annotation.schemaVersion !== 2 || !annotation.anchor) {
          omittedItems.push({ annotationId: annotation.id, reason: 'legacyUnverified' });
          continue;
        }
        const note = noteById.get(annotation.noteId);
        const resolution =
          annotation.anchorStatus && annotation.anchorStatus !== 'resolved'
            ? { status: annotation.anchorStatus, reason: annotation.anchorReason }
            : resolveAnchor(note.rawMarkdown, annotation.anchor);
        if (resolution.status !== 'resolved') {
          omittedItems.push({ annotationId: annotation.id, reason: resolution.reason });
          continue;
        }
        for (const segment of annotation.anchor.segments)
          contributions.push({ noteId: note.id, start: segment.start, end: segment.end, annotationId: annotation.id });
      }
    }

    for (const selection of normalized.selections) {
      const note = noteById.get(selection.noteId);
      if (!note) continue;
      const resolution = resolveAnchor(note.rawMarkdown, selection.anchor);
      if (resolution.status !== 'resolved') throw fail('ANNOTATION_ANCHOR_UNRESOLVED', '临时分析范围无法确认', 409);
      for (const segment of selection.anchor.segments)
        contributions.push({ noteId: note.id, start: segment.start, end: segment.end, annotationId: null });
    }

    const persistentExclusions = [];
    for (const annotation of annotations.filter(
      item => ['section', 'list'].includes(item.scopeType) && item.schemaVersion !== 3
    )) {
      for (const exclusion of exclusionRepository.list({ parentAnnotationId: annotation.id })) {
        if (normalized.overrideExclusionIds.includes(exclusion.id)) continue;
        if (exclusion.anchor?.unresolved)
          throw fail('ANNOTATION_EXCLUSION_CONFLICT', '局部排除位置待确认，请先修复排除范围', 409);
        const note = noteById.get(annotation.noteId);
        if (
          !note ||
          resolveAnchor(note.rawMarkdown, exclusion.anchor).status !== 'resolved' ||
          exclusion.anchor.sourceStart < annotation.anchor.sourceStart ||
          exclusion.anchor.sourceEnd > annotation.anchor.sourceEnd
        ) {
          throw fail('ANNOTATION_EXCLUSION_CONFLICT', '局部排除不在当前重点范围内，请先修复排除范围', 409);
        }
        persistentExclusions.push(
          ...exclusion.anchor.segments.map(segment => ({
            noteId: annotation.noteId,
            start: segment.start,
            end: segment.end,
            exclusionId: exclusion.id
          }))
        );
      }
    }
    const allExclusions = [
      ...persistentExclusions,
      ...inlineExclusions.filter(item => !normalized.overrideExclusionIds.includes(item.exclusionId)),
      ...normalized.onceExclusions
    ];
    const segments = buildResolvedSegments(contributions, allExclusions, noteById, versionByNote);
    if (segments.length === 0) throw fail('ANALYSIS_SCOPE_EMPTY', '当前选择没有可分析内容', 400);

    for (const { note } of noteVersions) {
      const projection = projectMarkdown(note.rawMarkdown);
      for (const unit of projection.units.filter(candidate => candidate.atomic)) {
        if (
          segments.some(
            segment => segment.noteId === note.id && segment.start < unit.sourceEnd && segment.end > unit.sourceStart
          )
        ) {
          omittedItems.push({
            noteId: note.id,
            sourceStart: unit.sourceStart,
            sourceEnd: unit.sourceEnd,
            reason: 'imageUnreadable'
          });
        }
      }
    }

    const result = {
      spaceId: normalized.spaceId,
      mode: normalized.mode,
      noteVersions: noteVersions.map(({ note, version }) => ({
        noteId: note.id,
        noteVersionId: version.id,
        contentHash: version.contentHash,
        title: note.title
      })),
      selections: normalized.selections,
      segments,
      contextSegments: [],
      exclusions: allExclusions,
      omittedItems,
      annotationRevisions: annotations.map(annotation => ({
        annotationId: annotation.id,
        revision: annotation.revision
      })),
      summary: { noteCount: notes.length, segmentCount: segments.length, annotationCount: annotations.length },
      ai: { available: false, message: '提炼服务暂不可用' }
    };
    return { ...result, previewHash: calculateContentHash(stableStringify(result)) };
  }

  function createAnalysisScope(input = {}) {
    const preview = previewAnalysisScope(input);
    if (!input.previewHash || input.previewHash !== preview.previewHash)
      throw fail('ANNOTATION_CONTENT_CONFLICT', '分析预览已过期，请刷新', 409);
    const idempotencyKey = String(input.idempotencyKey ?? '').trim();
    if (!idempotencyKey) throw fail('ANALYSIS_SCOPE_IDEMPOTENCY_REQUIRED', '分析范围幂等键不能为空', 400);
    const existing = analysisScopeRepository.findByIdempotencyKey(preview.spaceId, idempotencyKey);
    if (existing) {
      if (existing.inputHash !== preview.previewHash)
        throw fail('ANALYSIS_SCOPE_IDEMPOTENCY_CONFLICT', '同一幂等键不能保存不同范围', 409);
      return existing;
    }
    const { previewHash, ai: _ai, ...snapshotData } = preview;
    return analysisScopeRepository.save({
      id: newId('analysis-scope'),
      ...structuredClone(snapshotData),
      inputHash: previewHash,
      idempotencyKey,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null
    });
  }

  function getAnalysisScope(id, spaceId, includeDeleted = false) {
    const snapshot = analysisScopeRepository.findById(id);
    if (!snapshot || (spaceId && snapshot.spaceId !== spaceId) || (snapshot.deletedAt && !includeDeleted))
      throw fail('ANALYSIS_SCOPE_NOT_FOUND', '分析范围快照不存在', 404);
    return snapshot;
  }

  function listAnalysisScopes({ spaceId, includeDeleted = false } = {}) {
    if (!spaceId) throw fail('ANALYSIS_SCOPE_SPACE_REQUIRED', '缺少知识空间', 400);
    return analysisScopeRepository.list({
      spaceId,
      includeDeleted: includeDeleted === true || includeDeleted === 'true'
    });
  }

  function changeAnalysisScope(id, input, deleted) {
    const current = getAnalysisScope(id, input.spaceId, true);
    if (!input.expectedUpdatedAt || input.expectedUpdatedAt !== (current.updatedAt ?? current.createdAt))
      throw fail('ANALYSIS_SCOPE_UPDATE_CONFLICT', '分析范围已变化，请刷新后重试。', 409);
    if (Boolean(current.deletedAt) === deleted) return current;
    const next = {
      ...current,
      deletedAt: deleted ? new Date().toISOString() : null,
      updatedAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt ?? current.createdAt) + 1)).toISOString()
    };
    return analysisScopeRepository.update
      ? analysisScopeRepository.update(next, current.updatedAt ?? current.createdAt)
      : analysisScopeRepository.save(next);
  }

  return {
    previewAnnotation,
    createExclusion,
    deleteExclusion,
    getKnowledgeLinks,
    previewAnalysisScope,
    createAnalysisScope,
    getAnalysisScope,
    listAnalysisScopes,
    trashAnalysisScope: (id, input) => changeAnalysisScope(id, input, true),
    restoreAnalysisScope: (id, input) => changeAnalysisScope(id, input, false)
  };
}

export function normalizeScopeInput(input) {
  const spaceId = String(input.spaceId ?? '').trim();
  if (!spaceId) throw fail('ANALYSIS_SCOPE_SPACE_REQUIRED', '知识空间不能为空', 400);
  const mode = input.mode === 'all' ? 'all' : 'marked';
  return {
    spaceId,
    mode,
    noteIds: uniqueStrings(input.noteIds),
    annotationIds: uniqueStrings(input.annotationIds),
    overrideExclusionIds: uniqueStrings(input.overrideExclusionIds),
    selections: Array.isArray(input.selections) ? input.selections.filter(item => item?.noteId && item?.anchor) : [],
    onceExclusions: Array.isArray(input.onceExclusions) ? input.onceExclusions.filter(validInterval) : []
  };
}

/** v3（内联重点）：从正文标记算出片段；标记已从正文删除或代码段待确认时列为未纳入。 */
export function inlineContributions(annotation, note, contributions, exclusions, omittedItems) {
  if (annotation.anchorStatus && annotation.anchorStatus !== 'resolved') {
    omittedItems.push({ annotationId: annotation.id, reason: annotation.anchorReason ?? 'needsReview' });
    return;
  }
  const located = inlineAnnotationSourceRanges(note.rawMarkdown, annotation.anchor?.markId);
  if (!located?.ranges.length) {
    omittedItems.push({ annotationId: annotation.id, reason: 'sourceDeleted' });
    return;
  }
  for (const range of located.ranges)
    contributions.push({ noteId: note.id, start: range.start, end: range.end, annotationId: annotation.id });
  for (const range of located.excluded)
    exclusions.push({
      noteId: note.id,
      start: range.start,
      end: range.end,
      exclusionId: `inline:${annotation.anchor.markId}`
    });
}

export function buildResolvedSegments(contributions, exclusions, noteById, versionByNote) {
  const output = [];
  for (const noteId of new Set(contributions.map(item => item.noteId))) {
    const noteContributions = contributions.filter(item => item.noteId === noteId && validInterval(item));
    const boundaries = [
      ...new Set(
        noteContributions
          .flatMap(item => [item.start, item.end])
          .concat(exclusions.filter(item => item.noteId === noteId).flatMap(item => [item.start, item.end]))
      )
    ].sort((left, right) => left - right);
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const start = boundaries[index];
      const end = boundaries[index + 1];
      if (start === end) continue;
      const covering = noteContributions.filter(item => item.start < end && item.end > start);
      if (
        covering.length === 0 ||
        exclusions.some(item => item.noteId === noteId && item.start < end && item.end > start)
      )
        continue;
      const annotationIds = [...new Set(covering.map(item => item.annotationId).filter(Boolean))].sort();
      const previous = output.at(-1);
      if (
        previous &&
        previous.noteId === noteId &&
        previous.end === start &&
        arraysEqual(previous.annotationIds, annotationIds)
      ) {
        previous.end = end;
        previous.markdown += noteById.get(noteId).rawMarkdown.slice(start, end);
      } else {
        output.push({
          noteId,
          noteVersionId: versionByNote.get(noteId).id,
          start,
          end,
          markdown: noteById.get(noteId).rawMarkdown.slice(start, end),
          annotationIds
        });
      }
    }
  }
  return output;
}

function summarizeResolution(result) {
  return {
    status: result.status,
    reason: result.reason ?? null,
    quoteText: result.quoteText ?? null,
    candidates:
      result.candidates?.map(candidate => ({ sourceStart: candidate.sourceStart, sourceEnd: candidate.sourceEnd })) ??
      []
  };
}
function validInterval(item) {
  return item && Number.isInteger(item.start) && Number.isInteger(item.end) && item.start >= 0 && item.start < item.end;
}
function uniqueStrings(value) {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .map(String)
            .map(item => item.trim())
            .filter(Boolean)
        )
      ]
    : [];
}
function arraysEqual(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}
export function stableStringify(value) {
  return JSON.stringify(sortObject(value));
}
function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, sortObject(value[key])])
  );
}

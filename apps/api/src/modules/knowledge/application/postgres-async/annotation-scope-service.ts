import type {
  AsyncAnnotationScopeDependencies,
  ScopeInput,
  ScopeInterval,
  ScopeContribution,
  ScopeOmission,
  ScopeAnnotationView,
  ScopeExclusionView,
  ScopeResolutionView,
  ScopeNote
} from '../annotation-scope-types.ts';
import type { ContentAnchor } from '@study-accelerator/content-anchor';
import { legacyAnnotationRemoved } from '../content-annotation-service.ts';
import { resolveLegacyAnnotationAnchor } from '../legacy-annotation-anchor.ts';
import crypto from 'node:crypto';
import { calculateContentHash, projectMarkdown, resolveAnchor } from '@study-accelerator/content-anchor';
import { createAppError } from '../../../../errors/app-error.ts';
import {
  buildResolvedSegments,
  inlineContributions,
  normalizeScopeInput,
  stableStringify
} from '../annotation-scope-service.ts';

const fail = (code: string, message: string, statusCode = 400) => createAppError(code, message, statusCode);
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export function createAsyncAnnotationScopeService({
  annotationRepository,
  exclusionRepository,
  analysisScopeRepository,
  noteRepository,
  noteVersionRepository,
  evidenceRepository,
  knowledgeItemRepository
}: AsyncAnnotationScopeDependencies) {
  async function requireAnnotation(id: string) {
    const annotation = await annotationRepository.findById(id);
    if (!annotation) throw fail('ANNOTATION_NOT_FOUND', '标注不存在', 404);
    return annotation as ScopeAnnotationView;
  }
  async function requireNote(id: string) {
    const note = await noteRepository.findById(id);
    if (!note || note.deleted) throw fail('ANNOTATION_NOTE_NOT_FOUND', '笔记不存在', 404);
    if (note.contentKind === 'pdf')
      throw fail('PDF_ANALYSIS_UNSUPPORTED', '首版 PDF 尚不支持 AI 提炼或 Markdown 分析范围。', 422);
    return note;
  }
  async function requireVersion(note: ScopeNote) {
    const hash = calculateContentHash(note.rawMarkdown);
    const version = await noteVersionRepository.findByNoteIdAndContentHash(note.id, hash);
    if (!version) throw fail('ANNOTATION_VERSION_NOT_FOUND', '当前笔记版本尚未保存', 409);
    return version;
  }

  async function resolveLegacy(note: ScopeNote, anchor: Partial<ContentAnchor> | null | undefined, versionId: unknown) {
    const version = versionId ? await noteVersionRepository.findById(versionId as string) : null;
    return resolveLegacyAnnotationAnchor(
      note.rawMarkdown,
      anchor as ContentAnchor,
      version?.noteId === note.id ? (version!.content as string) : null
    );
  }

  async function previewAnnotation(id: string) {
    const annotation = await requireAnnotation(id);
    const note = await requireNote(annotation.noteId);
    // v3 的位置在正文标记里，状态由保存时派生。
    const resolution =
      annotation.schemaVersion === 3
        ? { status: annotation.anchorStatus ?? 'resolved', reason: annotation.anchorReason ?? null }
        : annotation.anchorStatus === 'resolved' && annotation.schemaVersion === 2 && annotation.anchor
          ? await resolveLegacy(note, annotation.anchor, annotation.noteVersionId)
          : { status: annotation.anchorStatus ?? 'needsReview', reason: annotation.anchorReason ?? 'legacyUnverified' };
    return {
      annotation,
      pendingRange: null,
      currentContentHash: calculateContentHash(note.rawMarkdown),
      resolution: summarizeResolution(resolution),
      exclusions: await exclusionRepository.list({ parentAnnotationId: id, includeDeleted: true })
    };
  }

  // 排除写在正文标记里（`<!--k- id-->`）；旧格式重点的排除不再新增或移除。
  async function createExclusion() {
    throw legacyAnnotationRemoved();
  }

  async function deleteExclusion() {
    throw legacyAnnotationRemoved();
  }

  async function getKnowledgeLinks(annotationId: string) {
    await requireAnnotation(annotationId);
    const evidence = await evidenceRepository.list({ annotationId });
    const links = (
      await Promise.all(
        evidence.map(async item => ({
          evidence: item,
          knowledgeItem: await knowledgeItemRepository.findById(item.knowledgeItemId)
        }))
      )
    ).filter(item => item.knowledgeItem);
    return {
      annotationId,
      candidates: links.filter(item => item.knowledgeItem!.reviewStatus === 'candidate'),
      confirmed: links.filter(item => item.knowledgeItem!.reviewStatus === 'confirmed'),
      evidenceStatus: links.map(item => ({ id: item.evidence.id, status: item.evidence.status }))
    };
  }

  async function previewAnalysisScope(input: ScopeInput = {}) {
    const normalized = normalizeScopeInput(input);
    const annotations = await Promise.all(normalized.annotationIds.map(requireAnnotation));
    const noteIds = new Set(normalized.noteIds);
    annotations.forEach(annotation => noteIds.add(annotation.noteId));
    normalized.selections.forEach(selection => noteIds.add(selection.noteId));
    if (noteIds.size === 0) throw fail('ANALYSIS_SCOPE_EMPTY', '请选择至少一篇笔记或一个重点范围', 400);
    const notes = await Promise.all([...noteIds].map(requireNote));
    if (notes.some(note => note.spaceId !== normalized.spaceId))
      throw fail('ANNOTATION_SPACE_MISMATCH', '分析范围包含其他知识空间', 409);
    const noteVersions = await Promise.all(notes.map(async note => ({ note, version: await requireVersion(note) })));
    const versionByNote = new Map(noteVersions.map(item => [item.note.id, item.version]));
    const noteById = new Map(notes.map(note => [note.id, note]));
    const omittedItems: ScopeOmission[] = [];
    const contributions: ScopeContribution[] = [];
    const inlineExclusions: ScopeInterval[] = [];

    if (normalized.mode === 'all') {
      for (const note of notes)
        if (note.rawMarkdown.length > 0)
          contributions.push({ noteId: note.id, start: 0, end: note.rawMarkdown.length, annotationId: null });
    } else {
      for (const annotation of annotations) {
        if (annotation.lifecycleStatus !== 'active') continue;
        if (annotation.scopeType === 'list' && annotation.anchor?.tracking?.empty)
          throw fail('ANALYSIS_SCOPE_EMPTY', '空列表项不能用于分析', 409);
        if (annotation.schemaVersion === 3) {
          inlineContributions(
            annotation,
            noteById.get(annotation.noteId)!,
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
        const resolution =
          annotation.anchorStatus && annotation.anchorStatus !== 'resolved'
            ? { status: annotation.anchorStatus, reason: annotation.anchorReason, segments: [] }
            : await resolveLegacy(noteById.get(annotation.noteId)!, annotation.anchor, annotation.noteVersionId);
        if (resolution.status !== 'resolved') {
          omittedItems.push({ annotationId: annotation.id, reason: resolution.reason });
          continue;
        }
        for (const segment of resolution.segments ?? [])
          contributions.push({
            noteId: annotation.noteId,
            start: segment.start,
            end: segment.end,
            annotationId: annotation.id
          });
      }
    }
    for (const selection of normalized.selections) {
      const note = noteById.get(selection.noteId)!;
      const resolution = resolveAnchor(note.rawMarkdown, selection.anchor);
      if (resolution.status !== 'resolved') throw fail('ANNOTATION_ANCHOR_UNRESOLVED', '临时分析范围无法确认', 409);
      for (const segment of selection.anchor.segments)
        contributions.push({ noteId: note.id, start: segment.start, end: segment.end, annotationId: null });
    }

    const persistentExclusions: ScopeInterval[] = [];
    for (const annotation of annotations.filter(
      item => ['section', 'list'].includes(item.scopeType) && item.schemaVersion !== 3
    )) {
      for (const exclusion of (await exclusionRepository.list({
        parentAnnotationId: annotation.id
      })) as unknown as ScopeExclusionView[]) {
        if (normalized.overrideExclusionIds.includes(exclusion.id)) continue;
        if (exclusion.anchor?.unresolved)
          throw fail('ANNOTATION_EXCLUSION_CONFLICT', '局部排除位置待确认，请先修复排除范围', 409);
        const note = noteById.get(annotation.noteId)!;
        const sourceVersionId = exclusion.noteVersionId ?? annotation.noteVersionId;
        const parent = note && (await resolveLegacy(note, annotation.anchor, annotation.noteVersionId));
        const excluded = note && (await resolveLegacy(note, exclusion.anchor, sourceVersionId));
        const parentStart = parent?.segments?.[0]?.start;
        const parentEnd = parent?.segments?.at(-1)?.end;
        if (
          !note ||
          parent?.status !== 'resolved' ||
          excluded?.status !== 'resolved' ||
          parentStart === undefined ||
          parentEnd === undefined ||
          !excluded.segments?.length ||
          excluded.segments.some(segment => segment.start < parentStart || segment.end > parentEnd)
        ) {
          throw fail('ANNOTATION_EXCLUSION_CONFLICT', '局部排除不在当前重点范围内，请先修复排除范围', 409);
        }
        persistentExclusions.push(
          ...(excluded.segments ?? []).map(segment => ({
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
      ...inlineExclusions.filter(item => !normalized.overrideExclusionIds.includes(item.exclusionId as string)),
      ...normalized.onceExclusions
    ];
    const segments = buildResolvedSegments(contributions, allExclusions, noteById, versionByNote);
    if (segments.length === 0) throw fail('ANALYSIS_SCOPE_EMPTY', '当前选择没有可分析内容', 400);
    for (const note of notes) {
      const projection = projectMarkdown(note.rawMarkdown);
      for (const unit of projection.units.filter(candidate => candidate.atomic)) {
        if (
          segments.some(
            segment =>
              segment.noteId === note.id &&
              segment.start < (unit.sourceEnd as number) &&
              segment.end > (unit.sourceStart as number)
          )
        )
          omittedItems.push({
            noteId: note.id,
            sourceStart: unit.sourceStart,
            sourceEnd: unit.sourceEnd,
            reason: 'imageUnreadable'
          });
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

  async function createAnalysisScope(input: ScopeInput = {}) {
    const preview = await previewAnalysisScope(input);
    if (!input.previewHash || input.previewHash !== preview.previewHash)
      throw fail('ANNOTATION_CONTENT_CONFLICT', '分析预览已过期，请刷新', 409);
    const idempotencyKey = String(input.idempotencyKey ?? '').trim();
    if (!idempotencyKey) throw fail('ANALYSIS_SCOPE_IDEMPOTENCY_REQUIRED', '分析范围幂等键不能为空', 400);
    const existing = await analysisScopeRepository.findByIdempotencyKey(preview.spaceId, idempotencyKey);
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

  async function getAnalysisScope(id: string, spaceId?: unknown, includeDeleted = false) {
    const snapshot = await analysisScopeRepository.findById(id);
    if (!snapshot || (spaceId && snapshot.spaceId !== spaceId) || (snapshot.deletedAt && !includeDeleted))
      throw fail('ANALYSIS_SCOPE_NOT_FOUND', '分析范围快照不存在', 404);
    return snapshot;
  }

  /** @param {{ spaceId?: string, includeDeleted?: boolean | string }} options */
  async function listAnalysisScopes({
    spaceId,
    includeDeleted = false
  }: { spaceId?: string; includeDeleted?: boolean | string } = {}) {
    if (!spaceId) throw fail('ANALYSIS_SCOPE_SPACE_REQUIRED', '缺少知识空间', 400);
    return analysisScopeRepository.list({
      spaceId,
      includeDeleted: includeDeleted === true || includeDeleted === 'true'
    });
  }

  async function changeAnalysisScope(id: string, input: ScopeInput, deleted: boolean) {
    const current = await getAnalysisScope(id, input.spaceId, true);
    if (!input.expectedUpdatedAt || input.expectedUpdatedAt !== (current.updatedAt ?? current.createdAt))
      throw fail('ANALYSIS_SCOPE_UPDATE_CONFLICT', '分析范围已变化，请刷新后重试。', 409);
    if (Boolean(current.deletedAt) === deleted) return current;
    const next = {
      ...current,
      deletedAt: deleted ? new Date().toISOString() : null,
      updatedAt: new Date(
        Math.max(Date.now(), Date.parse((current.updatedAt ?? current.createdAt) as string) + 1)
      ).toISOString()
    };
    return analysisScopeRepository.update(next, current.updatedAt ?? current.createdAt);
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
    trashAnalysisScope: (id: string, input: ScopeInput) => changeAnalysisScope(id, input, true),
    restoreAnalysisScope: (id: string, input: ScopeInput) => changeAnalysisScope(id, input, false)
  };
}

function summarizeResolution(result: ScopeResolutionView) {
  return {
    status: result.status,
    reason: result.reason ?? null,
    quoteText: result.quoteText ?? null,
    candidates:
      result.candidates?.map(candidate => ({ sourceStart: candidate.sourceStart, sourceEnd: candidate.sourceEnd })) ??
      []
  };
}

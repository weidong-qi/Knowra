import { sameKnowraText } from '@study-accelerator/shared/knowra-marks';
import { matchesKnowledgeCandidateRequest } from './knowledge-candidate-retry.js';
import { assertKnowledgeItemBaseline, nextKnowledgeItemTimestamp } from './knowledge-item-concurrency.js';
import { KnowledgeItem } from '../domain/knowledge-item.ts';
import { KnowledgeEvidence } from '../domain/knowledge-evidence.ts';
import { isEvidenceUsable, legacyEvidenceApplicability } from '../domain/evidence-applicability.ts';
import { deriveEvidenceHealth } from '../domain/evidence-health.ts';
import {
  buildCreateKnowledgeEvidenceDto,
  buildCreateKnowledgeItemDto,
  buildUpdateKnowledgeItemDto
} from './dto/knowledge-item.dto.ts';
import { assertKnowledgeItemConfirmable } from './formal-asset-validation.ts';
import { conflictError, notFoundError, validationError } from './knowledge-errors.js';

const now = () => new Date().toISOString();

/** @param {import('./service-dependencies.ts').KnowledgeItemDependencies} dependencies */
export function createKnowledgeItemService({
  repository,
  evidenceRepository,
  noteVersionRepository,
  annotationRepository,
  noteRepository,
  getTombstone = null,
  onItemInvalidated = null,
  runTransaction = operation => operation()
} = {}) {
  if (!repository || !evidenceRepository) throw new TypeError('KnowledgeItem repositories are required');

  function requireItem(id) {
    const item = /** @type {import('../domain/knowledge-item.ts').KnowledgeItem} */ (repository.findById(id));
    if (!item || item.deletedAt) throw notFoundError('KNOWLEDGE_ITEM_NOT_FOUND', 'KnowledgeItem not found');
    return item;
  }

  function assertItemIdAvailable(id) {
    if (getTombstone?.('knowledgeItems', id)) {
      throw conflictError('KNOWLEDGE_ITEM_ID_DELETED', '已永久删除的知识点 ID 不能重新使用');
    }
    if (repository.findById(id)) {
      throw conflictError('KNOWLEDGE_ITEM_ID_CONFLICT', 'A KnowledgeItem with the same id already exists');
    }
  }

  function assertEvidenceIdAvailable(id) {
    if (getTombstone?.('knowledgeEvidence', id)) {
      throw conflictError('KNOWLEDGE_EVIDENCE_ID_DELETED', '已永久删除的来源 ID 不能重新使用');
    }
    if (evidenceRepository.findById(id)) {
      throw conflictError('KNOWLEDGE_EVIDENCE_ID_CONFLICT', 'KnowledgeEvidence with the same id already exists');
    }
  }

  function saveNew(targetRepository, record) {
    return targetRepository.create?.(record) ?? targetRepository.save(record);
  }

  function notifyIfInvalidated(previous, next) {
    if (previous?.reviewStatus === 'confirmed' && (next?.reviewStatus !== 'confirmed' || next?.deletedAt)) {
      onItemInvalidated?.(next.id);
    }
  }

  function resolveEvidence(input, knowledgeItemId) {
    const dto = buildCreateKnowledgeEvidenceDto(input);
    assertEvidenceIdAvailable(dto.id);
    let noteId = dto.noteId;
    let noteVersionId = dto.noteVersionId;
    let annotationId = dto.annotationId;
    let annotation = null;
    let version = null;
    let status = 'valid';
    if (dto.sourceType === 'noteVersion') {
      version = noteVersionRepository?.findById(noteVersionId);
      if (!version) throw notFoundError('NOTE_VERSION_NOT_FOUND', 'NoteVersion not found');
      if (noteId && noteId !== version.noteId)
        throw conflictError('KNOWLEDGE_EVIDENCE_NOTE_MISMATCH', 'Evidence note does not match NoteVersion');
      noteId = version.noteId;
    }
    if (dto.sourceType === 'annotation') {
      annotation = annotationRepository?.findById(annotationId);
      if (!annotation) throw notFoundError('ANNOTATION_NOT_FOUND', 'Annotation not found');
      if (
        dto.expectedAnnotationRevision !== undefined &&
        dto.expectedAnnotationRevision !== (annotation.revision ?? 1)
      ) {
        throw conflictError('KNOWLEDGE_EVIDENCE_REVISION_CONFLICT', '标注已变化，请重新打开候选创建面板并核对来源。');
      }
      if (noteId && noteId !== annotation.noteId)
        throw conflictError('KNOWLEDGE_EVIDENCE_NOTE_MISMATCH', 'Evidence note does not match annotation');
      noteId = annotation.noteId;
      if (dto.noteVersionId && annotation.noteVersionId && dto.noteVersionId !== annotation.noteVersionId) {
        throw conflictError('KNOWLEDGE_EVIDENCE_VERSION_MISMATCH', '标注来源版本已变化，请重新加载标注。');
      }
      noteVersionId = annotation.noteVersionId ?? noteVersionId;
      if (!noteVersionId)
        throw validationError(
          'KNOWLEDGE_EVIDENCE_VERSION_REQUIRED',
          'Annotation evidence requires a NoteVersion-bound annotation'
        );
      version = noteVersionRepository?.findById(noteVersionId);
      if (!version) throw notFoundError('NOTE_VERSION_NOT_FOUND', 'NoteVersion not found');
      if (version.noteId !== noteId) {
        throw conflictError(
          'KNOWLEDGE_EVIDENCE_NOTE_MISMATCH',
          'Annotation and NoteVersion must reference the same note'
        );
      }
      if (annotation.lifecycleStatus !== 'active')
        throw conflictError('ANNOTATION_NOT_ACTIVE', '已删除或归档的标注不能用于新建知识来源');
      if (annotation.anchorStatus === 'missing') status = 'insufficient';
      else if (annotation.anchorStatus === 'needsReview' || annotation.status === 'stale') status = 'stale';
    }
    if (noteId && noteRepository) {
      const note = noteRepository.findById(noteId);
      if (!note) throw notFoundError('NOTE_NOT_FOUND', 'Note not found');
      if (note.deleted) status = 'invalid';
      else if (
        dto.sourceType === 'noteVersion' &&
        version &&
        !sameKnowraText(version.content, note.rawMarkdown) &&
        status !== 'invalid'
      ) {
        status = 'stale';
      }
    }
    return new KnowledgeEvidence({
      ...dto,
      id: dto.id,
      knowledgeItemId,
      noteId,
      noteVersionId,
      annotationId,
      sourceId: annotationId ?? noteVersionId ?? dto.sourceId,
      quoteText: annotation?.quoteText ?? dto.quoteText,
      headingPath: annotation?.headingPath ?? dto.headingPath,
      status,
      createdAt: now(),
      updatedAt: now()
    });
  }

  function createCandidate(input = {}) {
    const dto = buildCreateKnowledgeItemDto(input);
    const evidenceInputs = Array.isArray(input.evidence) ? input.evidence : [];
    if (input.id) {
      const existing = repository.findById(dto.id);
      if (existing) {
        const evidence = evidenceRepository.list({ knowledgeItemId: dto.id });
        if (matchesKnowledgeCandidateRequest(existing, dto, evidence, evidenceInputs))
          return { item: existing, evidence };
      }
    }
    assertItemIdAvailable(dto.id);
    if (dto.sourceMode !== 'manual' && evidenceInputs.length === 0) {
      throw validationError('KNOWLEDGE_EVIDENCE_REQUIRED', 'A non-manual KnowledgeItem candidate requires evidence');
    }
    const created = runTransaction(() => {
      assertItemIdAvailable(dto.id);
      const resolved = evidenceInputs.map(evidenceInput => resolveEvidence(evidenceInput, dto.id));
      if (new Set(resolved.map(record => record.id)).size !== resolved.length) {
        throw conflictError('KNOWLEDGE_EVIDENCE_ID_CONFLICT', '同一候选不能包含重复的来源 ID。');
      }
      const item = saveNew(repository, new KnowledgeItem({ ...dto, id: dto.id }));
      const evidence = resolved.map(record => saveNew(evidenceRepository, record));
      return { item, evidence };
    });
    return created;
  }

  function listEvidence(knowledgeItemId) {
    if (!repository.findById(knowledgeItemId))
      throw notFoundError('KNOWLEDGE_ITEM_NOT_FOUND', 'KnowledgeItem not found');
    return evidenceRepository.list({ knowledgeItemId }).map(record => ({
      ...record,
      sourceAnnotationRemoved: Boolean(
        record.annotationId && annotationRepository?.findById(record.annotationId)?.lifecycleStatus === 'deleted'
      )
    }));
  }

  function updateItem(id, input = {}) {
    const current = requireItem(id);
    assertKnowledgeItemBaseline(current, input);
    const dto = /** @type {Partial<import('../domain/knowledge-item.ts').KnowledgeItemConstructorInput>} */ (
      buildUpdateKnowledgeItemDto(input)
    );
    const textChanged = ['title', 'canonicalStatement', 'userExplanation'].some(
      field => Object.hasOwn(dto, field) && dto[field] !== current[field]
    );
    const nextStatus = current.reviewStatus === 'confirmed' && textChanged ? 'needsRevision' : current.reviewStatus;
    return runTransaction(() => {
      const next = repository.save(
        new KnowledgeItem({
          ...current,
          ...dto,
          reviewStatus: nextStatus,
          updatedAt: nextKnowledgeItemTimestamp(current)
        }),
        { expectedUpdatedAt: current.updatedAt }
      );
      notifyIfInvalidated(current, next);
      return next;
    });
  }

  function confirmItem(id, input = {}) {
    const item = requireItem(id);
    assertKnowledgeItemBaseline(item, input);
    const evidence = evidenceRepository.list({ knowledgeItemId: id });
    assertKnowledgeItemConfirmable(item, evidence);
    return repository.save(
      new KnowledgeItem({ ...item, reviewStatus: 'confirmed', updatedAt: nextKnowledgeItemTimestamp(item) }),
      { expectedUpdatedAt: item.updatedAt }
    );
  }

  function markNeedsRevision(id, input = {}) {
    const current = requireItem(id);
    assertKnowledgeItemBaseline(current, input);
    return runTransaction(() => {
      const next = repository.save(
        new KnowledgeItem({
          ...current,
          reviewStatus: 'needsRevision',
          updatedAt: nextKnowledgeItemTimestamp(current)
        }),
        { expectedUpdatedAt: current.updatedAt }
      );
      notifyIfInvalidated(current, next);
      return next;
    });
  }

  function archive(id, input = {}) {
    const current = requireItem(id);
    assertKnowledgeItemBaseline(current, input);
    return runTransaction(() => {
      const next = repository.save(
        new KnowledgeItem({ ...current, reviewStatus: 'archived', updatedAt: nextKnowledgeItemTimestamp(current) }),
        { expectedUpdatedAt: current.updatedAt }
      );
      notifyIfInvalidated(current, next);
      return next;
    });
  }

  function restore(id, input = {}) {
    const current = requireItem(id);
    assertKnowledgeItemBaseline(current, input);
    if (current.reviewStatus !== 'archived') return current;
    return repository.save(
      new KnowledgeItem({ ...current, reviewStatus: 'candidate', updatedAt: nextKnowledgeItemTimestamp(current) }),
      { expectedUpdatedAt: current.updatedAt }
    );
  }

  function trash(id, input = {}) {
    const current = requireItem(id);
    assertKnowledgeItemBaseline(current, input);
    return runTransaction(() => {
      const next = repository.save(
        new KnowledgeItem({ ...current, deletedAt: now(), updatedAt: nextKnowledgeItemTimestamp(current) }),
        { expectedUpdatedAt: current.updatedAt }
      );
      notifyIfInvalidated(current, next);
      return next;
    });
  }

  function restoreDeleted(id, input = {}) {
    const current = repository.findById(id);
    if (!current || !current.deletedAt) throw notFoundError('KNOWLEDGE_ITEM_NOT_IN_TRASH', '知识点不在回收站中');
    assertKnowledgeItemBaseline(current, input);
    const evidence = evidenceRepository.list({ knowledgeItemId: id });
    const reviewStatus =
      current.reviewStatus === 'confirmed' && current.sourceMode !== 'manual' && !evidence.some(isEvidenceUsable)
        ? 'needsRevision'
        : current.reviewStatus;
    return repository.save(
      new KnowledgeItem({ ...current, deletedAt: null, reviewStatus, updatedAt: nextKnowledgeItemTimestamp(current) }),
      { expectedUpdatedAt: current.updatedAt }
    );
  }

  return {
    createCandidate,
    getItem: requireItem,
    listItems(options = {}) {
      const items = repository.list(options);
      if (!options.noteId) return items;
      const evidenceByItem = new Map();
      for (const evidence of evidenceRepository.list({ noteId: options.noteId })) {
        const records = evidenceByItem.get(evidence.knowledgeItemId) ?? [];
        records.push(evidence);
        evidenceByItem.set(evidence.knowledgeItemId, records);
      }
      return items
        .filter(item => evidenceByItem.has(item.id))
        .map(item => {
          const evidence = evidenceByItem.get(item.id);
          return {
            ...item,
            evidenceStatus: summarizeEvidenceStatus(evidence.map(record => record.status)),
            evidenceSummary: evidence.map(toEvidenceSummary)
          };
        });
    },
    updateItem,
    confirmItem,
    markNeedsRevision,
    archive,
    restore,
    trash,
    restoreDeleted,
    listEvidence,
    createEvidence(input) {
      const item = requireItem(input.knowledgeItemId);
      return runTransaction(() => saveNew(evidenceRepository, resolveEvidence(input, item.id)));
    },
    retireEvidence(knowledgeItemId, evidenceId, input = {}) {
      const currentItem = requireItem(knowledgeItemId);
      const currentEvidence = /** @type {import('../domain/knowledge-evidence.ts').KnowledgeEvidence} */ (
        evidenceRepository.findById(evidenceId)
      );
      if (!currentEvidence || currentEvidence.knowledgeItemId !== knowledgeItemId) {
        throw notFoundError('KNOWLEDGE_EVIDENCE_NOT_FOUND', 'KnowledgeEvidence not found');
      }
      if (input.expectedUpdatedAt && input.expectedUpdatedAt !== currentEvidence.updatedAt) {
        throw conflictError('KNOWLEDGE_EVIDENCE_UPDATE_CONFLICT', '知识来源已变化，请重新加载后再操作。');
      }
      return runTransaction(() => {
        const evidence =
          currentEvidence.applicabilityStatus === 'withdrawn'
            ? currentEvidence
            : evidenceRepository.save(
                new KnowledgeEvidence({
                  ...currentEvidence,
                  applicabilityStatus: 'withdrawn',
                  updatedAt: now()
                })
              );
        let item = currentItem;
        const remaining = evidenceRepository.list({ knowledgeItemId });
        if (item.reviewStatus === 'confirmed' && item.sourceMode !== 'manual' && !remaining.some(isEvidenceUsable)) {
          item = repository.save(
            new KnowledgeItem({
              ...item,
              reviewStatus: 'needsRevision',
              updatedAt: nextKnowledgeItemTimestamp(item)
            }),
            { expectedUpdatedAt: item.updatedAt }
          );
          notifyIfInvalidated(currentItem, item);
        }
        return { item, evidence };
      });
    },
    readoptEvidence(knowledgeItemId, evidenceId, input = {}) {
      const item = requireItem(knowledgeItemId);
      const current = /** @type {import('../domain/knowledge-evidence.ts').KnowledgeEvidence} */ (
        evidenceRepository.findById(evidenceId)
      );
      if (!current || current.knowledgeItemId !== knowledgeItemId)
        throw notFoundError('KNOWLEDGE_EVIDENCE_NOT_FOUND', 'KnowledgeEvidence not found');
      if (input.expectedUpdatedAt && input.expectedUpdatedAt !== current.updatedAt)
        throw conflictError('KNOWLEDGE_EVIDENCE_UPDATE_CONFLICT', '知识来源已变化，请重新加载后再操作。');
      const version = current.noteVersionId ? noteVersionRepository?.findById(current.noteVersionId) : null;
      if (
        current.status !== 'valid' ||
        (current.sourceType !== 'manual' &&
          (!version ||
            version.noteId !== current.noteId ||
            !(/** @type {string} */ (version.content).includes(current.quoteText))))
      ) {
        throw conflictError('KNOWLEDGE_EVIDENCE_NOT_VERIFIABLE', '来源当前不可独立复核，不能重新采用。');
      }
      const evidence = evidenceRepository.save(
        new KnowledgeEvidence({ ...current, applicabilityStatus: 'active', updatedAt: now() })
      );
      return { item, evidence };
    },
    /** @param {string} noteId @param {import('../domain/knowledge-evidence.ts').KnowledgeEvidence['status']} status */
    markEvidenceByNoteId(noteId, status = 'invalid') {
      return markEvidenceAndReconcile(() => evidenceRepository.markByNoteId(noteId, status));
    },
    /** @param {string} annotationId @param {import('../domain/knowledge-evidence.ts').KnowledgeEvidence['status']} status */
    markEvidenceByAnnotationId(annotationId, status = 'invalid') {
      return markEvidenceAndReconcile(() => evidenceRepository.markByAnnotationId(annotationId, status));
    },
    /** @param {string[]} annotationIds */
    reconcileEvidenceByAnnotationIds(annotationIds) {
      return runTransaction(() => {
        const versions = new Map();
        const affected = [];
        markEvidenceAndReconcile(() => {
          const changed = [];
          for (const annotationId of new Set(annotationIds)) {
            const annotation = annotationRepository?.findById(annotationId);
            if (!annotation) throw notFoundError('ANNOTATION_NOT_FOUND', 'Annotation not found');
            if (typeof annotation.noteId !== 'string') throw notFoundError('NOTE_NOT_FOUND', 'Note not found');
            const note = noteRepository?.findById(annotation.noteId);
            if (!note) throw notFoundError('NOTE_NOT_FOUND', 'Note not found');
            for (const evidence of evidenceRepository.list({ annotationId })) {
              if (evidence.noteVersionId && !versions.has(evidence.noteVersionId)) {
                const version = noteVersionRepository?.findById(evidence.noteVersionId);
                if (!version) throw notFoundError('NOTE_VERSION_NOT_FOUND', 'NoteVersion not found');
                versions.set(evidence.noteVersionId, version);
              }
              const version = evidence.noteVersionId ? versions.get(evidence.noteVersionId) : null;
              const status = deriveEvidenceHealth(evidence, { annotation, note, version });
              if (status === evidence.status) {
                affected.push(evidence);
                continue;
              }
              const saved = evidenceRepository.save({
                ...evidence,
                status,
                applicabilityStatus:
                  /** @type {import('../domain/knowledge-evidence.ts').KnowledgeEvidence['applicabilityStatus']} */ (
                    legacyEvidenceApplicability(evidence)
                  ),
                updatedAt: now()
              });
              affected.push(saved);
              changed.push(saved);
            }
          }
          return changed;
        });
        return affected;
      });
    },
    /** @param {string} noteVersionId @param {import('../domain/knowledge-evidence.ts').KnowledgeEvidence['status']} status @param {import('../domain/knowledge-evidence.ts').KnowledgeEvidence['sourceType']} [sourceType] */
    markEvidenceByNoteVersionId(noteVersionId, status = 'stale', sourceType = null) {
      return markEvidenceAndReconcile(() => evidenceRepository.markByNoteVersionId(noteVersionId, status, sourceType));
    },
    /** @param {string[]} noteVersionIds @param {import('../domain/knowledge-evidence.ts').KnowledgeEvidence['status']} status @param {import('../domain/knowledge-evidence.ts').KnowledgeEvidence['sourceType']} [sourceType] */
    markEvidenceByNoteVersionIds(noteVersionIds, status = 'stale', sourceType = null) {
      return markEvidenceAndReconcile(() =>
        evidenceRepository.markByNoteVersionIds(noteVersionIds, status, sourceType)
      );
    }
  };

  function markEvidenceAndReconcile(markEvidence) {
    return runTransaction(() => {
      const changed = markEvidence();
      for (const knowledgeItemId of new Set(changed.map(record => record.knowledgeItemId))) {
        const current = repository.findById(knowledgeItemId);
        if (!current || current.reviewStatus !== 'confirmed' || current.sourceMode === 'manual') {
          continue;
        }
        const evidence = evidenceRepository.list({ knowledgeItemId });
        if (evidence.some(isEvidenceUsable)) continue;
        const next = repository.save(
          new KnowledgeItem({
            ...current,
            reviewStatus: 'needsRevision',
            updatedAt: nextKnowledgeItemTimestamp(current)
          }),
          { expectedUpdatedAt: current.updatedAt }
        );
        notifyIfInvalidated(current, next);
      }
      return changed;
    });
  }
}

function summarizeEvidenceStatus(statuses = []) {
  if (statuses.includes('invalid')) return 'invalid';
  if (statuses.includes('stale')) return 'stale';
  if (statuses.includes('insufficient')) return 'insufficient';
  return statuses.length ? 'valid' : 'insufficient';
}

function toEvidenceSummary(evidence) {
  return {
    sourceType: evidence.sourceType,
    sourceId: evidence.sourceId,
    noteVersionId: evidence.noteVersionId,
    annotationId: evidence.annotationId,
    quoteText: evidence.quoteText,
    status: evidence.status
  };
}

import { KnowledgeItem } from '../knowledge/domain/knowledge-item.js';
import { KnowledgeEvidence } from '../knowledge/domain/knowledge-evidence.js';
import {
  buildCreateKnowledgeItemDto,
  buildCreateKnowledgeEvidenceDto
} from '../knowledge/application/dto/knowledge-item.dto.js';
import { assertKnowledgeItemConfirmable } from '../knowledge/application/formal-asset-validation.js';
import { sameEntity } from './entity-contract.ts';
import { syncError } from './journal.ts';

export function normalizeKnowledgeChange(collection, value, previous) {
  if (!['knowledgeItems', 'knowledgeEvidence'].includes(collection)) return value;
  if (!value) throw syncError('SYNC_KNOWLEDGE_DELETE_UNSUPPORTED', '知识与来源不能通过同步永久删除，请使用归档。', 422);
  if (collection === 'knowledgeItems') {
    return { ...new KnowledgeItem({ ...value, ...buildCreateKnowledgeItemDto(value) }) };
  }
  return { ...new KnowledgeEvidence({ ...value, ...buildCreateKnowledgeEvidenceDto(value) }) };
}

export function validateKnowledgeLifecycleChange(change, previous) {
  const { collection, value, lifecycleAction } = change;
  if (!value || !previous) return;
  if (collection === 'knowledgeItems') {
    const action =
      !previous.deletedAt && value.deletedAt ? 'trash' : previous.deletedAt && !value.deletedAt ? 'restore' : null;
    if (action !== (lifecycleAction ?? null))
      throw syncError('SYNC_LIFECYCLE_ACTION_REQUIRED', '知识回收站操作需要显式动作和版本基线。', 422);
  }
  if (collection === 'knowledgeEvidence') {
    const prior = previous.applicabilityStatus ?? (previous.status === 'invalid' ? 'needsReview' : 'active');
    const next = value.applicabilityStatus ?? (value.status === 'invalid' ? 'needsReview' : 'active');
    const action = prior === next ? null : next === 'withdrawn' ? 'withdraw' : next === 'active' ? 'readopt' : null;
    if (action !== (lifecycleAction ?? null))
      throw syncError('SYNC_LIFECYCLE_ACTION_REQUIRED', '来源适用性操作需要显式动作和版本基线。', 422);
    if (
      previous.createdAt !== value.createdAt ||
      !sameEntity(collection, { ...previous, applicabilityStatus: null }, { ...value, applicabilityStatus: null })
    )
      throw syncError('SYNC_IMMUTABLE', '来源历史摘录不可覆盖。', 422);
    if (action === 'readopt' && value.status !== 'valid')
      throw syncError('KNOWLEDGE_EVIDENCE_NOT_VERIFIABLE', '来源未通过健康校验，不能重新采用。', 422);
  }
}

/** 来源是不可变证据，只有健康状态可由云端重算；不能用客户端 status 绕过确认门槛。 */
export function validateKnowledgeBatch(before, state, changes) {
  for (const change of changes.filter(entry => entry.collection === 'knowledgeEvidence' && entry.value)) {
    if (before.knowledgeEvidence.some(entry => entry.id === change.id)) continue;
    const evidence = state.knowledgeEvidence.find(entry => entry.id === change.id);
    const annotation = state.contentAnnotations.find(entry => entry.id === evidence.annotationId);
    const version = state.noteVersions.find(entry => entry.id === evidence.noteVersionId);
    if (evidence.sourceType === 'annotation') {
      const historical = [
        annotation?.originSnapshot,
        ...state.annotationRevisions
          .filter(entry => entry.annotationId === evidence.annotationId)
          .map(entry => ({
            noteVersionId: entry.newAnchor?.noteVersionId,
            quoteText: entry.rangeSummary?.quoteText
          }))
      ].some(
        snapshot =>
          snapshot?.noteVersionId === evidence.noteVersionId &&
          String(snapshot.quoteText ?? '').trim() === evidence.quoteText
      );
      const current =
        annotation &&
        evidence.noteVersionId === annotation.noteVersionId &&
        evidence.quoteText === String(annotation.quoteText).trim() &&
        JSON.stringify(evidence.headingPath) === JSON.stringify(annotation.headingPath ?? []);
      if (
        !annotation ||
        !version ||
        evidence.noteId !== annotation.noteId ||
        version.noteId !== annotation.noteId ||
        evidence.sourceId !== annotation.id ||
        (!current && !historical)
      ) {
        throw syncError('KNOWLEDGE_EVIDENCE_SOURCE_CONFLICT', '标注来源已变化或证据快照不一致，请重新核对来源。', 422);
      }
    }
    if (
      evidence.sourceType === 'noteVersion' &&
      (!version || evidence.noteId !== version.noteId || evidence.sourceId !== version.id)
    ) {
      throw syncError('KNOWLEDGE_EVIDENCE_SOURCE_CONFLICT', '证据与笔记版本不一致，请重新核对来源。', 422);
    }
  }
  for (const change of changes.filter(entry => entry.collection === 'knowledgeItems' && entry.value)) {
    const item = state.knowledgeItems.find(entry => entry.id === change.id);
    const evidence = state.knowledgeEvidence.filter(entry => entry.knowledgeItemId === item.id);
    if (item.sourceMode !== 'manual' && !evidence.length)
      throw syncError('KNOWLEDGE_EVIDENCE_REQUIRED', '非手动知识必须包含来源证据。', 422);
    if (change.value.reviewStatus === 'confirmed' && !item.deletedAt) assertKnowledgeItemConfirmable(item, evidence);
  }
}

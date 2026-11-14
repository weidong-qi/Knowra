import { createAppError } from '../../../errors/app-error.ts';

export interface KnowledgePurgeItem {
  id: string;
  updatedAt?: unknown;
  deletedAt?: unknown;
}
export interface KnowledgePurgeExclusiveRecord {
  id: string;
}
export interface KnowledgePurgeObjectiveReference {
  id: unknown;
  knowledgeItemId?: unknown;
}
export interface KnowledgePurgeQuestionReference {
  id: unknown;
  sourceType?: unknown;
  sourceId?: unknown;
}
export interface KnowledgePurgeScopeReference {
  id?: unknown;
}
export interface KnowledgePurgeInputs {
  item: KnowledgePurgeItem | null | undefined;
  evidence?: readonly KnowledgePurgeExclusiveRecord[] | undefined;
  provenance?: readonly KnowledgePurgeExclusiveRecord[] | undefined;
  learningObjectives?: readonly KnowledgePurgeObjectiveReference[] | undefined;
  questionSources?: readonly KnowledgePurgeQuestionReference[] | undefined;
  analysisScopes?: readonly KnowledgePurgeScopeReference[] | undefined;
  conceptCleanup?: { links: number; relations: number };
}
export interface KnowledgePurgeReference {
  collection: 'learningObjectives' | 'questionSources' | 'analysisScopeSnapshots';
  id: unknown;
  reasonCode: 'TARGET_REBIND_REQUIRED' | 'QUESTION_SOURCE_REVIEW_REQUIRED' | 'SCOPE_HISTORY_RETAINED';
  action: 'rebind-or-delete-target' | 'review-question-source' | 'review-saved-scope';
}
export interface KnowledgePurgePreview {
  asset: { type: 'knowledgeItem'; id: string };
  operation: 'permanent-delete';
  conceptCleanup: { links: number; relations: number };
  decision: 'move-to-recycle-bin-first' | 'requires-dependency-action' | 'can-purge-no-history';
  expectedUpdatedAt: unknown;
  exclusiveRecords: { knowledgeEvidenceIds: string[]; knowledgeArtifactProvenanceIds: string[] };
  references: KnowledgePurgeReference[];
  coverage: {
    persistedCurrentAndHistory: true;
    runningTasks: 'unverified';
    offlineDevices: 'pending-sync';
    backups: 'retention-managed';
  };
}
export interface KnowledgePurgeAssertionInput {
  expectedUpdatedAt?: unknown;
  decision?: unknown;
  references: readonly { reasonCode?: unknown; message?: string | null | undefined }[];
}

function includesExactId(value: unknown, id: unknown, seen = new Set<object>()): boolean {
  if (value === id) return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((child: unknown) => includesExactId(child, id, seen));
}

export function inspectKnowledgeItemPurge({
  item,
  evidence = [],
  provenance = [],
  learningObjectives = [],
  questionSources = [],
  analysisScopes = [],
  conceptCleanup = { links: 0, relations: 0 }
}: KnowledgePurgeInputs): KnowledgePurgePreview {
  if (!item) throw createAppError('KNOWLEDGE_ITEM_NOT_FOUND', '知识点不存在。', 404);
  // 查询接收历史 unknown 引用；不转换证据 ID，也不改变稀疏数组的 Set 迭代行为。
  const evidenceIds = new Set<unknown>(evidence.map(record => record.id));
  const references = [
    ...learningObjectives
      .filter(record => record.knowledgeItemId === item.id)
      .map((record): KnowledgePurgeReference => ({
        collection: 'learningObjectives',
        id: record.id,
        reasonCode: 'TARGET_REBIND_REQUIRED',
        action: 'rebind-or-delete-target'
      })),
    ...questionSources
      .filter(
        record =>
          (record.sourceType === 'knowledgeItem' && record.sourceId === item.id) ||
          (record.sourceType === 'knowledgeEvidence' && evidenceIds.has(record.sourceId))
      )
      .map((record): KnowledgePurgeReference => ({
        collection: 'questionSources',
        id: record.id,
        reasonCode: 'QUESTION_SOURCE_REVIEW_REQUIRED',
        action: 'review-question-source'
      })),
    ...analysisScopes
      .filter(record => includesExactId(record, item.id) || evidence.some(source => includesExactId(record, source.id)))
      .map((record): KnowledgePurgeReference => ({
        collection: 'analysisScopeSnapshots',
        id: record.id,
        reasonCode: 'SCOPE_HISTORY_RETAINED',
        action: 'review-saved-scope'
      }))
  ];
  return {
    asset: { type: 'knowledgeItem', id: item.id },
    operation: 'permanent-delete',
    conceptCleanup,
    decision: !item.deletedAt
      ? 'move-to-recycle-bin-first'
      : references.length
        ? 'requires-dependency-action'
        : 'can-purge-no-history',
    expectedUpdatedAt: item.updatedAt,
    exclusiveRecords: {
      knowledgeEvidenceIds: evidence.map(record => record.id),
      knowledgeArtifactProvenanceIds: provenance.map(record => record.id)
    },
    references,
    coverage: {
      persistedCurrentAndHistory: true,
      runningTasks: 'unverified',
      offlineDevices: 'pending-sync',
      backups: 'retention-managed'
    }
  };
}

export function assertKnowledgeItemPurgeAllowed(
  preflight: KnowledgePurgeAssertionInput,
  expectedUpdatedAt: unknown
): void {
  if (!expectedUpdatedAt || preflight.expectedUpdatedAt !== expectedUpdatedAt) {
    throw createAppError('KNOWLEDGE_ITEM_UPDATE_CONFLICT', '知识点已变化，请重新预览。', 409, { preflight });
  }
  if (preflight.decision !== 'can-purge-no-history') {
    throw createAppError(
      'KNOWLEDGE_ITEM_PURGE_BLOCKED',
      preflight.references.find(reference => reference.reasonCode === 'TASK_REFERENCE_COVERAGE_UNAVAILABLE')?.message ??
        '请先处理知识点的关联引用。',
      409,
      { preflight }
    );
  }
}

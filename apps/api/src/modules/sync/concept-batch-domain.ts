import { syncError } from './journal.ts';
import type { SyncHistoricalEntity, SyncWorkingEntity } from './domain-types.ts';
/** 云端最终状态由 local-data-relations 调用同一套概念校验；此处限制入站变更形态。 */
export function assertConceptSyncChange(old: SyncHistoricalEntity | undefined, value: SyncWorkingEntity | null) {
  if (!value) throw syncError('CONCEPT_SYNC_DELETE_UNSUPPORTED', '概念、关联和关系只能软删除', 422);
  const before = old as { createdAt?: string; revision?: number } | undefined;
  const next = value as { createdAt?: string; sourceMode?: string; revision?: number };
  if (before && before.createdAt !== next.createdAt)
    throw syncError('SYNC_ENTITY_INVALID', '概念记录的创建时间不能改变', 422);
  if (next.sourceMode !== 'manual') throw syncError('CONCEPT_AI_SOURCE_RESERVED', '概念 AI 来源尚未开放', 422);
  if (before && Number(next.revision) <= Number(before.revision))
    throw syncError('CONCEPT_REVISION_CONFLICT', '概念记录版本必须递增', 409);
}

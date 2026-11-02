import { planHistoryRetention, applyHistoryRetentionPlan } from '../knowledge/domain/history-retention.js';
import type { SyncReferenceChange, SyncReferenceState } from './entity-contract.ts';

/** 云端是已同步历史的淘汰权威；删除与批次一起提交，设备经普通拉取收到墓碑。 */
export function pruneTouchedNoteVersions<State extends SyncReferenceState>(
  state: State,
  changes: SyncReferenceChange[],
  now = Date.now(),
  aliases: Record<string, string> = {},
  externalReferences: object[] | null = []
): State {
  // 私有来源不能读取时只停用自动淘汰，不影响核心保存。
  if (externalReferences === null) return state;
  const noteIds = new Set<string | null | undefined>();
  const annotations = new Map<string | null | undefined, SyncReferenceState[string][number]>(
    state.contentAnnotations.map(item => [item.id, item])
  );
  for (const entry of changes) {
    const value = entry.value;
    if (entry.collection === 'notes' && value) noteIds.add(entry.id);
    if (['noteVersions', 'contentAnnotations'].includes(entry.collection) && value) noteIds.add(value.noteId);
    if (entry.collection === 'annotationRevisions' && value) noteIds.add(annotations.get(value.annotationId)?.noteId);
  }
  noteIds.delete(undefined);
  if (!noteIds.size) return state;
  // 回执中的本批输入仍然存在；后续批次/维护再按同一策略淘汰。
  const protectedVersionIds = new Set(
    changes.filter(entry => entry.collection === 'noteVersions').map(entry => aliases[entry.id] ?? entry.id)
  );
  const protectedRevisionIds = new Set(
    changes.filter(entry => entry.collection === 'annotationRevisions').map(entry => entry.id)
  );
  const plan = planHistoryRetention(state, {
    noteIds,
    now,
    externalReferences,
    protectedVersionIds,
    protectedRevisionIds
  });
  return applyHistoryRetentionPlan(state, plan) as State;
}

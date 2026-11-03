import { readRuntimeConfig } from '../../app/runtimeConfig';

/** 原资料继续读取旧草稿；备份恢复之后只能读取当前资料版本自己的草稿。 */
export function getNoteDraftScope(spaceId: string | undefined, runtime = readRuntimeConfig()) {
  if (spaceId === undefined) return undefined;
  if (runtime.persistenceMode !== 'desktop-local' || runtime.legacyDraftsAllowed) return spaceId;
  return JSON.stringify([runtime.datasetId ?? 'unknown-desktop-dataset', spaceId]);
}

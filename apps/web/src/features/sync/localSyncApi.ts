import type { Conflict, EntityConflict } from './syncConflictModel';
import type { SyncIssue } from './syncStatusPresentation';

export interface RecoverySession {
  id: string;
  stage: 'prepared' | 'retiring' | 'downloading' | 'preview' | 'completed';
  oldDeviceId: string;
  newDeviceId: string;
  backupId: string;
  localRevision: string;
  totalItems: number;
  epochChanged: boolean;
}

export interface RecoveryPreview {
  recoveryId: string;
  revision: string;
  total: number;
  offset: number;
  nextOffset: number | null;
  items: {
    collection: string;
    id: string;
    local: Record<string, unknown> | null;
    remote: Record<string, unknown> | null;
  }[];
  oldDeviceId: string;
  newDeviceId: string;
  backupId: string;
  epochChanged: boolean;
}

export function isSafetyPaused(status: SyncStatus | null): boolean {
  return Boolean(status?.safetyPaused || status?.error?.code === 'SYNC_RESULT_UNCERTAIN');
}

export interface SyncStatus {
  safetyPaused?: boolean;
  recoverySession?: RecoverySession | null;
  deviceId?: string;
  pendingEntities?: number;
  pendingAttachments?: number;
  attachmentPending?: string | null;
  entityConflict?: EntityConflict | null;
  pendingKnowledgeEntities?: number;
  knowledgeSyncSupported?: boolean;
  serverUrl: string | null;
  generation: number;
  phase: string;
  pendingNotes: number;
  lastSyncedAt: string | null;
  lastCheckedAt?: string | null;
  conflicts: Conflict[];
  error: SyncIssue | null;
  blockedNotes: { noteId: string; title: string; message: string }[];
}
export async function callSync<T = SyncStatus>(path = '', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/local-runtime/sync${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    });
  } catch {
    throw Object.assign(new Error('无法连接本地服务，请重新打开应用后重试。'), { code: 'LOCAL_RUNTIME_UNAVAILABLE' });
  }
  const result = await response.json().catch(() => null);
  if (!result)
    throw Object.assign(new Error('本地服务返回异常，请重新打开应用后重试。'), {
      code: 'LOCAL_RUNTIME_INVALID_RESPONSE'
    });
  if (!response.ok)
    throw Object.assign(new Error(result.error?.message ?? '同步操作失败。'), {
      code: result.error?.code ?? 'SYNC_ACTION_FAILED'
    });
  return result.data;
}

export function syncIssue(failure: unknown): SyncIssue {
  return failure instanceof Error
    ? {
        code: 'code' in failure && typeof failure.code === 'string' ? failure.code : 'SYNC_ACTION_FAILED',
        message: failure.message
      }
    : { code: 'SYNC_ACTION_FAILED', message: '同步操作失败。' };
}

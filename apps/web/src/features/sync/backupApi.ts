import { readRuntimeConfig } from '../../app/runtimeConfig';
import { trackDesktopTask } from '../../app/desktopLifecycle';

export interface RuntimeBackup {
  id: string; createdAt: string | null; purpose: string; fileCount: number; size: number; error?: string;
}
export interface BackupInspection {
  valid: boolean; createdAt: string; fileCount: number; size: number;
  noteCount: number; attachmentCount: number; pendingOperations: number; draftCount: number;
}
export interface BackupRestoreResult {
  datasetId: string; directory: string; protectionBackupId: string; previousDirectory: string; syncPaused: boolean;
}
export interface BackupTransferRequest { action: 'export' | 'import'; datasetId: string; backupId?: string; }
export interface BackupTransferResult { id: string; directory: string; inspection: BackupInspection; }
export async function transferBackup(action: 'export' | 'import', backupId?: string) {
  const bridge = window.knowraDesktop?.transferBackup;
  const datasetId = readRuntimeConfig().datasetId;
  if (!bridge || !datasetId) throw new Error('完整备份目录导出与导入需要桌面应用；浏览器暂不支持。');
  return trackDesktopTask(() => bridge({ action, datasetId, ...(backupId ? { backupId } : {}) }));
}
export async function callBackup<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/local-runtime/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? '本机备份操作失败');
  return result.data;
}

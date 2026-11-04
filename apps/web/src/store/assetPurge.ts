import type { AuthoritativePurgeResult, PurgeConfirmationInput } from '@study-accelerator/web-core';

/** 显式转交本次预检凭据，不读取或替换任何最新预检缓存。 */
export function purgeConfirmation(preview: PurgeConfirmationInput): PurgeConfirmationInput {
  return { expectedUpdatedAt: preview.expectedUpdatedAt,
    ...(preview.expectedDatasetEpoch ? { expectedDatasetEpoch: preview.expectedDatasetEpoch } : {}),
    ...(preview.confirmationToken ? { confirmationToken: preview.confirmationToken } : {}) };
}
export function assertLocalPurgeConfirmation(input: string | PurgeConfirmationInput) {
  if (typeof input === 'string' || !input.confirmationToken || !input.expectedDatasetEpoch || !input.expectedUpdatedAt) {
    throw new Error('请重新联网预检并明确确认此对象的永久清理。');
  }
}
export const PURGE_PENDING_MESSAGE = '清理结果待核对，原件已保留。请连接云端完成同步后核对结果；不会自动重发清理请求。';
export function isPurgeResultPending(cause: unknown): boolean {
  const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
  return code === 'LOCAL_PURGE_RESULT_PENDING' || code.startsWith('SYNC_NETWORK_') || code === 'CLOUD_SERVICE_UNAVAILABLE' || code === 'CLOUD_REQUEST_FAILED';
}
export function purgeResultMessage(result: AuthoritativePurgeResult): string {
  return result.localState === 'recovery-required'
    ? result.message ?? '云端清理已确认；本地新修改仍保存在恢复记录或同步冲突中，请核对后处理。'
    : '云端清理已确认，本机已收到删除事实；备份和其他设备副本按各自保留规则处理。';
}

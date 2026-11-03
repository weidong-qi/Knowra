import { syncError } from './journal.ts';

export function assertSyncDeviceEnabled(deviceId: unknown): void {
  if (process.env.KNOWRA_SYNC_PUSH_ENABLED === 'false')
    throw syncError('SYNC_PUSH_PAUSED', '云端暂时暂停接收同步，本地内容已保留。', 503);
  const allowed: readonly unknown[] = (process.env.KNOWRA_SYNC_ALLOWED_DEVICE_IDS ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (allowed.length && !allowed.includes(deviceId))
    throw syncError('SYNC_DEVICE_NOT_ENABLED', '此设备尚未加入同步试用范围，本地内容已保留。', 403);
}

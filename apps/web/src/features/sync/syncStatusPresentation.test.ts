import { describe, expect, it } from 'vitest';
import { describeLocalSyncStatus, type SyncStatusSnapshot } from './syncStatusPresentation';

const connected: SyncStatusSnapshot = { serverUrl: 'https://example.test', phase: 'synced', pendingEntities: 0, conflicts: [], error: null };

describe('桌面同步状态栏文案', () => {
  it('区分尚未连接、首次连接失败和已同步', () => {
    expect(describeLocalSyncStatus(null)).toEqual({ tone: 'neutral', main: '本地资料', detail: '连接云端' });
    expect(describeLocalSyncStatus(null, { code: 'SYNC_NETWORK_DNS', message: '无法解析云端服务地址。' }))
      .toEqual({ tone: 'warning', main: '本地资料待连接', detail: '连接失败' });
    expect(describeLocalSyncStatus(connected, { code: 'LOCAL_RUNTIME_UNAVAILABLE', message: '无法连接本地服务。' }))
      .toEqual({ tone: 'warning', main: '本地资料状态待确认', detail: '本地服务连接失败' });
    expect(describeLocalSyncStatus(connected)).toEqual({ tone: 'success', main: '本地资料已同步', detail: '云端已同步' });
  });

  it('网络错误显示等待重试，手动暂停显示已暂停', () => {
    expect(describeLocalSyncStatus({ ...connected, phase: 'paused', error: { code: 'SYNC_NETWORK_TIMEOUT', message: '连接超时。' } }))
      .toEqual({ tone: 'warning', main: '本地资料待同步', detail: '连接失败，等待重试' });
    expect(describeLocalSyncStatus({ ...connected, phase: 'disconnected' }))
      .toEqual({ tone: 'neutral', main: '仅使用本地资料', detail: '云端同步已暂停' });
  });

  it('冲突、凭据失效和知识未同步不能显示云端已同步', () => {
    expect(describeLocalSyncStatus({ ...connected, phase: 'auth-required', error: { code: 'AUTH_REQUIRED', message: '请重新登录。' } }).detail).toBe('请重新登录');
    expect(describeLocalSyncStatus({ ...connected, phase: 'conflict', conflicts: [{}] }))
      .toEqual({ tone: 'danger', main: '资料待核对', detail: '1 项同步冲突' });
    expect(describeLocalSyncStatus({ ...connected, error: { code: 'SYNC_KNOWLEDGE_UNSUPPORTED', message: '云端尚不支持知识同步。' } }))
      .toEqual({ tone: 'warning', main: '部分资料待同步', detail: '云端需要升级' });
  });

  it('同步中、待上传和附件重试各自有独立提示', () => {
    expect(describeLocalSyncStatus({ ...connected, phase: 'syncing' }).main).toBe('资料同步中');
    expect(describeLocalSyncStatus({ ...connected, phase: 'pending', pendingEntities: 3 }).detail).toBe('3 项待同步');
    expect(describeLocalSyncStatus({ ...connected, phase: 'pending', attachmentPending: 'attachment-1' }).detail).toBe('附件等待重试');
  });
});

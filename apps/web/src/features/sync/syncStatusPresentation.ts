export interface SyncIssue {
  code?: string;
  message: string;
}

export interface SyncStatusSnapshot {
  serverUrl?: string | null;
  phase?: string;
  error?: SyncIssue | null;
  conflicts?: readonly unknown[];
  entityConflict?: unknown | null;
  pendingEntities?: number;
  pendingNotes?: number;
  pendingKnowledgeEntities?: number;
  attachmentPending?: string | null;
}

export interface SyncPresentation {
  tone: 'neutral' | 'active' | 'success' | 'warning' | 'danger';
  main: string;
  detail: string;
}

export function describeLocalSyncStatus(status: SyncStatusSnapshot | null, connectionError: SyncIssue | null = null): SyncPresentation {
  if (connectionError?.code?.startsWith('LOCAL_RUNTIME_')) {
    return { tone: 'warning', main: '本地资料状态待确认', detail: '本地服务连接失败' };
  }
  if (!status?.serverUrl) {
    if (connectionError?.code === 'AUTH_REQUIRED') return { tone: 'danger', main: '本地资料待连接', detail: '请重新登录' };
    if (connectionError) return { tone: 'warning', main: '本地资料待连接', detail: '连接失败' };
    return { tone: 'neutral', main: '本地资料', detail: '连接云端' };
  }
  if (status.phase === 'disconnected') return { tone: 'neutral', main: '仅使用本地资料', detail: '云端同步已暂停' };
  if (status.phase === 'syncing') return { tone: 'active', main: '资料同步中', detail: '正在同步…' };
  if (status.phase === 'auth-required' || status.error?.code === 'AUTH_REQUIRED') {
    return { tone: 'danger', main: '本地资料待同步', detail: '请重新登录' };
  }
  const conflicts = (status.conflicts?.length ?? 0) + (status.entityConflict ? 1 : 0);
  if (conflicts) return { tone: 'danger', main: '资料待核对', detail: `${conflicts} 项同步冲突` };
  if (status.phase === 'conflict') return { tone: 'danger', main: '资料待核对', detail: '同步冲突待处理' };
  if (status.error?.code === 'SYNC_KNOWLEDGE_UNSUPPORTED') {
    return { tone: 'warning', main: '部分资料待同步', detail: '云端需要升级' };
  }
  if (status.error?.code === 'PROTOCOL_UNSUPPORTED') {
    return { tone: 'danger', main: '本地资料待同步', detail: '同步版本不兼容' };
  }
  if (status.error) {
    const networkFailure = status.error.code?.startsWith('SYNC_NETWORK_') || status.error.code?.startsWith('SYNC_CONNECTION_');
    return { tone: 'warning', main: '本地资料待同步', detail: networkFailure ? '连接失败，等待重试' : '同步失败，等待重试' };
  }
  const pending = status.pendingEntities ?? status.pendingNotes ?? 0;
  if (status.attachmentPending) return { tone: 'warning', main: '本地资料待同步', detail: '附件等待重试' };
  if (pending > 0) return { tone: 'warning', main: '本地资料待同步', detail: `${pending} 项待同步` };
  if (status.phase === 'pending') return { tone: 'warning', main: '本地资料待同步', detail: '等待云端确认' };
  if (status.phase === 'synced') return { tone: 'success', main: '本地资料已同步', detail: '云端已同步' };
  return { tone: 'neutral', main: '本地资料', detail: '连接云端' };
}

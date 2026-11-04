import type { Page } from '@playwright/test';
import type { BackupInspection, RuntimeBackup } from '../../src/features/sync/backupApi';
import type { Conflict, EntityConflict } from '../../src/features/sync/syncConflictModel';
import type { McpOverview } from '../../src/features/settings/externalClients';
import { mockV5AssistantSettingsEvidence } from './v5AssistantSettingsEvidence';

export const syntheticPassword = 'SYNTHETIC_UI_ONLY_NOT_A_CREDENTIAL';
export const syntheticClientName = '合成只读客户端名称用于测试极窄视口换行与操作按钮布局SyntheticClientOnly';
export const syntheticNoteTitle = '合成笔记冲突：本机与云端的长标题和正文对比';
export const syntheticEntityTitle = '合成关联知识冲突：云端删除后的只读核对边界';
export const syntheticBackupId = 'synthetic-backup-manual-00000001';
const date = '2026-10-10T08:00:00.000Z';
const baseline = { title: syntheticNoteTitle, rawMarkdown: '# 合成正文\n\n共同基线内容，仅供 UI 验收。', deleted: false,
  folderId: 'folder-1', tagIds: ['tag-study'], status: 'draft', favorite: false };
const noteConflict: Conflict = { noteId: 'synthetic-conflict-note', kind: 'edit', datasetEpoch: 'synthetic-epoch', remoteRevision: 2,
  base: baseline,
  local: { ...baseline, rawMarkdown: '# 合成正文\n\n本机修改：中文长段落用于检查分栏、换行和内部滚动。\n\nLOCAL_SYNTHETIC_ONLY_' + 'LongUnbrokenText'.repeat(6), favorite: true },
  remote: { ...baseline, rawMarkdown: '# 合成正文\n\n云端修改：这一段只由 Playwright 夹具提供，从未连接任何云端。', status: 'active' } };
const entityConflict: EntityConflict = { id: 'synthetic-entity-conflict', changedEpoch: true,
  reasons: [{ collection: 'knowledgeItems', id: 'synthetic-knowledge', message: '合成云端删除示例：只能核对，测试不会采用任何版本。' }],
  items: [{ collection: 'knowledgeItems', id: 'synthetic-knowledge',
    base: { title: syntheticEntityTitle, canonicalStatement: '合成共同基线', reviewStatus: 'candidate', knowledgeType: 'concept' },
    local: { title: syntheticEntityTitle, canonicalStatement: '本机合成陈述，检查长文本是否仍可阅读。'.repeat(5), reviewStatus: 'confirmed', knowledgeType: 'concept' }, remote: null },
  { collection: 'knowledgeEvidence', id: 'synthetic-evidence',
    base: { knowledgeItemId: 'synthetic-knowledge', quote: '共同来源片段', sourceStatus: 'valid' },
    local: { knowledgeItemId: 'synthetic-knowledge', quote: '合成来源片段，只读查看关联字段。', sourceStatus: 'stale' }, remote: null }] };
const backups: RuntimeBackup[] = [
  { id: syntheticBackupId, createdAt: date, purpose: 'manual', fileCount: 8, size: 1_048_576 },
  { id: 'synthetic-backup-protect-00000002', createdAt: '2026-10-09T08:00:00.000Z', purpose: 'before-restore', fileCount: 12, size: 2_097_152 },
  { id: 'synthetic-backup-legacy-00000003', createdAt: '2026-10-08T08:00:00.000Z', purpose: 'legacy-unspecified', fileCount: 4, size: 524_288 }
];
const inspection: BackupInspection = { valid: true, createdAt: date, fileCount: 8, size: 1_048_576,
  noteCount: 18, attachmentCount: 2, pendingOperations: 3, draftCount: 1 };
const clients: McpOverview = { aiEnabled: true, egressEnabled: true, proposalsEnabled: false,
  adapter: { command: '/SYNTHETIC-UI-ONLY/Knowra Sample.app/Contents/MacOS/node',
    args: ['/SYNTHETIC-UI-ONLY/nonexistent-adapter.mjs'], env: {} },
  items: [{ pairingId: 'synthetic-client-only', label: syntheticClientName, spaceId: 'space-1',
    scope: { kind: 'folder', folderId: 'folder-1' }, excludedNoteIds: [], createdAt: date,
    expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: null, lastUsedAt: null, calls: 0,
    allowPropose: false, allowKnowledgeRead: false, knowledgeReadConfirmedAt: null, status: 'active',
    pairingFile: '/SYNTHETIC-UI-ONLY/THIS-FILE-DOES-NOT-EXIST/long-synthetic-client-directory/pairing.json' }] };

/** 仅注入合成 runtime 标记，不安装桌面桥，不访问本机数据目录。 */
export async function mockV5StatusDialogEvidence(page: Page) {
  const network = await mockV5AssistantSettingsEvidence(page);
  let conflicts = false;
  let populatedBackups = false;
  const syntheticInspections: string[] = [];
  const blockedWakeRequests: string[] = [];
  const servedReads: string[] = [];
  await page.addInitScript(() => {
    Object.assign(window, { knowraRuntime: { persistenceMode: 'desktop-local', datasetId: 'synthetic-v5-dialog-evidence', legacyDraftsAllowed: false } });
  });
  await page.context().route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method(), path = url.pathname;
    // 新夹具不放宽父夹具的 origin / API / WebSocket 隔离，包括弹出页。
    if (url.origin !== 'http://127.0.0.1:5173') return route.fallback();
    if (!path.startsWith('/api/')) {
      if (method === 'GET') return route.fallback();
      network.blocked.push(`${method} ${path}`);
      return route.abort('blockedbyclient');
    }
    // 唯一允许的 POST 也绝不继续网络请求；只回传常量检查结果，无磁盘读取/备份/恢复。
    if (method === 'POST' && path === `/api/local-runtime/backups/${syntheticBackupId}/inspect`
      && request.postData() === '{}') {
      network.requests.push(`${method} ${path}`);
      syntheticInspections.push(`${method} ${path}`);
      return route.fulfill({ json: { data: inspection } });
    }
    if (method !== 'GET') {
      network.requests.push(`${method} ${path}`);
      network.blocked.push(`${method} ${path}`);
      // 浏览器焦点切换可能触发应用的自动 wake；同样阻断，单列记录而非伪装成已同步。
      if (method === 'POST' && path === '/api/local-runtime/sync/wake') blockedWakeRequests.push(`${method} ${path}`);
      return route.abort('blockedbyclient');
    }
    let data: unknown;
    if (path === '/api/local-runtime/sync') data = {
      deviceId: 'SYNTHETIC_DEVICE_ONLY_' + 'long-device-label-'.repeat(6), generation: 1,
      serverUrl: conflicts ? 'https://synthetic-sync.invalid' : null, phase: conflicts ? 'conflict' : 'disconnected',
      pendingNotes: conflicts ? 1 : 0, pendingEntities: conflicts ? 3 : 0, pendingKnowledgeEntities: conflicts ? 2 : 0,
      knowledgeSyncSupported: true, lastSyncedAt: conflicts ? date : null, lastCheckedAt: date,
      conflicts: conflicts ? [noteConflict] : [], entityConflict: conflicts ? entityConflict : null,
      error: null, blockedNotes: []
    };
    else if (path === '/api/local-runtime/backups') data = { items: populatedBackups ? backups : [] };
    else if (path === '/api/local-runtime/mcp/pairings') data = clients;
    else return route.fallback();
    network.requests.push(`${method} ${path}`);
    servedReads.push(`${method} ${path}`);
    return route.fulfill({ json: { data } });
  });
  return { ...network, syntheticInspections, blockedWakeRequests, servedReads,
    showConflicts: () => { conflicts = true; }, showBackupList: () => { populatedBackups = true; } };
}

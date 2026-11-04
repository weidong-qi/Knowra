import { apiClient } from '@study-accelerator/web-core';

export interface TaskWorkspaceGrant { workspaceId: string; read: true; writeDocuments: boolean; executeTasks: boolean; includeImages: boolean }
export interface TaskWorkspaceGrantInput { taskWorkspaceGrants: TaskWorkspaceGrant[]; taskWorkspaceConfirmed?: true; taskImagesConfirmed?: true }
export type PairingScope = { kind: 'none' } | { kind: 'library' } | { kind: 'folder'; folderId: string } | { kind: 'fixed'; noteIds: string[] };

export interface McpPairing {
  pairingId: string; label: string; spaceId: string; scope: PairingScope; excludedNoteIds: string[];
  createdAt: string; expiresAt: string; revokedAt: string | null; lastUsedAt: string | null; calls: number; allowPropose: boolean;
  allowKnowledgeRead: boolean; knowledgeReadConfirmedAt: string | null;
  taskWorkspaceGrants?: TaskWorkspaceGrant[]; taskWorkspaceReauthorizationRequired?: boolean;
  status: 'active' | 'expired' | 'revoked'; pairingFile: string;
}
/** 适配器启动方式：命令、脚本路径与环境变量；不含令牌，配对文件路径由各配对给出。 */
export interface McpAdapter { command: string; args: string[]; env: Record<string, string> }
export interface McpOverview { items: McpPairing[]; aiEnabled: boolean; egressEnabled: boolean; proposalsEnabled: boolean; taskWorkspacesAvailable?: boolean; adapter: McpAdapter | null }
export interface McpAuditEntry { at: string; event: string; tool?: string; status?: string; code?: string; fragments?: number; retryAfterSeconds?: number }
export interface CreatePairingInput extends Partial<TaskWorkspaceGrantInput> { label: string; spaceId?: string; scope: PairingScope; expiresInDays: number; egressConfirmed: true; allowPropose?: true; proposeConfirmed?: true; allowKnowledgeRead?: true; knowledgeReadConfirmed?: true }
export type KnowledgeReadInput = { allowKnowledgeRead: false } | { allowKnowledgeRead: true; knowledgeReadConfirmed: true };

const HEADERS = { 'X-Knowra-MCP-Pairing': '1' };
const base = '/api/local-runtime/mcp';

/** 仅桌面本地运行端提供；令牌只在 0600 配对文件里，接口响应从不包含令牌。 */
export const externalClients = {
  async overview(): Promise<McpOverview> { return (await apiClient.requestJson<{ data: McpOverview }>(`${base}/pairings`)).data; },
  async create(input: CreatePairingInput, taskWorkspaceEpoch?: string): Promise<McpPairing> {
    return (await apiClient.requestJson<{ data: McpPairing }>(`${base}/pairings`, { method: 'POST', headers: { ...HEADERS, ...(taskWorkspaceEpoch ? { 'X-Task-Workspace-Epoch': taskWorkspaceEpoch } : {}) }, body: JSON.stringify(input) })).data;
  },
  async revoke(pairingId: string): Promise<McpPairing> {
    return (await apiClient.requestJson<{ data: McpPairing }>(`${base}/pairings/${encodeURIComponent(pairingId)}/revoke`, { method: 'POST', headers: HEADERS, body: '{}' })).data;
  },
  async setKnowledgeRead(pairingId: string, input: KnowledgeReadInput): Promise<McpPairing> {
    return (await apiClient.requestJson<{ data: McpPairing }>(`${base}/pairings/${encodeURIComponent(pairingId)}/knowledge-read`, { method: 'POST', headers: HEADERS, body: JSON.stringify(input) })).data;
  },
  async setTaskWorkspaceGrants(pairingId: string, input: TaskWorkspaceGrantInput, taskWorkspaceEpoch?: string): Promise<McpPairing> {
    return (await apiClient.requestJson<{ data: McpPairing }>(`${base}/pairings/${encodeURIComponent(pairingId)}/task-workspaces`, { method: 'POST', headers: { ...HEADERS, ...(taskWorkspaceEpoch ? { 'X-Task-Workspace-Epoch': taskWorkspaceEpoch } : {}) }, body: JSON.stringify(input) })).data;
  },
  async taskWorkspaces(): Promise<{ items: { id: string; name: string }[]; datasetEpoch: string }> {
    const before = await apiClient.requestJson<{ data: { datasetEpoch: string; available: boolean } }>('/api/task-workspaces/capabilities');
    if (!before.data.available || !before.data.datasetEpoch) throw new Error('任务工作区当前不可用。');
    const items: { id: string; name: string }[] = []; const seen = new Set<string>(); let cursor: string | null = null;
    do {
      const query = cursor ? `?limit=50&cursor=${encodeURIComponent(cursor)}` : '?limit=50';
      const result: { data: { items: { id: string; name: string }[]; nextCursor: string | null } } = await apiClient.requestJson(`/api/task-workspaces${query}`);
      items.push(...result.data.items); cursor = result.data.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error('任务工作区列表已变化，请重试。');
      if (cursor) seen.add(cursor);
    } while (cursor);
    const after = await apiClient.requestJson<{ data: { datasetEpoch: string } }>('/api/task-workspaces/capabilities');
    if (after.data.datasetEpoch !== before.data.datasetEpoch) throw new Error('任务工作区已变化，请重试。');
    return { items, datasetEpoch: before.data.datasetEpoch };
  },
  async audit(pairingId: string, limit = 10): Promise<McpAuditEntry[]> {
    return (await apiClient.requestJson<{ data: { items: McpAuditEntry[] } }>(`${base}/audit?pairingId=${encodeURIComponent(pairingId)}&limit=${limit}`)).data.items;
  }
};

export const isDesktopRuntime = () => (globalThis as { knowraRuntime?: { persistenceMode?: string } }).knowraRuntime?.persistenceMode === 'desktop-local';

const launchArgs = (adapter: McpAdapter, pairingFile: string) => [...adapter.args, '--pairing-file', pairingFile];
const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/** Claude Code：用 add-json 一条命令添加；配置里只有命令与配对文件路径，没有令牌。 */
export function claudeCodeSnippet(adapter: McpAdapter, pairingFile: string): string {
  const config = { type: 'stdio', command: adapter.command, args: launchArgs(adapter, pairingFile),
    ...(Object.keys(adapter.env).length ? { env: adapter.env } : {}) };
  return `claude mcp add-json knowra ${shellQuote(JSON.stringify(config))}`;
}

/** Codex：写入 ~/.codex/config.toml。字符串用 JSON 转义，与 TOML 基本字符串兼容。 */
export function codexSnippet(adapter: McpAdapter, pairingFile: string): string {
  const lines = ['[mcp_servers.knowra]', `command = ${JSON.stringify(adapter.command)}`,
    `args = [${launchArgs(adapter, pairingFile).map(item => JSON.stringify(item)).join(', ')}]`];
  const env = Object.entries(adapter.env);
  if (env.length) lines.push('', '[mcp_servers.knowra.env]', ...env.map(([key, value]) => `${key} = ${JSON.stringify(value)}`));
  return lines.join('\n');
}

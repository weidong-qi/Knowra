import type { McpAuditEntry, McpOverview, McpPairing } from './externalClients';

export type McpClient = 'claude' | 'codex';
export const clientNames: Record<McpClient, string> = { claude: 'Claude Code', codex: 'Codex' };
export const inferMcpClient = (label: string): McpClient => /codex/i.test(label) ? 'codex' : 'claude';

export interface ConnectionCheck {
  overview: McpOverview;
  pairing: McpPairing | null;
  audit: McpAuditEntry[] | null;
  checkedAt: string;
}

/** calls/lastUsedAt 在准入时递增，不能证明调用成功；只有成功审计是成功工具调用证据。 */
export function connectionEvidence(check: ConnectionCheck) {
  const pairing = check.pairing;
  const permission = !pairing ? '找不到此配对，请返回列表确认或重新创建。'
    : pairing.status === 'revoked' ? '配对已撤销，请重新创建并替换客户端配置。'
    : pairing.status === 'expired' ? '配对已过期，请重新创建并替换客户端配置。'
    : pairing.scope.kind === 'none' && pairing.taskWorkspaceReauthorizationRequired ? '任务工作区授权已失效，请重新选择并确认权限。'
    : !check.overview.aiEnabled ? 'AI 功能未开启，请先在设置中开启。'
    : !check.overview.egressEnabled ? '外发已被紧急停止，请确认后恢复外发。'
    : '配对有效，AI 与外发开关已开启。';
  const success = check.audit?.filter(entry => entry.event === 'call' && entry.status === 'ok')
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
  return { permission, success };
}

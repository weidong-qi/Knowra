import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button/Button';
import { Select } from '../../components/ui/input';
import { Dialog, DialogBody, DialogFooter } from '../../components/ui/overlay/Dialog';
import { claudeCodeSnippet, codexSnippet, externalClients, type McpAdapter, type McpOverview, type McpPairing } from './externalClients';
import { clientNames, connectionEvidence, type ConnectionCheck, type McpClient } from './mcpConnection';
import styles from './McpConnection.module.css';
import settings from './SettingsView.module.css';

const time = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });

/** 仅读取本地设置接口与审计；不启动适配器、不读私有配对文件、不代写客户端配置。 */
export function McpConnectionDialog({ pairing, adapter, initialClient, onClose, onOverview }: {
  pairing: McpPairing; adapter: McpAdapter | null; initialClient: McpClient; onClose: () => void; onOverview?: (overview: McpOverview) => void;
}) {
  const [client, setClient] = useState(initialClient);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<ConnectionCheck | null>(null);
  const [error, setError] = useState('');
  const active = useRef(true);
  const inFlight = useRef(false);
  const copyVersion = useRef(0);
  useEffect(() => { active.current = true; return () => { active.current = false; copyVersion.current += 1; }; }, []);
  // 检查后使用运行端当前路径；旧配置是否已保存到客户端仍需用户确认。
  const currentPairing = check?.pairing ?? pairing;
  const currentAdapter = check ? check.overview.adapter : adapter;
  const valid = (!check || Boolean(check.pairing)) && currentPairing.status === 'active';
  const text = currentAdapter && valid ? (client === 'claude' ? claudeCodeSnippet : codexSnippet)(currentAdapter, currentPairing.pairingFile) : '';
  const evidence = check ? connectionEvidence(check) : null;

  async function copy() {
    const version = ++copyVersion.current;
    try { await navigator.clipboard.writeText(text); if (active.current && version === copyVersion.current) setCopied('ok'); }
    catch { if (active.current && version === copyVersion.current) setCopied('failed'); }
  }
  async function inspect() {
    if (inFlight.current) return;
    inFlight.current = true; setChecking(true); setError(''); setCopied('idle'); copyVersion.current += 1;
    try {
      const overview = await externalClients.overview();
      if (!active.current) return;
      const audit = await externalClients.audit(pairing.pairingId, 50).catch(() => null);
      if (active.current) {
        copyVersion.current += 1; setCopied('idle');
        setCheck({ overview, pairing: overview.items.find(item => item.pairingId === pairing.pairingId) ?? null, audit, checkedAt: new Date().toISOString() });
        onOverview?.(overview);
      }
    } catch {
      if (active.current) setError('无法读取本地运行端，尚不能判断连接状态。请确认知境仍在运行，重新打开设置后再试。');
    } finally { inFlight.current = false; if (active.current) setChecking(false); }
  }

  return <Dialog title={`连接方式：${pairing.label}`} isOpen onOpenChange={open => { if (!open) onClose(); }} size="md">
    <DialogBody><div className={styles.content}>
      <p className={styles.steps}>3 配置客户端 → 4 检查连接</p>
      <Select label="配置客户端" selectedKey={client} onSelectionChange={key => { setClient(key as McpClient); setCopied('idle'); copyVersion.current += 1; }}
        options={Object.entries(clientNames).map(([id, label]) => ({ id, label }))} />
      <p className={settings.warning}>配对文件相当于访问密码，请勿分享、提交到代码仓库或放进云盘。</p>
      {text ? <>
        <p>{client === 'claude' ? '在本机终端运行下面的命令；已有 knowra 配置时先核对旧配置，再按客户端提示替换。' : '将下面配置合并到 ~/.codex/config.toml；已有 [mcp_servers.knowra] 时替换该段，保留其他配置。'}</p>
        <pre className={settings.snippet} aria-label={`${client} 配置`}>{text}</pre>
        <div className={styles.actions}><Button size="compact" aria-label={`复制 ${client} 配置`} isDisabled={checking} onPress={() => void copy()}>复制配置</Button></div>
        {copied === 'ok' ? <p role="status">已复制。请在客户端保存并重新加载；复制不代表连接成功。</p> : null}
        {copied === 'failed' ? <p role="alert">无法写入剪贴板，请手动选择上面的文字复制。</p> : null}
      </> : <p role="alert">{valid ? '此版本没有内置外部客户端适配器，无法生成连接方式。请使用包含适配器的新版应用。' : '此配对不可用，请关闭向导，重新创建配对并替换客户端配置。'}</p>}
      <p>配置只包含启动命令与配对文件路径，没有令牌。保持知境运行，重新加载客户端的 MCP 配置，然后在客户端请求调用 knowra 的 {currentPairing.scope.kind === 'none' ? 'task_workspaces_list 工具列出已授权任务工作区。' : 'notes_search 工具搜索一条已授权笔记。'}</p>
      <div className={styles.actions}><Button variant="primary" isPending={checking} isDisabled={checking} onPress={() => void inspect()}>检查连接</Button></div>
      {checking ? <p role="status">正在读取本地状态与最近调用记录…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {!checking && check && evidence ? <div role="status" aria-label="连接检查结果">
        <p>检查时间：{time(check.checkedAt)}。这是一次状态快照，不代表客户端持续在线。</p>
        <dl className={styles.checks}>
          <div><dt>本地运行端</dt><dd>本地设置接口可用；这不验证客户端进程或 stdio / socket 握手。</dd></div>
          <div><dt>授权状态</dt><dd>{evidence.permission}</dd></div>
          <div><dt>工具调用证据</dt><dd>{check.audit === null ? '调用记录读取失败，无法判断；请重试检查。'
            : evidence.success ? `曾成功调用 ${evidence.success.tool ?? '工具'}：${time(evidence.success.at)}。此记录不证明当前仍能调用。`
              : '最近记录中尚无成功工具调用，不能据此判定连接失败。请在客户端完成一次调用后重新检查。'}</dd></div>
        </dl>
      </div> : null}
      <details className={styles.help}><summary>连接遇到问题？</summary><ul>
        <li>知境未运行：先启动知境，再重新加载客户端的 MCP 配置。</li>
        <li>配对过期或撤销：返回列表重新创建；旧配对不能通过重新复制恢复。</li>
        <li>移动或更新应用后路径变化：先点“检查连接”，复制这里的最新配置，手动替换客户端中旧的命令和路径。</li>
        <li>客户端找不到工具：核对配置是否保存在当前客户端使用的配置文件中，并重新加载 MCP 或重启客户端。</li>
        <li>检查只读取状态，不会创建配对、发送笔记或修改客户端配置；调用记录中的历史成功不能替代一次新的客户端调用。</li>
      </ul></details>
    </div></DialogBody>
    <DialogFooter><Button variant="primary" onPress={onClose}>完成</Button></DialogFooter>
  </Dialog>;
}

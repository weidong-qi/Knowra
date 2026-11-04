import { Button } from '../../components/ui/button/Button';
import { DialogBody, DialogFooter } from '../../components/ui/overlay/Dialog';
import { clientNames, type McpClient } from './mcpConnection';
import styles from './McpConnection.module.css';

export function McpClientChoice({ onChoose, onClose }: { onChoose: (client: McpClient) => void; onClose: () => void }) {
  return <>
    <DialogBody><div className={styles.content}>
      <p className={styles.steps}>1 选择客户端 → 2 确认权限 → 3 配置 → 4 检查连接</p>
      <p>先在这台电脑安装并登录客户端。本向导提供 Claude Code 与 Codex 的本机 stdio 配置，客户端自身的账号与模型费用由你管理。</p>
      <div className={styles.choices}>{(['claude', 'codex'] as const).map(client =>
        <Button key={client} onPress={() => onChoose(client)}>使用 {clientNames[client]}</Button>)}</div>
      <p>下一步选择可读取的笔记范围与有效期；此时不会创建配对或修改客户端配置。</p>
    </div></DialogBody>
    <DialogFooter><Button variant="ghost" onPress={onClose}>取消</Button></DialogFooter>
  </>;
}

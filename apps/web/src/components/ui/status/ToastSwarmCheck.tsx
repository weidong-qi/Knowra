// 成功状态粒子汇聚→矢量对勾图标：委托给通用 ToastSwarmIcon。

import { ToastSwarmIcon } from './ToastSwarmIcon';

export function ToastSwarmCheck({ size = 22 }: { size?: number }) {
  return <ToastSwarmIcon tone="success" size={size} />;
}

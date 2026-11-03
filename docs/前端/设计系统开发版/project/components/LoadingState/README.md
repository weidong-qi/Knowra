# LoadingState

加载反馈：三点脉冲、扫描进度条或骨架条（`SkeletonPulse`）。

## 规则

- 圆点与进度条用 `accent`；骨架条用 `border-subtle`，1.4s 呼吸。
- 文字 12px / 600 `text-secondary`，写"正在 + 动作…"。
- 已知结构的区域优先骨架；短暂等待用圆点；有进度的长任务用进度条。
- 减少动效时全部停在静态。

## 使用方提供

- `variant`（`dots` / `bar` / `skeleton`）、可选 `label`；单独的骨架条用 `SkeletonPulse`。

*源码：`status/LoadingState.tsx`、`SkeletonPulse.tsx` 与 `Status.module.css`。运行时为 `window.Knowra.LoadingState`，需要页面先加载 React 18 与 ReactDOM 18。*

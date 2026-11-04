# Tooltip

图标按钮与截断文字的说明气泡。

## 规则

- 反色：`text-primary` 底、`surface-page` 字，11px / 500，`radius-control`，最宽 240px。
- 只放一句话：动作名 + 可选快捷键。不放可交互内容。

## 使用方提供

- `TooltipTrigger` 的两个子元素：触发元素与 `Tooltip`；可选 `delay`、`closeDelay`。

*源码：`overlay/Tooltip.tsx` 与 `Overlay.module.css`。运行时为 `window.Knowra.Tooltip`，需要页面先加载 React 18 与 ReactDOM 18。*

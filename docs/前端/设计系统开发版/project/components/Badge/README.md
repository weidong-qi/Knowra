# Badge

只读状态胶囊：圆点 + 短文字。

## 规则

- 22px 高、11px / 500、999px 圆角。
- tone：`neutral`、`accent`（`accent-soft` + `accent-on-tint`）、`success`、`warning`、`danger`；每种用对应的 `*-soft` 底与同色 24% 描边。
- 文字 2–4 个汉字，描述状态（"已完成""同步失败"），不写动作。

## 使用方提供

- `tone`（`neutral` / `accent` / `success` / `warning` / `danger`）、`children`、可选 `hideDot`。

*源码：`status/Badge.tsx` 与 `Status.module.css`。运行时为 `window.Knowra.Badge`，需要页面先加载 React 18 与 ReactDOM 18。*

# EmptyState

空列表、空搜索、空知识库的占位。

## 规则

- `surface-page` + `border-subtle` + `radius-panel`，居中排版，14px 间距。
- 配 `EmptyArt` 插图：两张错落纸页 + 一枚强调色徽章，变体 `note`、`search`、`knowledge`；纯装饰，对读屏隐藏。
- 标题 14px / 500 说清"现在是什么状态"；描述 12px `text-secondary` 说"下一步可以做什么"，最宽 320px。
- 最多两个按钮：一个 `primary` + 一个 `default`。

## 使用方提供

- `title`、`description`、可选 `icon`（通常放 `<Knowra.EmptyArt variant="note" />`）、`primaryAction`、`secondaryAction`、`escapeAction`。

*源码：`status/EmptyState.tsx`、`EmptyArt.tsx` 与对应样式。运行时为 `window.Knowra.EmptyState`，需要页面先加载 React 18 与 ReactDOM 18。*

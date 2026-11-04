# Panel

带页眉页脚的中性容器，用于检查器和设置区块。

## 规则

- `surface-page` 底、`border-subtle`、`radius-panel`、`shadow-control`。
- 页眉/页脚 `surface-sidebar` 底、8/12px 内边距、12px / 500；正文 12px 内边距、10px 行距。
- `flush` 变体去掉正文内边距，放表格或列表。

## 使用方提供

- `title`（可带 14px 图标）、可选 `headerActions`、正文 `children`、可选 `footer`、`flush`。

*源码：`status/Panel.tsx` 与 `Status.module.css`。运行时为 `window.Knowra.Panel`，需要页面先加载 React 18 与 ReactDOM 18。*

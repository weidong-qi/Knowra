# IconButton

仅图标的圆形按钮，必须提供 `aria-label`。

## 变体（`tone`）

- `ghost`（默认）：透明 ghost，`text-secondary` 图标，悬停 `surface-hover`，`aria-pressed` 时 `surface-pressed`。用于工具栏、列表行尾的"更多""关闭"。
- `floating`：通透玻璃圆形，亮边 + 内高光，图标用 `accent`。用于浮在内容之上的快捷操作。
- `primary`：缎面橙——橙色渐变底、`border-action-satin` 描边、`shadow-action-satin`，图标 `text-on-action-satin`。全页最多一个，用于"新建"这类主入口。

## 使用方提供

- `aria-label`（必填）：动作的中文名，同时作为 Tooltip 文案。
- `children`：图标元素，例如 `<Knowra.Icons.EditIcon size={16} />`。
- `size`：24 / 28 / 30（默认）/ 40。
- 图标：来自 Knowra 图标库，16px 居中；`--knowra-icon-accent` 在本组件内取 `currentColor`。

*源码：`button/IconButton.tsx` 与 `IconButton.module.css`。运行时为 `window.Knowra.IconButton`，需要页面先加载 React 18 与 ReactDOM 18。*

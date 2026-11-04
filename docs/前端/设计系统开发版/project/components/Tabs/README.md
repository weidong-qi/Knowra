# Tabs

切换同一区域内的内容面板。

## 规则

- 标签页 34px 高、`radius-tab`；未选中 `text-secondary`，悬停 `surface-hover`。
- 选中项抬起：`surface-raised` + `shadow-control`、500 字重。不使用左侧或底部彩色强调条。
- 计数徽标 16px 胶囊，`surface-hover` 底。
- 键盘焦点用 `focus-soft`。

## 使用方提供

- `items`：`{ id, label, badge?, isDisabled? }` 列表。
- `children`：渲染函数 `(item) => 面板内容`；可选 `renderTab` 自定义标签。

*源码：`collection/Tabs.tsx` 与 `Collection.module.css`。运行时为 `window.Knowra.Tabs`，需要页面先加载 React 18 与 ReactDOM 18。*

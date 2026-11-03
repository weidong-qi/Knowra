# Tree

层级列表（文件夹、知识体系）。

## 规则

- 外框 `surface-page` + `border-subtle` + `radius-popover`；行 32px、`radius-control`。
- 缩进表达层级（每级 24px，经 `--indent` 传入）。
- 选中行保持中性：`surface-selected` 底、550 字重，不使用左侧强调条。
- 展开箭头是独立的 18px 按钮，不触发行选中。

## 使用方提供

- `items`：`{ id, label, count?, children?, isDisabled? }` 树、`ariaLabel`。
- React Aria Tree 的 `selectionMode`、`selectedKeys` / `defaultSelectedKeys`、`expandedKeys` / `defaultExpandedKeys`；可选 `renderExtras(item)` 在行尾加内容。

*源码：`collection/Tree.tsx` 与 `Collection.module.css`。运行时为 `window.Knowra.Tree`，需要页面先加载 React 18 与 ReactDOM 18。*

# Select

下拉选择：触发器与输入框同形，浮层由共享 Popover 管理。

## 规则

- 触发器：36px 高、`border-strong` 描边、`radius-control`、`shadow-control`；右侧 12px `text-muted` 箭头。
- 键盘焦点用 `focus-soft`。占位值用 `text-placeholder`。
- 列表浮层用玻璃材质（`border-overlay` + `shadow-overlay`）；选项 32px 高，聚焦 `surface-hover`，已选 `accent-soft` 底 + `accent-text` 字。
- 选项少于 3 个且需要一眼看全时，改用 `SegmentedControl`。

## 使用方提供

- `label`、`options`（`{ id, label, description?, isDisabled? }` 列表）、`selectedKey` 与 `onSelectionChange`。
- 工具栏里用 `presentation="toolbar"`（28px）；可选 `leadingIcon`、`placeholder`、`isInvalid` / `errorMessage`。

*源码：`input/Select.tsx`、`Input.module.css` 与 `Collection.module.css` 的 listbox 部分。运行时为 `window.Knowra.Select`，需要页面先加载 React 18 与 ReactDOM 18。*

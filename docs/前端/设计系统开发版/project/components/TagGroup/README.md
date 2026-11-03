# TagGroup

可选择、可移除的标签组。

## 规则

- 标签 26px 胶囊、11px / 450；色调（tone）只用于浅底、圆点与文字：`neutral`、`accent`、`success`、`warning`、`danger`。
- 选中：浅底 + 内描边、600 字重。
- 状态含义必须同时有文字，不只靠颜色区分。
- 可选计数用 `tabular-nums`。

## 使用方提供

- `label`、`items`：`{ id, label, tone?, count?, hideDot?, isDisabled? }`。
- 可选 `onRemove(keys)`（出现移除按钮）、`selectionMode`、`trailing`、`visibleLabel`。

*源码：`collection/TagGroup.tsx` 与 `Collection.module.css`。运行时为 `window.Knowra.TagGroup`，需要页面先加载 React 18 与 ReactDOM 18。*

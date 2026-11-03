# SideNavItem

侧栏导航行：图标 + 标签 + 可选计数。

## 规则

- 34px 高（`compact` 30px）、`radius-control`、13px / 450。
- 当前项（`aria-current="page"`）：抬起为 `surface-raised` + `border-subtle` + `shadow-control`、600 字重，图标变 `accent`。
- **不加左侧竖线强调条**——选中只靠底色、字重和图标色。
- 计数靠右、`text-muted`、`tabular-nums`。

## 使用方提供

- `icon`（18px 槽位）、`label`、可选 `count`、`density`（`regular` / `compact`）。
- 当前项传 `aria-current="page"`；点击用 `onPress`。

*源码：`navigation/SideNavItem.tsx` 与 `SideNavItem.module.css`。运行时为 `window.Knowra.SideNavItem`，需要页面先加载 React 18 与 ReactDOM 18。*

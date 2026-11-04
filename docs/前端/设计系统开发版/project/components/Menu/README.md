# Menu

下拉菜单与右键菜单。右键菜单走 `components/ui/overlay/Menu`，普通坐标锚点用 `PointMenu`。

## 规则

- 玻璃材质：半透明渐变底、`border-overlay` 亮边、`shadow-overlay`、背景模糊 14px；设置里可切到亚克力（acrylic）材质。
- 菜单 200–320px 宽、`radius-popover`、6px 内边距；项 30px 高、7px 圆角、13px 字。
- 聚焦项 `surface-hover`；危险项 `color-danger` 文字，聚焦 `color-danger-soft`；禁用项 `text-muted`。
- 分组标题 11px / 500 `text-muted`；快捷键右对齐，等宽 10px。
- `rich` 变体：带 30px 图标底板和说明行的操作面板。
- 入场 180ms 从触发点轻微缩放弹出；退场 110ms。减少动效时不播放动画。

## 使用方提供

- `MenuTrigger` 的两个子元素：触发按钮与 `MenuPopover`；`Menu` 上的 `ariaLabel`、`onAction`、可选 `variant="rich"`。
- `MenuItem`：`id`、`icon`、文字、可选 `kbd`、`description`、`isDanger`、`isDisabled`；分组用 `MenuSection` + `MenuHeader`，分隔用 `MenuSeparator`。

*源码：`overlay/Menu.tsx` 与 `Overlay.module.css`。运行时为 `window.Knowra.Menu`，需要页面先加载 React 18 与 ReactDOM 18。*

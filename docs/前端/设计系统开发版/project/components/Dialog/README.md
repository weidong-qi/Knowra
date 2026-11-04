# Dialog

业务弹窗统一用这个组件（`Dialog` + `DialogBody` + `DialogFooter`）。

## 规则

- 面板：`surface-page`、`border-subtle`、`radius-panel`、`shadow-popover`；宽度 `sm` 440px、`md` 640px，最高 80vh，内容区独立滚动。
- 页眉 18/22px 内边距、16px / 600 标题；页脚 `surface-sidebar` 底，按钮靠右。
- 遮罩 24% 墨色；入场 200ms 上移 8px 淡入。
- 设置里可切换"浮起卡片 / 内嵌托盘"等样式，只改圆角、分割线和托盘。
- 忙碌时用 `busyOverlay` 覆盖内容并显示骨架。

## 使用方提供

- `DialogTrigger` 的两个子元素：触发按钮与 `Dialog`；或受控的 `isOpen` / `onOpenChange`。
- `Dialog`：`title`、可选 `description`、`size`（`sm` / `md`）、`isPending`、`isDismissable`。
- 内容放 `DialogBody`，按钮放 `DialogFooter`，关闭按钮用 `DialogClose`（`variant`、可选 `onClose`；主按钮在最右，取消用 `ghost`）。

*源码：`overlay/Dialog.tsx` 与 `Overlay.module.css`。运行时为 `window.Knowra.Dialog`，需要页面先加载 React 18 与 ReactDOM 18。*

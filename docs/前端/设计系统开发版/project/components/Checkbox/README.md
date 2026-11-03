# Checkbox

复选框；选中与不确定状态共用 `accent-solid` 实底与 `text-on-accent` 勾。

## 规则

- 18px 方框、4px 圆角、`border-strong` 描边；悬停描边变 `accent`。
- 焦点只围绕方框：2px `accent-text` outline + `focus-ring`。
- `size="compact"` 变体 14px，用于表格行选择。
- 校验失败时方框描边 `color-danger`。

## 使用方提供

- `children`：说明选中后会发生什么，例如"包含子文件夹"。
- `isSelected` / `isIndeterminate` / `onChange`。

*源码：`input/Checkbox.tsx` 与 `Input.module.css`。运行时为 `window.Knowra.Checkbox`，需要页面先加载 React 18 与 ReactDOM 18。*

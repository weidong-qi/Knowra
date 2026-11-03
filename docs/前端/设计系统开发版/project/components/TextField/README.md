# TextField

单行输入框；多行用同族的 `TextAreaField`，两者共用外壳样式。

## 规则

- 外壳独占描边和焦点：`border-strong` 描边、`radius-control`（多行为 `radius-popover`）、`surface-page` 底、`shadow-control`；原生 input 透明无边。
- 聚焦不加粗描边，改为 `focus-soft` 淡橙细环。
- 校验失败（`isInvalid`）：描边 `color-danger`、底色 `color-danger-soft`，下方错误文字带圆圈"!"。
- 禁用：`surface-hover` 底，`text-muted` 文字。
- 触屏下输入字号至少 16px，避免 iOS 自动缩放。

## 使用方提供

- `label`（12px / 500 / `text-secondary`），必填项加 `isRequired`（红色星号）。
- 可选 `description`（帮助文字）与 `errorMessage`。
- `placeholder` 用 `text-placeholder`，写示例而不是重复标签。

*源码：`input/Input.tsx`、`TextAreaField.tsx` 与 `Input.module.css`。运行时为 `window.Knowra.TextField`，需要页面先加载 React 18 与 ReactDOM 18。*

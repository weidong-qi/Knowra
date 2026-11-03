# FileDropField

导入附件与资料的拖放区。

## 规则

- 最小 152px 高、1px 虚线 `border-strong`、`radius-panel`、`surface-sidebar` 底。
- 拖入时描边 `accent`、底色 `accent-soft`，标签改成"松开即可导入"。
- 内含原生 file input（视觉隐藏），聚焦时整个区域显示焦点环。

## 使用方提供

- `label`、`description`（写清格式和大小上限）、`accept`（如 `".md,.pdf,image/*"`）、可选 `multiple`、`isDisabled`，以及 `onSelect(files)`。

*源码：`file/FileDropField.tsx` 与 `FileDropField.module.css`。运行时为 `window.Knowra.FileDropField`，需要页面先加载 React 18 与 ReactDOM 18。*

# SegmentedControl

成组切换按钮：`SegmentedControl` 外壳 + 若干 `SegmentedButton`，一组里恰好一个 `aria-pressed`。

## 何时使用

- 在同一视图内切换筛选、视图模式、排序——不触发导航时用它；切换内容面板用 `Tabs`。
- 默认：`surface-hover` 胶囊轨道，选中项抬起为 `surface-raised` + `shadow-control`。
- `density="compact"`：22px 高，放进工具栏；`density="comfortable"`：28px、13px 字。
- `variant="underline"`：下划线分区，选中项 `accent-text` 文字 + 2px `accent` 下边线、600 字重。

## 使用方提供

- `SegmentedControl` 上的 `aria-label`；每个 `SegmentedButton` 的文字（2–4 个汉字）、`aria-pressed`、`onPress` 和可选 `count`；计数用 `tabular-nums`，静止 `text-muted`，选中 `text-secondary`。
- 仅图标时加 `iconOnly` 和 `aria-label`。

*源码：`button/SegmentedControl.tsx` 与 `SegmentedControl.module.css`。运行时为 `window.Knowra.SegmentedControl`，需要页面先加载 React 18 与 ReactDOM 18。*

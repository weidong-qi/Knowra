# Switch

即时生效的开关：标签居左、轨道居右，整行可点。

## 规则

- 轨道 34 × 20px，关闭为 `surface-pressed`，打开为 `accent-solid`；滑块 16px 白色圆点。
- 只用于立即生效的设置；需要"保存"才生效的选项用 `Checkbox`。

## 使用方提供

- 标签文字（设置项名称，不写"开启/关闭"）。
- `isSelected` 与 `onChange`。

*源码：`input/Switch.tsx` 与 `Input.module.css`。运行时为 `window.Knowra.Switch`，需要页面先加载 React 18 与 ReactDOM 18。*

# Button

常规文字按钮，封装 React Aria `Button`；仅图标的按钮请用 `IconButton`。

## 何时使用

- 变体决策顺序：**danger → primary → ghost → default**。
- `primary`（`accent-solid` 底 + `text-on-accent`）：当前容器里最关键的一个动作——保存、创建、确定、导入、新建。一个容器最多一个。
- `default`：普通动作，`surface-page` 底、`border-subtle` 发丝边、`shadow-control`。
- `ghost`：次要动作——取消、关闭、返回；静止无底，悬停出 `surface-hover`。
- `danger`：破坏性动作——删除、移除、归档；文字 `color-danger`，悬停出 `color-danger-soft`。
- `emphasis="soft"`：卡片内的低强调入口（"查看"），`accent-soft` 底 + `accent-on-tint` 字。

## 使用方提供

- `children`：动词开头的简短中文，例如"新建笔记""导入资料"，不加句号。
- `icon`：可选，14px 图标放在文字前。
- `size`：`default`（36px）、`workspace` / `toolbar`（28px，工作区工具栏）、`compact`（29px，密集卡片）、`mini`（27px）、`footer`（22px，底栏分页）。
- `shape`：默认 `pill`（胶囊）；`square` 用 `radius-control`。主题不得把通用圆角改成胶囊。
- `isPending`：保存中，禁止按压但保留焦点。

## 规则

- 外观与尺寸只在组件库里维护；业务 CSS 只负责排列，不另写按钮样式。
- 键盘焦点：2px `accent-text` 实线 outline（偏移 2px）加 `focus-ring` 光晕；鼠标点击不显示。
- 触屏与 767px 以下，最小高度抬到 `touch-target`（44px）。

*源码：`apps/web-v4/src/components/ui/button/Button.tsx` 与 `Button.module.css`。运行时为 `window.Knowra.Button`，需要页面先加载 React 18 与 ReactDOM 18。*

# SearchBox

全站唯一的搜索框组件（外壳为 `SearchSurface`）。业务页面不得自写同类样式。

## 规则

- 静止：`surface-hover` 灰底 + `border-subtle` 发丝线；悬停加深到 `surface-pressed`。
- 聚焦：白底（`surface-raised`）、发丝线略深（`border-strong`），不用橙色环。
- 尺寸变体：`field`（36px，表单内）、`toolbar`（28px 胶囊，工作区工具栏）、`sidebar`（32px，半透明白底，压在磨砂侧栏上）、`command`（命令面板，14px 字）。
- 快捷键提示用 `kbd` 字样（等宽 10px、`border-subtle` 小框）。

## 使用方提供

- `label`（必填，作为无障碍名称）、`size`（`field` / `toolbar` / `sidebar` / `command`）。
- `placeholder`：说明能搜什么，例如"搜索笔记、知识点和试题"。
- 可选 `onClear`：出现共享清除按钮，同时隐藏浏览器原生清除入口。
- 可选 `shortcut`（如 `"⌘K"`）；`value` / `onChange` 为原生 input 属性。

*源码：`input/SearchBox.tsx` 与 `SearchBox.module.css`。运行时为 `window.Knowra.SearchBox`，需要页面先加载 React 18 与 ReactDOM 18。*

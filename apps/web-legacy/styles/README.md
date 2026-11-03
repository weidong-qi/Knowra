# 前端 UI 样式导航

`apps/web/styles/` 承载主应用运行时样式。

## 主应用样式入口

| 文件 | 职责 |
| --- | --- |
| `tokens.css` | 设计 token：颜色、字体、间距、圆角、阴影、布局尺寸（旧版，被 knowra 体系覆盖） |
| `components.css` | 主应用组件样式聚合入口，只维护 `@import` 顺序 |
| `components/knowra-theme-tokens.css` | 正式 InkGrid UI 的语义 token（被 knowra-inkgrid 加载，权威） |
| `components/knowra-inkgrid.css` | InkGrid 正式视觉层聚合入口 |
| `components/knowra-inkgrid-*.css` | 按职责拆分的 InkGrid 视觉模块（shell / library-index / editor / menus / typography） |
| `components/*.css` | 旧版样式层，仍被 `components.css` 加载供非 knowra 区块使用 |

旧的 `knowra-redesign.css` 和未带 `inkgrid` 后缀的职责文件保留为直接引用兼容代理；主入口只加载 `knowra-inkgrid.css`，避免重复输出样式。

> **新 UI 视觉变量的唯一事实来源**：`apps/web/styles/components/knowra-theme-tokens.css`。其他新增 UI 必须引用本文件 token，不得另起一份。

## 离线 UI 镜像

Knowra 正式 UI 的离线镜像位于 `docs/已归档/前端重构（瑞士编辑风格V1.0）/新UI测试demo/Knowra整合UI.html`，单文件可双击打开，与 `npm run dev:web` 后的 `localhost:3000` 视觉一致。详情见该目录下的 README。

## 维护规则

- 任何 demo / 试验性样式不得放入 `apps/web/styles/`；如需新增，请放在 `docs/` 下的独立目录
- 新增 UI 必须先在 `knowra-theme-tokens.css` 补充 token，再在对应 `knowra-inkgrid-*.css` 添加选择器；不得硬编码视觉值
- 旧 `*.css` 仍保留是为了兼容尚未迁移到 knowra 体系的子模块；新增功能不应继续依赖旧样式

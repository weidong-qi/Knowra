# V4 笔记索引顶部压缩视觉 QA

日期：2026-08-23

## 范围

本轮只核验 `/materials` 的第一阶段索引骨架顶部：共享位置路径、紧凑信息带、工具栏相邻关系、平面主区层级，以及窄屏不破坏主区。列表数据和完整筛选/分页业务不在本轮范围。

## 浏览器与证据

- 首先尝试 Codex Desktop in-app Browser；运行时返回 Browser is not available，因此按 Product Design Browser Choice 使用 Chrome extension 作为备用，并完成同样的 DOM、console 与截图核验。
- 桌面默认视口（运行时 1536×695）：[desktop-1536x695.png](test-results/notes-index-header/desktop-1536x695.png)
- 目标桌面视口 1920×900：[desktop-1920x900-final.png](test-results/notes-index-header/desktop-1920x900-final.png)
- 窄桌面 920×900：[narrow-920x900.png](test-results/notes-index-header/narrow-920x900.png)
- 移动 390×844：[mobile-390x844-final.png](test-results/notes-index-header/mobile-390x844-final.png)

## 结果：passed

- `/materials` 顶部为一层紧凑信息带：marker、`笔记库 / 全部笔记`、项目数、视图/排序摘要与导入/新建动作；工具栏紧随其下。
- 顶部只有一个 level-1 `全部笔记`，`aria-current="page"`；底部 StatusBar 使用同一 canonical path，显示 `主页 / 笔记库 / 全部笔记`，没有 latent selected note 标题。
- 桌面运行态：侧栏宽 224px，主区独立滚动，StatusBar 高 32px；主区 `overflow-y: auto`，Context Sidebar `overflow-y: auto`，window 没有额外主滚动。
- 920px：上下文侧栏按既有断点隐藏，主区仍完整可达，顶部动作有序换行。
- 390px：AppShell stage 的网格轨道可收缩；顶部信息、动作和工具栏按序换行，列表改为名称/状态/操作三列，页面级横向滚动不出现（表格内容不再撑开视口）。
- Chrome console：未发现 error/warn。
- 键盘焦点：从主区按钮按 Tab 后，导入按钮保留蓝色硬阴影焦点提示，焦点可见。

## 备注

in-app Browser 不可用是环境能力限制，已如实记录；备用 Chrome 仅用于本地页面只读核验和截图，没有外部副作用。

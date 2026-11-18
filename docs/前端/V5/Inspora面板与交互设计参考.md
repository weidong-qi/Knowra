# Inspora 面板视觉、交互与动效设计参考（2026-11）

> 来源：`https://www.inspora.design/saved` 收藏页面中的 30 项设计卡片及 4 幅核心面板操作截图。本文沉淀其视觉层级、交互模式、动效节奏以及在 Knowra V5 中的五条落地方向（A～E）。

---

## 一、核心视觉语言解剖

### 1. 「外托盘 + 内白卡（Tray-in-Tray）」双层表面架构

在标签选择器（`dropdown interaction`）、日期选择器（`Trip Dates`）、迷你日历（`Mini calendar`）、AI 代理工台（`Coding agent`）及模型路由（`Model router`）等面板中，最显著的共同特征是**两级表面嵌套**：

- **外层浅冷灰托盘（Outer Tray）**：
  - 浅色模式下使用偏冷的浅灰底（如 `#F3F4F6` / `color-mix(in srgb, var(--surface-chrome) 60%, var(--surface-sidebar-solid))`），深色模式下对应低一档明度的深炭底（`var(--surface-sidebar-solid)`）。
  - 外部保持 `6px–8px` 内边距包裹内层白卡，外圆角 `18px–22px`（遵循同心圆角规律：外圆角 ≈ 内圆角 + 托盘内边距）。
  - 承载**三段式空间分工**：
    1. **托盘顶栏（Tray Header）**：直接坐落在外层灰底上，用于显示面板标题、统计徽章（如 `14 nights`、`62`）或钻取上下文（如 `🏷 Create ● Database`）。
    2. **内层主白卡（Inner Surface）**：以纯白凸起卡片（`var(--surface-raised)`、圆角 `12px–14px`、`1px` 细描边与轻微抬升阴影）承载搜索、列表、日历或复合输入区。
    3. **托盘底栏（Tray Footer）**：坐落在外层灰底底部，用于放置已选计数、快捷预设胶囊（如 `Weekend`、`3 nights`、`Clear`）或主次提交按钮。

### 2. 1px 发丝线、多层柔影与折射高光

- **极细轮廓**：浅色模式下用 `1px` 半透明轮廓（`rgb(24 30 48 / 6%–8%)`），深色模式下搭配顶边 `inset 0 1px 0 rgb(255 255 255 / 12%)` 的玻璃/丝缎高光。
- **多层环境投影**：由近及远 2～3 层柔和投影（近处接触阴影 + 远距弥散投影），避免硬位移阴影或厚重边框。
- **胶囊与圆点（Pill with Dot）**：
  - 标签、状态、分类尽量避免高饱和实色块满铺，而是使用**浅底/白底 + 1px 细描边 + 7px/8px 高饱和彩色圆点**。
  - 选中态仅叠加 `8%` 同色淡染与 `38%` 同色细边，保持整体克制通透。

### 3. 排版密度与数字对齐

- **等宽数字对齐（`tabular-nums`）**：所有计数徽章、日期格子、价格/耗时/配额指标全部开启 `font-variant-numeric: tabular-nums`，保证动态变化时不产生宽度抖动。
- **紧凑行高与温和字距**：下拉列表行高控制在 `32px–34px`，水平内边距 `8px`；标题紧凑（`-0.01em`），辅助说明退居 `11px–12px` 弱化灰。

---

## 二、典型交互与动效模式

### 1. 按需显隐的多选复选框（Progressive Checkbox Disclosure）

- **默认态**：未选中的行左侧留出固定宽度或自然留白，仅显示彩色圆点与标签名称（页面极度干净，无满屏方框噪声）。
- **悬停 / 聚焦态**：当指针移入或键盘聚焦到某一行时，圆角高亮底板迅速跟进，左侧同时浮现空心圆角复选框（`16×16`、`border-radius: 5px`），提示「可勾选」。
- **已选态**：勾选后方框转为实心并常驻（带白色对勾 `✓`），触发一次轻量微弹跳（`scale(0.86) -> scale(1.06) -> scale(1)`，`180ms cubic-bezier(0.22, 1, 0.36, 1)`）。

### 2. 原位叠层钻取（In-Place Stacked Drill-Down）

- 在搜索框输入新名称并触发新建时，**不跳出第二层独立模态弹窗**，而是留在同一块浮层内切换视图：
  - 外托盘顶栏立即切换为上下文眉题（例如显示返回入口与实时预览胶囊 `● 新标签名称`，颜色随下方色点选择实时同步）。
  - 内层白卡以轻度步进位移动效平滑切换为命名/分组/选色面板。

### 3. 内联色点选择器与复合输入器

- **内联色点网格**：每个颜色显示为柔和圆点，悬停轻微放大（`scale(1.08)`），选中态叠加内白勾 `✓` 与双环聚焦描边，无需弹出复杂调色盘即可完成高频选色。
- **复合输入器（Inline Composer）**：如 `Mini calendar` 底部的双栏输入框（名称 + 时间）与色点 + 操作按钮组合成同一张内嵌白卡；AI 提示词栏将附件、范围、模型选择收拢进圆角输入卡底栏。

### 4. 光标跟随高亮与分段滑块

- 列表高亮底板与分段控制器（`SegmentedControl`）采用短促干脆的过渡曲线（`120ms–180ms`），点击胶囊与开关保持轻度按压缩放反馈（`scale(0.98)`）；所有动画在 `prefers-reduced-motion: reduce` 下自动降级禁用。

---

## 三、Inspora 收藏页 30 项灵感全览索引

| 分类 | 代表作品 | 可复用至 Knowra 的核心亮点 |
| --- | --- | --- |
| Motion | `dropdown interaction` (DejvDesign) | 叠层托盘下拉、搜索即建、悬停显隐复选框、原位颜色钻取 |
| Motion | `File upload card` (Dawood) | 拖放区域悬停文件胶囊时的微光与叠层文件夹动效 |
| Motion | `Animated thinking orb` / `Thinking states` | AI 推理中多阶段呼吸与状态语言 |
| Motion | `interactive folder cards` (damien) | 文件夹卡片展开预览层叠内容 |
| Product | `Date Range Picker` (Jeet) | 双栏日期卡、跨日连续浅色胶囊范围条、底部快捷预设胶囊栏 |
| Product | `Mini calendar` (Jeet) | 280px 紧凑日历、事件彩点、底部内联复合输入框与直选色点 |
| Product | `Soft glass workspace picker` (Kyle Thacker) | 磨砂玻璃顶边折射高光、工作区对勾指示 |
| Product | `AI Agent Approval Cards` / `Agent Plan` | 待审批清单内嵌白卡、状态徽章（`Approved` / `Planned`）、快捷键提示 |
| Product | `Coding agent` / `Deploy Pipeline` / `RAG Pipeline` | 线性多阶段轨迹条（检索 → 组装 → 引用）与折叠日志抽屉 |
| Product | `AI prompt bar` / `Chat component interaction` | 聚焦渐亮描边输入卡、斜杠菜单与附件标签栏 |
| Product | `Model router` / `Usage meter component` | 分段模式切换、分段配额进度条与按天柱状分布 |
| Product | `Sidebar Active State` / `Task Card` / `Folders UI` | 侧栏高亮指示与面包屑卡片头部 |

---

## 四、Knowra 五大应用方向路线图（A～E）

### 方向 A：通用多选列表与「叠层托盘」浮层结构【已优先落地】

- **落点**：`apps/web/src/features/notes/NotesIndexMenus.module.css`、`apps/web/src/features/tags/TagPickerDialog.module.css`
- **内容**：
  - 引入按需显隐复选框（精细指针悬停/聚焦浮现空心框、勾选后实心常驻并触发 `checkboxPop` 微弹跳）。
  - 列表行采用 `8px` 圆角柔和悬停底与紧凑 `32px–34px` 行高。
  - 浮层外托盘（`var(--surface-chrome)` / `var(--surface-sidebar-solid)` 混色）包裹内层圆角白卡（`var(--surface-raised)`）。

### 方向 B：标签胶囊与标签选择器全面升级【已优先落地】

- **落点**：`apps/web/src/features/tags/TagChip.module.css`、`TagPickerDialog.tsx`、`TagPickerViews.tsx`、`apps/web/src/components/ui/input/ColorPicker.tsx` & `.module.css`
- **内容**：
  - `TagChip` 升级为白底细描边 + `7px` 饱满圆点 + 温和淡染选中态，支持细腻悬停投影与轻按缩放。
  - `TagPickerDialog` 改为外灰托盘顶栏（含表单态实时预览色点胶囊）+ 内白卡搜选一体区 + 托盘底栏计数与保存按钮；标签选择由拥挤胶囊墙转为清晰的 Inspora 式多选列表行。
  - `ColorPicker` 色板圆点紧凑化并增加选中态白色对勾 `✓` 与同色双环高亮。

### 方向 C：笔记索引筛选/显示面板与首页活跃度日历【后续储备】

- **落点**：`apps/web/src/features/notes/NotesIndexFilterMenu.tsx`、`NotesIndexDisplayMenu.tsx`、`src/views/HomeActivity.tsx`
- **方向**：
  - 为 `NotesIndexFilterMenu` 与 `NotesIndexDisplayMenu` 引入外托盘内白卡分层，筛选标签内联搜索与底部快捷预设胶囊（如「今天 / 近 7 天 / 清空」）。
  - 参考 `Mini calendar` 优化首页近况更新分布图与日期活动气泡提示。

### 方向 D：AI 助手面板体系升级【后续储备】

- **落点**：`apps/web/src/features/assistant/`（`ConversationView`、`ConversationTrace`、`AIInbox`）、`apps/web/src/features/settings/`
- **方向**：
  - 参考 `AI prompt bar` 优化对话复合输入卡的聚焦光泽、范围胶囊与附件条目。
  - 参考 `RAG Pipeline` / `Coding agent` 优化 `ConversationTrace` 工具调用阶段轴与参数卡片。
  - 参考 `AI Agent Approval Cards` / `Agent Plan` 优化 `AIInbox` 的新稿/修订审阅托盘与采纳操作栏。
  - 参考 `Usage meter component` 完善用量与预算进度条视觉。

### 方向 E：全局 UI 浮层变体与系统级微动效【后续储备】

- **落点**：`apps/web/src/components/ui/overlay/Popover.tsx`、`Overlay.module.css`、`SegmentedControl.module.css`
- **方向**：
  - 为通用 `Popover` 沉淀可选 `appearance="tray"` 变体，供更多业务浮层直接复用。
  - 完善多步钻取面板的高度/内容平滑过渡与 `SegmentedControl` 滑动指示器动效。

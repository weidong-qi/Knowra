# InkGrid 组件库 v2.3 设计 QA

## Source and implementation

- Source visual truth: `docs/前端重构/印格/印格设计系统-组件库.html` 的第 08 节导航与原组件视觉语言。
- Implementation: `docs/前端重构/印格/印格设计系统-组件库-精修版.html`。
- Browser-rendered source capture: `/private/tmp/inkgrid-source-section08.png`。
- Browser-rendered implementation capture: `/private/tmp/inkgrid-v23-section08.png`。
- Viewport and pixels: source与实现均为 1280 × 720 CSS px、1280 × 720 输出像素；无缩放或密度归一化。
- State: 浅色主题；第 08 节可见；实现中导航和目录分别展示选中态。

## Full-view comparison evidence

- 原版和精修版保持相同点阵纸面、零圆角、墨色边界、强调蓝、208px 功能栏与 232px 目录栏结构。
- 精修版将选中态从单一蓝线升级为浅蓝实体面、墨色边界、蓝色图标方章与轻硬影，同时保持信息密度和原内容不变。
- 侧栏标题、目录标题与检查器统一使用蓝色定位线和方形图标容器，没有引入圆角、渐变或新的插画风格。

## Focused region comparison evidence

- 第 08 节：功能导航、资料目录、232px 辅助侧栏和 300px InspectorWide 已逐项检查。
- 第 09 节：激活卡与禁用卡的顶部定位线、图标硬影、状态尾注和对比度已检查。
- 第 10 节：模块 Tab 与文档 Tab 的 hover / active 实体层级已检查。
- 第 14 节：最近编辑表格与资料列表行的标题头、图标、选中面、标签和动作按钮已检查。
- 图片资产：组件库仅使用现有 Remix Icon 字体图标，无位图、插画、品牌图或自绘 SVG 需要核对。

## Required fidelity surfaces

- Fonts and typography: 沿用原系统字体栈与 10–15px 控件字号；分组标题继续使用等宽小字，不改变中文层级。
- Spacing and layout rhythm: 保留 208 / 232 / 300px 侧栏规格；导航 38px 行高、侧栏 56px 标题头和数据行 54–94px 密度一致。
- Colors and visual tokens: Tier D 恢复 `#F4F1EA`；选中面使用既有 `--ink-accent-bg`；没有新增渐变。
- Image quality and asset fidelity: 不适用；所有可见图标来自 Remix Icon，清晰度随字体渲染。
- Copy and content: 原有中文组件名称、示例资料和规则说明保留；只更新过时的状态描述与版本信息。

## Primary interactions tested

- 功能导航选择、目录树选择。
- 模块 Tab、文档 Tab 切换。
- 资料列表行选择。
- 232px 辅助侧栏折叠与 `aria-expanded` 同步。
- 浏览器控制台 error / warning：无。
- 页面横向溢出：1280px 视口下 `scrollWidth === innerWidth`。

## Findings

- 无 P0 / P1 / P2 问题。
- P3：长导航示例内部需要滚动才能看到所有分组，这是固定高度组件演示的预期行为。

## Comparison history

- 首轮 P2：第 08 节三个区域因父容器未显式声明 flex 而纵向堆叠。
- Fix：为 `.navigation-showcase` 增加明确 flex 布局，并将功能栏与目录栏统一为 650px 演示高度、功能栏内部滚动。
- Post-fix evidence：1280 × 720 截图显示 208px 功能栏、232px 目录栏和规则区并排，无横向溢出。
- 首轮 P3：禁用功能卡对比度偏低。
- Fix：禁用卡透明度由 0.72 调整为 0.82，继续保留不可用语义但改善可读性。

final result: passed

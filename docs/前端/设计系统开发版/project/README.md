知境 Knowra 是一个本地优先的个人知识与考卷工作台：笔记、知识点、试题放在同一个空间里。界面安静、紧凑、像一张干净的工作台——中性灰白打底，一抹橙色只出现在"你现在在哪、该做什么"的地方。

## 内容基调

- 界面文字用简体中文；代码标识符、快捷键、文件格式用英文（`⌘K`、`Markdown`、`PDF`）。
- 用"你"指用户，但大多数时候直接省略主语："新建笔记""移到回收站""这个文件夹还没有笔记"。
- 按钮是动词开头的 2–5 个字，不加句号："导入资料""创建副本""查看全部"。
- 状态写成名词短语："已完成""待复习""同步失败"；进行中写"正在 + 动作…"："正在载入笔记…"。
- 破坏性操作在对话框里说清后果和退路："文件夹里的 12 篇笔记会一起移到回收站，30 天内可以恢复。"
- 空状态先说现状，再给下一步："这个文件夹还没有笔记 / 新建一篇，或把 Markdown、PDF 拖进来导入。"
- 不用感叹号，不用 emoji，不用"哎呀""太棒了"这类情绪词。数字用阿拉伯数字，与汉字之间不加空格以外的符号。

## 颜色

- **底色分三层。** 外壳是 `surface-chrome`（浅灰）；内容面板是 `surface-page`，带 `shadow-page` 浮在外壳上，面板之间留 `shell-gap`（8px）缝隙；侧栏、页眉页脚、对话框底栏用低一档的 `surface-sidebar`。
- **交互叠层是半透明墨色。** 悬停 `surface-hover`、按下 `surface-pressed`、中性选中 `surface-selected`；它们叠在任何表面上都成立，不要换成实色。
- **抬起表示"当前"。** 分段控件、标签页、侧栏导航的当前项用 `surface-raised` + `shadow-control` 抬起，而不是染色。
- **文字四档。** `text-primary` 标题与控件文字；`text-body` 笔记长段落；`text-secondary` 标签与描述；`text-muted` 计数、快捷键与禁用。占位用 `text-placeholder`。
- **橙色要克制。** `accent`（#f26b1d）在白底上只有 3:1，只用于图标、圆点、描边、进度条等非文字元素。橙色文字一律用 `accent-text`；实色主按钮、复选框、开关用 `accent-solid` 配 `text-on-accent`；浅底用 `accent-soft` 配 `accent-on-tint`。一个视图里只有一个实色橙按钮。
- **状态色**：`color-info`、`color-success`、`color-warning`、`color-danger`、`color-violet`，各配一个 `*-soft` 浅底。状态必须同时有文字或图标，不靠颜色单独表达。
- **深色主题**由同一套名字换值：底色变为近黑、墨色叠层改为白色叠层、`accent-text` 提亮为 #ff9a62，`accent-solid` 压暗（源码以 `color-mix(accent 72%, #17181c)` 计算）以免刺眼。

## 主题

当前只保留 **现橙·浅色 / 现橙·深色**，使用同一套变量名称，分别配置浅色和深色数值。

现橙·深色的主按钮文字（92% 白，源码原值）对比度为 4.4:1，悬停时为 3.7:1，保留原值未改。

## 字体与排版

- 一套无衬线 `font-ui`（Inter 优先，中文回落 PingFang SC / Noto Sans SC / 微软雅黑），一套等宽 `font-mono`（JetBrains Mono）。产品不打包字体文件，依赖系统已安装字体。
- 界面默认 `ui`（13px）；元信息、字段标签用 `meta`（12px）；徽标、标签、计数用 `caption`（11px）。
- 笔记正文用 `note-body`（15px / 1.75，颜色 `text-body`）；文档标题 `note-title`（34px / 700，字距 -0.6px）。正文 H1–H6 使用相对字号 2.25em、1.75em、1.5em、1.25em、1em、1em，随正文缩放。
- 计数、分页、时间一律 `font-variant-numeric: tabular-nums`。
- 字重常用 400 / 450 / 500 / 600；450 是导航与标签的静止字重，选中提到 600。

## 间距、尺寸与布局

- 间距阶梯 `space-1`…`space-7`：4 / 8 / 12 / 16 / 24 / 32 / 48px。组件内的 5px、7px、9px、11px 等是源码精确值，照抄，不要对齐到网格。
- 外壳常驻：左侧图标栏 `rail-size`（50px）、上下文侧栏 `sidebar-size`（240px）、内容区、右侧检查器 `inspector-size`（288px）；顶栏 `topbar-size`（42px）、状态栏 `status-size`（32px）。侧栏、内容区和辅助面板各自独立滚动。
- 常规控件 36px 高，工作区工具栏 28px，紧凑控件 `control-size`（32px）。
- 触屏或宽度 767px 以下，所有按钮、输入、列表行、标签页最小高度抬到 `touch-target`（44px），输入字号至少 16px。

## 形状

- 两类形状共存：**内容、表单、导航用小圆角**——`radius-control`（7px）输入/菜单项/导航项，`radius-tab`（8px）标签页，`radius-popover`（10px）菜单与多行输入，`radius-panel`（12px）面板与对话框；**轻量操作与标签用胶囊** `radius-pill`——按钮、图标按钮、分段控件、徽标、标签。
- 主题不得把通用圆角改成胶囊；按钮形状由组件的 `shape` 显式选择。

## 边框与阴影

- 边框是发丝线：`border-subtle` 用于分隔与按钮，`border-strong` 用于输入、下拉、复选框、标签，`border-control` 用于需要明确边界的控件。
- 阴影短而轻：控件 `shadow-control`（一圈发丝环 + 1px 投影）；内容面板 `shadow-page`；对话框 `shadow-popover`；菜单与下拉 `shadow-overlay`（配玻璃材质）。
- 浮层材质有两种，在设置里切换：**玻璃**（14px 模糊、半透明渐变底、`border-overlay` 亮边）和**亚克力**（28px 模糊、更实的底）。
- **不使用左侧竖线强调条**表示选中或分类——选中靠底色、抬起、字重和图标色。

## 状态与焦点

- 键盘焦点：按钮、标签、列表行用 2px `accent-text` 实线 outline（偏移 2px）加 `focus-ring` 3px 淡橙光晕；文本框、搜索框、下拉、标签页用 `focus-soft` 淡橙细环，不加粗描边。鼠标点击不显示焦点环。
- 校验失败：描边 `color-danger`、底色 `color-danger-soft`、聚焦 `focus-ring-danger`。
- 禁用：`surface-hover` 底、`text-muted` 字、0.5–0.65 透明度、`not-allowed` 光标。
- 强制色模式下阴影会被移除，焦点改用系统 `Highlight` 实线描边。

## 动效

- 三档时长：快 130ms（悬停、颜色、阴影过渡）、中 200ms（对话框与遮罩入场）、图标栏 120ms；缓动 `cubic-bezier(.4, 0, .2, 1)`。
- 浮层从触发点轻微缩放弹出（180ms，`cubic-bezier(.16, 1, .3, 1)`），退场 110ms；对话框上移 8px 淡入。
- 系统开启"减少动效"或应用设置里打开"减少动效"时，所有动画与过渡压缩到 0.01ms。

## 图标

- 使用自研 Knowra 图标库（`apps/web-v4/src/components/icons/knowra/`）：24 × 24 网格、1.6px 圆头描边、`currentColor` 着色，不混用第三方图标集。
- 少数图标带一处强调色，取 `--knowra-icon-accent`（默认 `currentColor`，选中态由组件设为 `accent`），例如实心文件夹、火花。
- 常用尺寸：按钮内 14px、图标按钮内 16px、导航 16–18px。仅图标的按钮必须有 `aria-label`。
- 不用 emoji 做图标或装饰。
- 资源组 **Icons** 收录 82 个图标的 SVG 导出，墨色已写死为 `text-primary`（#17181b），强调部分为 `accent`（#f26b1d）。

## 品牌标记与装饰

- 资源组 **Logos** 收录产品标记：`knowra-brand-mark.svg`（叠放的蓝色方块与内嵌节点，256px）和 `knowra-favicon.svg`（64px 应用图标）。标记是蓝色系，与界面的橙色强调互不替代：不要把标记改成橙色，也不要在界面里用标记的蓝色做强调。
- 欢迎的装饰：卡片缩略图、空状态插图（`EmptyArt`：两张错落纸页 + 强调色徽章）。不要页头封面图，不要给文件夹分配身份色。

## 组件

组件库在 `apps/web-v4/src/components/ui/`，是 V4 访问 UI 的唯一入口，只有这一层可以直接导入 `react-aria-components`。这里的 `components/bundle.js` 是同一份源码构建出的浏览器包：先加载 React 18 与 ReactDOM 18，再加载 `bundle.js`，组件挂在 `window.Knowra` 上，图标在 `window.Knowra.Icons`；样式在 `components/bundle.css`，类型见 `components/index.d.ts`。

```js
const { Button, Dialog, DialogTrigger, DialogBody, DialogFooter, DialogClose, Icons } = window.Knowra;
const h = React.createElement;
h(Button, { variant: 'primary', icon: h(Icons.PlusIcon, { size: 14 }) }, '新建笔记');
```

- 常规按钮用 `Button` 的语义与尺寸变体；成组切换用 `SegmentedControl` / `SegmentedButton`。
- 单行、多行、下拉、复选分别用 `TextField`、`TextAreaField`、`Select`、`Checkbox`；搜索统一用 `SearchBox`。
- 右键菜单用 `Menu`，普通坐标锚点用 `PointMenu`；业务弹窗用 `Dialog`。
- 新外观先在组件库里定义可复用变体，业务 CSS 只保留布局和特定内容样式。

## 未同步的内容

- 无法写成 token 的值：橙色缎面渐变、玻璃/亚克力浮层渐变、外壳光晕 `surface-chrome-glow`、导航选中渐变、动效时长。它们写在 `components/bundle.css` 的 `:root` 里，或写在上文说明中。`accent-soft`、`accent-border` 与深色 `accent-solid`、`accent-hover` 原为 `color-mix()`，这里是换算后的固定值。
- 兼容别名 `--ink-*`、`--shadow-1/2`、以及 `--index-size-*` 系列尺寸变量未收录（它们只是别名或一次性尺寸）。
- 笔记外观的"单色（mono）"主题与按钮/对话框样式偏好（纸感、白玻璃、浮起卡片、内嵌托盘）未收录为主题。
- 字体文件：源码只声明字体栈，不打包字体文件。
- 组件包里还有 `Popover`、`PointMenu`、`GridList`、`SkeletonPulse`、`EmptyArt`、`PressableButton`、`ResponsivePanel`、`ScopedAppearanceProvider`，可以调用但没有单独的预览卡片；`CardButton`、`TextDiff` 和组件展示页未打包。
- 浏览器包用 React 18 运行，产品本身用 React 19；组件库没有用到 React 19 独有的 API。

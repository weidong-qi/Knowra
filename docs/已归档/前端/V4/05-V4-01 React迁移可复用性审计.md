# V4-01 React 迁移可复用性审计

## 1. 审计目标与结论

本审计回答三个问题：

1. V3 哪些能力可以迁移到 React V4；
2. 哪些代码只能保留业务规则，不能直接复用实现；
3. 哪些代码必须淘汰，避免把旧 DOM/CSS 架构带入 V4。

结论：**React 迁移具备可行性，但复用单位应是“领域规则、纯函数、API 契约和编辑器能力”，不是旧 controller、字符串 renderer 或 DOM event binder。**

UI 交互层采用 React Aria Components：复用成熟的 ARIA、焦点、键盘、overlay 与集合行为；通过 Knowra `components/ui` 封装隔离第三方 API，并继续由 CSS Modules + Design Tokens 完全控制视觉。该决定不会改变本审计对 V3 renderer/controller/event binder 的“不直接复用”结论。

当前前端共扫描 `apps/web/src/` 与 `apps/web/lib/` 下 229 个非 bundle JavaScript 文件。按 `document/window`、DOM 查询、`innerHTML`、`classList`、元素创建和 DOM 类型等显式特征粗筛，56 个文件直接命中，另外 173 个文件没有命中这些特征；这只用于定位审计重点，不能把 173 个文件视为可原样复制。字符串 renderer、可变全局 state、renderer 回调和 V3 数据结构仍可能在未命中文件中存在，最终判定必须看依赖与输入输出。

## 2. 迁移判定等级

| 等级 | 含义 | V4 动作 |
| --- | --- | --- |
| A：直接迁移 | 框架无关、输入输出清晰、无 DOM/CSS/React 依赖 | 迁移到 `packages/web-core/`，转 TypeScript，并保留同一测试向量 |
| B：提纯后迁移 | 业务规则与可变 state、回调或浏览器副作用混合 | 拆出纯函数/类型进入 `web-core`，副作用留在 V4 adapter |
| C：能力适配 | 第三方引擎或浏览器能力可保留，但生命周期必须由 React 接管 | 在 `apps/web-v4/src/adapters/` 或 feature adapter 内封装 |
| D：React 重写 | 以 HTML 字符串、DOM 查找、手工重绘或全局事件驱动 | 用组件、hook、受控状态和 React 事件重写，只保留验收行为 |
| E：淘汰 | 仅为 V2/V3 样式、兼容代理或旧运行时服务 | V4 不引入，默认切换时删除 |

“直接迁移”也不是复制粘贴：必须补齐类型、消除 V3 路径依赖，并证明 V3/V4 对同一输入保持行为一致。

## 3. 总体复用边界

```text
V3 可复用输入
├── API envelope、DTO 与请求语义                 → A/B：web-core
├── workspace normalization/cache/load decision → A/B：web-core
├── 选择、筛选、导航、文件名、状态文案等纯规则   → A/B：web-core
├── Milkdown/CodeMirror 插件与命令能力           → B/C：typed adapter
├── controller 中的业务流程与异常处理            → B：提取规则，重写编排
├── HTML renderer / element cache / event binder → D：React 重写
└── V2/V3 CSS、兼容 class、旧 JSX 探索            → E：淘汰
```

禁止以下“伪复用”：

- 将旧 renderer 包进 React `dangerouslySetInnerHTML` 后继续运行；
- 在 `useEffect` 中启动整套旧 controller/event binder；
- 让旧代码通过 `querySelector` 修改 React 管理的 DOM；
- 将 V3 CSS 整体导入后再用 CSS Modules 覆盖；
- 在 V3 与 V4 各复制一份 normalization、selection 或 API client 后长期分叉。
- page/feature 绕过 Knowra 封装直接依赖 React Aria 内部 DOM、默认 class 或完整第三方 props。

## 4. 按目录审计

### 4.1 `src/services/`：A，优先迁移

| 模块 | 结论 | 说明 |
| --- | --- | --- |
| `api-client.js`、`api-response.js` | A | 保留请求封装与 `{ data } / { error }` envelope 语义；转 TypeScript，增加错误类型 |
| `knowledge-api.js` 与 `knowledge-api/` | A/B | API 方法与参数语义可复用；按 DTO 分组并移除对 V3 state 的隐式假设 |

目标：V4-03 首批进入 `packages/web-core/src/api/`。迁移时 V3 同步引用共享来源，防止双份 API 语义。

### 4.2 `src/app/`：B/D，保留模型，重写运行时

| 模块 | 结论 | V4 处理 |
| --- | --- | --- |
| `app-state.js` | B | 作为领域字段清单和默认值参考，拆成 server data、workspace、UI、editor slices |
| `app-state-actions.js` | B/D | 提取选择和状态转换规则；调用 renderer/status 的命令式 action 改为 Zustand action |
| `formatting.js` | A/B | 无副作用格式化函数进入 `web-core`，补齐边界输入测试 |
| `editor-runtime.js` | D | 旧可变 runtime 容器改为 React ref + adapter-owned lifecycle |
| `element-cache.js` | E | React 不建立全局元素缓存；稳定语义改由组件 ref、role 和 `data-*` 契约表达 |

Zustand 采用**单一应用 Store、按 slice 组织**，不是多个互不协调的小 Store。编辑器引擎实例、DOM 节点和定时器不进入可序列化 Store。

### 4.3 `src/controllers/`：B/D，不能整体搬迁

该目录包含大量已经验证过的业务流程，但多数 factory 同时承担：

- 读取/修改全局 state；
- 调用具体 renderer；
- 查找 DOM、恢复焦点和同步滚动；
- 绑定浏览器事件；
- 调用 service 并处理错误。

React V4 的处理原则：

| 内容 | 处理 |
| --- | --- |
| service 调用次序、失败恢复、写保护 | 提取为 typed command/use case，B |
| selection、navigation、visibility 等纯决策 | 移入 `web-core`，A/B |
| renderer import 与 `render*()` 调用 | 删除，由 React 状态派生 UI，D |
| focus/scroll/selection lifecycle | 改为局部 hook/ref，D |
| controller registry/action proxies | 不照搬；由 Store action、feature hook 和 dependency provider 取代，D/E |

`src/controllers/editor/host-controller.js` 可作为编辑器行为规格参考，尤其是同 Note/Markdown 身份判定、异步挂载防重、保存回调抑制和焦点恢复；其 DOM 编排实现不得直接复用。

### 4.4 `lib/events/`：D/E，React 事件层重写

21 个事件模块中绝大多数依赖事件委托、`data-*` 分派和手工 DOM 生命周期。V4 应将事件收回组件边界：

- click/input/change/keyboard 由 React handler 处理；
- 全局快捷键、窗口 resize、beforeunload 使用可清理的 hook；
- 拖拽、菜单、Dialog 和 roving focus 由对应 feature/component 管理；
- 仅保留经测试证明的快捷键、IME、Escape、焦点返回等行为规范。

旧 binder 不进入 V4 bundle。原 binder 测试应改写为 React Testing Library 或 Playwright 用户路径测试。

### 4.5 renderer 与页面模块：模型可复用，呈现全部重写

| 目录 | 可复用内容 | React 重写内容 |
| --- | --- | --- |
| `lib/home/` | 主页数据模型、统计和状态判断 | HTML renderer、卡片和最近编辑视图 |
| `lib/library-index/` | 索引 model、过滤、排序、分页规则 | 列表、详情、筛选器、分页 DOM |
| `lib/knowledge-workspace/` | 可提取的状态映射、筛选和命令语义 | dashboard/list/inspector/review 字符串 renderer |
| `lib/training-workspace/` | 题目/场景状态映射和规则 | 全部 workspace renderer |
| `lib/search/` | search state 与筛选规则 | 搜索控件、结果面板 renderer |
| `lib/sidebar/` | 附件文件名、统计、状态、可提取的大纲层级算法 | panels、附件/标签/关联/大纲 DOM |
| `lib/shell/` | view-state 与可见性决策 | AppShell、TopBar、StatusBar renderer |
| `lib/tags/` | tag state、增删/选择规则 | 标签编辑 renderer |
| `lib/status/` | 状态文案与保存态映射 | status DOM renderer |
| `lib/work-domains/` | 工作域枚举/可达性 | 工作域页面 renderer |

所有返回 HTML 字符串的 renderer 均为 D。原有转义与安全测试不能删除：应迁移为 React 文本渲染、安全 URL 和 sanitizer 边界测试。

Dialog、Popover、Menu、Tabs、Tooltip、Tree、GridList/Table 与 TagGroup 等通用交互不从 V3 renderer 搬迁，也不从零复刻；以 React Aria Components 重建行为，以 Knowra UI 封装重建视觉和业务接口。

### 4.6 navigation/folders/notes：A/B 与 D 混合

优先提取：

- `lib/navigation/selection.js`
- `lib/navigation/visibility.js`
- tree selection、drop eligibility、context-menu item decision 等不依赖 DOM 的规则
- `lib/folders/` 中名称和目录规则
- `lib/notes/` 中 Note 状态与兼容判断

需要重写：

- `resolveContextMenuTarget()`、`resolveDropTarget()`、click target 等从 DOM 反查业务对象的函数；
- 依赖视觉 class 或祖先结构判断的交互；
- tree 的实际 DOM、拖拽反馈、焦点和菜单实现。

迁移后业务对象应由组件 props/closure 直接传入 action，避免重新通过 DOM 推断。

### 4.7 `lib/editor/`：B/C/D，最高风险区域

编辑器不是整体重写，也不能整体照搬。按三层处理：

#### 可提纯迁移（A/B）

- draft/save/view/layout 状态转换；
- tab workspace、panel state、context-menu model；
- Enter 行为、快捷键 action、find navigation；
- 图片尺寸/属性、非安全来源判断；
- 文件名、保存指示和 Markdown 相关纯规则。

其中 V3 的视觉 breakpoint 数值只是现状证据，最终以 V4 设计和实测为准。

#### 引擎能力适配（C）

`milkdown-entry.js`、editor factory、Milkdown/ProseMirror/CodeMirror 插件、schema、command 和表格/图片/代码块能力可作为 typed adapter 的实现基础。目标接口至少覆盖：

```ts
interface EditorAdapter {
  mount(host: HTMLElement, options: EditorMountOptions): Promise<void>;
  updateDocument(input: EditorDocumentInput): Promise<void>;
  execute(command: EditorCommand): boolean;
  focus(): void;
  getMarkdown(): string;
  destroy(): Promise<void>;
}
```

适配要求：

- React 只拥有 editor host；Milkdown 只拥有 host 内部子树；
- Strict Mode 下 mount/destroy 幂等，不产生双实例、重复 listener 或旧异步回调；
- editor 事件通过 typed callback/subscribe port 回到 React，不调用 V3 renderer；
- `.ProseMirror`、`.milkdown-*` 等只作为 adapter 内第三方结构契约；
- 自定义 table/image/code block 的视觉由 V4 skin 重写。

#### React 重写（D）

- 文档头、菜单、工具栏、Tab、边注、Inspector、Footer；
- 编辑器 context menu、Dialog、图片工具栏等应用级浮层；
- 所有字符串 renderer、全局 element cache 和事件委托；
- 通过 DOM class 同步应用状态的逻辑。

### 4.8 browser/dom/icons：局部适配或淘汰

| 目录 | 结论 |
| --- | --- |
| `lib/browser/` | C；保留为受控 browser adapter，SSR/test 环境通过接口替换 |
| `lib/dom/` | D/E；旧 DOM helper 多数淘汰，确有通用价值的 composition/focus 小函数需重新证明边界 |
| `lib/icons/` | B；保留图标语义和名称映射，SVG 改为 React 组件或受控 asset，不注入任意 HTML |
| `lib/annotations/` | A/B；纯标注规则可迁移，编辑器/DOM anchoring 进入 adapter |

### 4.9 workspace loading/cache/normalization：A/B，首批共享核心

`workspace-loading.js`、`workspace-cache.js`、`workspace-normalization.js` 及写保护/恢复决策是 V4 最值得复用的部分。处理边界：

- snapshot normalization、cache schema、fallback decision 进入 `web-core`；
- localStorage、fetch 和时间等副作用通过 port 注入；
- V3 SSR inline script 的生成与解析属于 V3 shell 适配，不作为共享核心；
- V4 首版保持 cache → live API → mock/recovery 的可观察行为，SSR 注入是否恢复由性能证据决定。

## 5. 未接入 JSX 探索目录

`apps/web/app/` 与 `apps/web/components/*.jsx` 虽为 React/Next 风格，但没有接入运行时，且继续导入 V3 样式。结论：

- 不作为 `apps/web-v4` 脚手架；
- 可人工提取文案或信息层级灵感；
- 不复制其 CSS、layout 或依赖假设；
- V4-09 删除或移入历史归档。

## 6. 测试迁移策略

| V3 测试类型 | V4 去向 |
| --- | --- |
| API client、envelope、normalization、selection 等纯测试 | 迁移/共享测试向量，Vitest |
| controller command 与错误恢复 | 拆为 use case/store 测试 + feature integration test |
| event binder、焦点、IME、键盘 | RTL 用户事件；关键浏览器行为用 Playwright |
| renderer HTML 字符串断言 | 改为 role/name/可见行为断言，不锁 class/markup |
| V3 CSS/InkGrid 结构测试 | 迁移期保留保护 V3；V4 有替代证据后在 V4-09 删除 |
| Milkdown command/schema/plugin 测试 | 保留并迁移到 adapter/core 层 |
| 响应式与多侧栏矩阵 | Playwright 多视口 + 视觉证据 |

V4 测试不得以 CSS Module 生成后的 class 名作为业务契约。稳定定位优先使用 role、accessible name 和必要的 `data-testid`；业务动作通过组件 API 与 Store action 连接。

## 7. 风险与处置优先级

| 风险 | 等级 | 处置 |
| --- | --- | --- |
| Milkdown 异步生命周期、焦点、选择与保存竞态 | 很高 | V4-03 先做 adapter spike；V4-07 前建立 Strict Mode 生命周期测试 |
| controller 业务规则与 renderer/DOM 混合 | 高 | 只提取可测试规则，禁止把旧 registry 注入 React |
| 共享代码复制后分叉 | 高 | 迁移一个模块时让 V3/V4 同步引用 `web-core` |
| cache/SSR/API 首屏语义漂移 | 高 | 先冻结 normalization 和 recovery 测试向量 |
| 旧 CSS 意外进入 V4 bundle | 高 | V4-02 增加 import 图与构建产物门禁 |
| React Aria API 散落导致升级和视觉边界失控 | 高 | 只允许 `components/ui` 直接 import，并建立契约测试 |
| 测试从结构断言迁移后保护不足 | 中高 | RTL + Playwright 替代证据先落地，再删除旧测试 |
| Zustand 承载 DOM/engine instance | 中 | 明确 Store serializable boundary，实例留在 adapter/ref |

## 8. V4-03 推荐迁移顺序

1. `api-response`、API DTO 与纯 `knowledge-api` 方法；
2. workspace normalization 与 cache schema；
3. workspace load/recovery/write-guard decision；
4. navigation selection/visibility；
5. library/search/sidebar 的纯 model/state；
6. editor draft/tab/panel/save 等纯状态；
7. Milkdown adapter spike；
8. 最后才迁移复杂 controller 中可证明独立的 use case。

每一步必须满足：

```text
同一输入向量 → V3 与 web-core 结果一致
web-core      → 不 import DOM / React / CSS / V3 renderer
V4            → 不 import V3 controller / event binder / renderer
```

## 9. V4-01 完成结论

V4-01 已完成，可以进入 V4-02：

- React V4 的复用边界已经明确；
- 首批共享核心候选已确定；
- controller、event binder、renderer 的去向已确定；
- Milkdown 采用 typed adapter，而非塞入全局 Store；
- 未接入 JSX 探索不会成为新应用起点；
- V3 测试有明确的保留、迁移和退出策略。

下一工程任务为 `V4-02-01 Workspace 脚手架`。V4-03 的实际迁移量应以脚手架和隔离门禁通过为前提，不在 V4-02 提前搬运业务模块。

# Knowra

默认用简体中文沟通；UI、文档和提交说明用中文，代码标识符用英文。文件命名沿用所在目录约定。

## 命令（仓库根目录）

使用 npm workspaces，Node.js >=24、npm >=11。`npm install` 安装依赖。

| 用途 | 命令 |
| --- | --- |
| API + 前端开发 | `npm run dev:all` |
| 局域网预览（无认证，仅限可信网络） | `npm run dev:lan` |
| 单独启动 API / 前端 | `npm run dev:api` / `npm run dev:web` |
| 前端构建 / 生产启动 | `npm run build:web` / `npm run start:web` |
| Android 无 SDK 策略检查 | `node --test scripts/test/android-preview.test.js` |
| 个人 Mac 纯构建（Apple Silicon，不安装） | `npm run build:mac` |
| Mac 产物核验 / 隔离验收 / 显式安装 | `npm run verify:mac` / `npm run test:mac` / `npm run install:mac` |
| API 测试 | `npm run test:api` |
| API 类型检查（宽松 checkJs，本地失败返回非零、CI 仅报告；迁移计划见 `docs/后端TS迁移/`） | `npm run typecheck:api` |
| 前端测试 | `npm run test:web` |
| 前端类型、架构边界和测试 | `npm run check:web` |
| 共享工具 | `npm run test:shared` |
| 共享契约 / V3 回归 / 脚本测试 | `npm run test:web-core` / `npm run test:web:legacy` / `npm run test:scripts` |
| 全部测试 | `npm test` |
| 代码风格（本地检查失败返回非零；CI 仅报告；工具链首次运行时装到 `scripts/lint/`） | `npm run lint` / `npm run format:check` |
| 本地离线运行服务（先构建前端） | `npm run start:desktop` |
| 本地存储/恢复测试、真实页面验收 | `npm run test:desktop` / `npm run test:e2e -w @study-accelerator/desktop-runtime` |

按改动选择检查；前端 UI 使用 Vitest，生产服务器使用 node:test；API 使用显式注册的自定义 runner。不要把直接导入 API 测试文件当作执行其测试。交互改动还需验证受影响的页面状态；完整 E2E 入口是 `npm run test:e2e -w @study-accelerator/web`。

改完代码后，只对本次新增或修改的文件运行 `node scripts/lint/run.mjs prettier --write <文件...>` 和 `node scripts/lint/run.mjs eslint <文件...>`，并修掉新引入的 ESLint 问题。仓库仍有存量问题，所以不要整仓库格式化，也不要顺手修与任务无关的旧问题；如果某个旧问题妨碍当前改动，请在回复中说明。

## 架构与数据约束

- 唯一可启动前端是 `apps/web`（React、TypeScript、Vite、Zustand、CSS Modules、hash 路由），npm workspace 名称为 `@study-accelerator/web`；`apps/web-legacy` 归档 V3 源码和回归测试，不提供启动入口。现役前端不得导入 V3 模块或资源。
- `react-aria-components` 只由现役前端的 `src/components/ui/` 包装层直接导入。`packages/web-core` 保持框架、CSS 和 DOM 无关；边界由 `scripts/check-v4-boundaries.mjs` 检查。
- API 运行入口使用 `node:http`；路由 → 应用服务 → repository，依赖在 `apps/api/src/app.factory.js` 装配。NestJS 依赖不代表运行中的框架。
- `apps/api` 正在从 JS 渐进迁移到 TS：新建后端文件用 `.ts`，迁移旧文件按 [迁移规范](docs/后端TS迁移/迁移规范.md) 执行（按目录成批、只用现有测试验收、进度每批一行）。
- API 成功封装为 `{ data: ... }`，失败为 `{ error: { code, message } }`。保持 DTO 和共享契约一致。
- 默认 `PERSISTENCE_DRIVER=local-json`；PostgreSQL 已实现，需显式选择 `postgres`、提供 `DATABASE_URL` 并应用迁移，失败不得静默回退 JSON。
- `STORAGE_MODE` 默认 `local-first`；上传、导出、临时目录通过 `STORAGE_UPLOADS_DIR` / `STORAGE_EXPORTS_DIR` / `STORAGE_TEMP_DIR` 配置。
- JSON 写入保留原子替换和引用校验；协调永久删除通过 `dataStore.runTransaction()` 提交。PostgreSQL 事务内不做外部文件或网络 IO。
- HTTP 知识空间 owner 由服务端 `KNOWRA_OWNER_ID`（默认 `demo`）决定，不接受客户端覆盖。它不提供身份认证；公开部署在正式登录方案完成前保留 Nginx Basic Auth。
- 保留缓存/加载恢复状态的只读写入保护。`storage/` 是运行数据；附件、导入导出与持久化变更需保持恢复路径。
- 端口由 `scripts/dev-runtime-ports.js` 和 `storage/runtime/dev-ports.json` 发现；不要假定 3000/3001。前端开发与生产均通过同源 `/api/*` 代理。

## UI 与文档工作流

- 沿用现有组件、tokens 和用户指定的视觉参考；视觉调整默认保持产品行为。新视觉方向可用 `frontend-design`，具体设计资料可用 `ui-ux-pro-max`，UI 规范审查可用 `web-design-guidelines`；只加载任务实际需要的技能。
- 前端搜索框统一使用 `components/ui/input/SearchBox`（外壳为 `SearchSurface`）；右键菜单使用 `components/ui/overlay/Menu`，普通坐标锚点使用 `PointMenu`。修改这些控件的外观应调整组件库样式及明确的尺寸变体，不在业务页面另写同类样式。
- 前端常规按钮使用 `components/ui/button/Button` 的语义与尺寸变体，成组切换按钮使用 `SegmentedControl` / `SegmentedButton`；单行、多行、下拉和复选表单分别使用 `TextField`、`TextAreaField`、`Select`、`Checkbox`。新增外观先在 `components/ui/` 定义可复用变体，业务 CSS 只保留布局和特定内容样式。
- 外壳常驻，侧栏、内容区和辅助面板独立滚动；业务弹窗用项目组件。
- 开发约束与版本维护见 [docs/开发规范.md](docs/开发规范.md)；代码定位时按需读 [docs/项目结构导航.md](docs/项目结构导航.md)。结构性变更记入唯一的 [docs/工程变更日志.md](docs/工程变更日志.md)。
- 产品领域变更按需读 [领域冻结稿](docs/知识库与试题模块/Knowra%20知识与考卷系统领域冻结稿.md)；不要用旧版知识点模型或占位导航推断当前业务。
- `CLAUDE.md` 只引用本文件，避免维护两份命令与架构规则。

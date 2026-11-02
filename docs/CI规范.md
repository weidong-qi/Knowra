# CI 规范

本文记录 `.github/workflows/ci.yml` 与 `scripts/ci.mjs` 中不易从配置本身看出的约束和理由。修改 CI 前先读本文；配置变化导致本文不再成立时，在对应章节修改。2026-10-18 并行化改造时的耗时基准见[归档记录](已归档/CI验证与耗时.md)。

## 触发与候选产物

- PR 自动执行完整 CI；main push 再验证实际合并提交并生成 Linux 发布候选。
- 不为 `codex/**` 等分支的 push 重复跑全量。无 PR 的分支通过 CI 的 `workflow_dispatch` 手动全量验证并生成 Linux 候选；手动入口需先合入默认分支才在 Actions 中可见。
- Mac 候选（`mac-build.yml`）由 PR、main push 和 `workflow_dispatch` 触发；Mobile 与 Android 工作流各自维护触发和覆盖。
- 只改实验脚本、实验工作流（`knowledge-*.yml`）和知识模块讨论记录时，`paths-ignore` 跳过全量 CI，由实验工作流运行自己的无费用测试。CI 不运行真实模型实验，不读取模型密钥。
- 同一 ref 的新运行取消旧运行（`concurrency` + `cancel-in-progress`）。

## 并行分组

完整套件分成四个独立 runner，分组以 `scripts/ci.mjs` 为准：

- `api`：`test:api`，保留自定义注册 runner 与后续 provenance node:test。
- `web`：content-anchor、shared、web-core、V3、V4、scripts，按此顺序运行。
- `desktop`：`test:desktop`，含 SQLite、CAS、同步、恢复、重启与 MCP 等测试。
- `chromium`：desktop-runtime `test:e2e` 生产页面与离线运行，以及 V4 移动端证据用例。

约束：

- **每个分组都要有自己的 `postgres:17` 服务**、显式测试 URL / 写入开关、Prisma 生成和迁移。API、脚本和浏览器测试也含 PostgreSQL 分支，只给 desktop 配数据库会让其他组的 PG 用例静默跳过。
- 各 runner 的回环地址和文件系统相互隔离，不共享 SQLite 文件或 PostgreSQL 实例。桌面及浏览器使用 `--test-concurrency=1`，API 注册 runner 串行；调整分组时不顺带改测试内部并发、断言、重试或超时。
- 各分组以相同检出 SHA 独立构建生产 V4，并验证 release identity 与 source map 缺失。构建约 5 秒，因此选择简单重建，不引入跨作业产物传递或基于 lockfile 的 dist 缓存。
- npm 缓存由 setup-node 按 lockfile 管理；每次 `npm ci --ignore-scripts`，不缓存 `node_modules`、Prisma 生成物或数据库。Chromium 安装包含系统依赖，不缓存浏览器。
- 快检（空白检查、V4 架构边界、迁移后的 API TypeScript、CI 契约回归和生产依赖审计）独立执行，不等待长测试。
- 矩阵 `fail-fast: false`，某组失败仍收集其他组结果。隔离容器 smoke 是独立作业。

## 汇总与发布安全

- 检查名 `Node 24 · build and test` 保留为 always 汇总作业；`checks`、`suites`、`isolated-image` 必须全部 success。失败、取消、跳过、缺失或未知前置作业均拒绝通过。
- main push / 手动触发仅在汇总通过后重建同一 SHA 并打包；打包或上传失败同样使汇总失败。PR 不上传 Linux 发布包。
- 所有 runner 检出时不保存凭据（`persist-credentials: false`），权限保持 `contents: read`。使用 `pull_request`，不使用 `pull_request_target`；不为 CI 增加 Secret 或外部服务。
- 合成截图和证据由 Chromium 作业上传。Mac 候选由其工作流核验身份、签名及合成场景。
- 本地未启动 PostgreSQL 的结果不能替代 CI 全量验收。

# CI 验证与耗时

> 2026-11-02 归档：这是 2026-10-18 CI 并行化改造的任务记录。现行规则已整理到 [CI 规范](../CI规范.md)，以那里为准。文末“发布 PR 后记录新 run 并对比”的复测没有找到执行记录，改造后的实际耗时未经验证。

## 触发与候选产物

- PR 自动执行完整 CI；main push 再验证实际合并提交并生成 Linux 发布候选。
- 取消 codex/** 的重复 push 全量运行。无 PR 的分支通过 CI 的 workflow_dispatch 手动全量验证并生成 Linux 候选；手动入口需先合入默认分支才在 Actions 中可见。
- Mac 候选保留 PR、main push 和原有 workflow_dispatch，取消 codex/** 重复 push。Mobile 与 Android 的原有触发和覆盖不变。
- 实验专用路径忽略规则不变；本次不运行任何真实模型实验，不读取模型密钥。

## 并行边界

CI 使用四个独立 runner 执行完整套件，分组由 scripts/ci.mjs 定义：

- api：原 test:api，保留自定义注册 runner 与后续 provenance node:test。
- web：content-anchor、shared、web-core、V3、V4、scripts，按原顺序运行。
- desktop：原 test:desktop，保留 SQLite、CAS、同步、恢复、重启与 MCP 等测试。
- chromium：原 desktop-runtime test:e2e，保留生产页面与离线运行覆盖。

每个分组保留单独的 postgres:17 服务、显式测试 URL / 写入开关、Prisma 生成和迁移。API、脚本和浏览器也包含 PostgreSQL 分支，不能只给 desktop 提供数据库，否则会出现静默跳过。各 runner 的回环地址和文件系统相互隔离，不共享 SQLite 文件或 PostgreSQL 实例。桌面及浏览器仍使用 --test-concurrency=1，API 注册 runner 仍串行；本轮不改测试内部并发、断言、重试或超时。

各分组以相同 GitHub 检出 SHA 独立构建生产 V4，并验证 release identity 与 source map 缺失。基准构建约 5 秒，优先选择简单重建，不引入跨作业产物传递或基于 lockfile 的 dist 缓存。npm 缓存继续由 setup-node 按 lockfile 管理；每次仍 npm ci --ignore-scripts，不缓存 node_modules、Prisma 生成物或数据库。Chromium 安装仍包含系统依赖；本轮不增加浏览器缓存。

快检独立执行空白检查、架构边界、CI 契约回归和生产依赖审计，不等待长测试。矩阵 fail-fast=false，某组失败仍收集其他组结果。隔离容器 smoke 保留独立作业。

## 汇总与发布安全

旧检查名 Node 24 · build and test 保留为 always 汇总；checks、suites、isolated-image 必须全部 success。失败、取消、跳过、缺失或未知前置作业均拒绝通过。main push / 手动触发仅在汇总通过后重建同一 SHA 并打包；打包或上传失败同样使旧检查失败。PR 不上传 Linux 发布包。

测试 runner 与发布 runner 均不保存 checkout 凭据，权限保持 contents:read；继续使用 pull_request，不使用 pull_request_target，不增加 Secret 或外部服务。运行间取消策略不变。截图仍由 Chromium 作业上传，路径、名称及保留期不变。Mac 候选仍由原工作流核验身份、签名及合成场景。

## 基准与复测

基准：[CI 39103046963](https://github.com/1848956505/Knowra/actions/runs/39103046963)，2026-10-18，Node 24 · build and test 的日志时间戳：

- npm test：06:10:25 至 06:21:01，约 10 分 36 秒
- API：约 3 分 27 秒
- content-anchor/shared/web-core/V3：合计约 5 秒
- V4：约 2 分 49 秒
- scripts：约 17 秒
- desktop：约 3 分 58 秒
- Chromium 安装及 E2E：06:21:01 至 06:27:47，约 6 分 46 秒，其中浏览器测试约 6 分 25 秒
- 生产构建：约 5 秒

这些是旧工作流单次观测，不是新工作流性能承诺。新作业能消除上述套件间串行等待，但会增加 runner 启动、数据库准备和安装次数；并发额度及排队会影响实际结果。本轮优先缩短反馈关键路径并去掉重复触发，不声称总 runner 分钟一定减少。

发布 PR 后记录新 run URL、测试提交/合并 SHA、各组开始与结束、快检时间、汇总耗时，以及 main 发布候选产物。分别比较工作流墙钟、套件执行耗时、排队时间和总 runner 分钟。确认所有矩阵成员与原隔离容器检查通过，真实 PostgreSQL 分支无新增跳过，再判断实测改进；不得用本地未启动 PostgreSQL 的结果替代 CI 全量验收。

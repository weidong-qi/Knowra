# AI-03-01A 提炼 v1 与 Gateway 协议适配

状态：2026-10-02，最小协议适配批次已通过本地合成验收、完整 API runner 和 V4 构建；固定 head 独立审查及远端 CI 另在 PR 核实。此次授权恢复 P3 的明确切片，旧阶段暂停记录保留为历史。

## 批次范围

现有提炼 v1 已能从保存的 AnalysisScope 和不可变 NoteVersion 生成请求、严格校验候选与引文，但没有适配 Gateway。此批次提供 `apps/api/src/modules/ai/knowledge-extraction-gateway.ts` 两个函数：

- `prepareKnowledgeExtractionGateway`：调用既有 v1 输入校验器，生成 `format: json`、`tools: []` 的 Gateway 请求，以及保留在服务端的原始 `extractionRequest`。提示词版本固定为 `knowledge-extraction-v1`，不选择新的模型。
- `validateKnowledgeExtractionGatewayResult`：要求完整 `stop`、未拒答、未截断、没有工具调用，再把原始响应文本交给既有 v1 严格校验器。返回整批候选计划，不创建任务、候选、证据或确认记录。

来源在独立的 user JSON 消息中发送；system 提示明确将其中的命令、角色声明和工具请求视为原文。外发字段只有契约版本、请求 ID 和所选片段的 `sourceId/markdown`。空间 ID、笔记/版本映射、正文哈希、标注修订号保留在服务端；`contextSegments`、排除项、遗漏内容不发送。后续界面仍须显示包含、排除及遗漏范围。

本批次不修改冻结 v1 schema、AIJob schema、路由、数据库迁移、Worker 或前端。现有 Worker 只接受 `answer`，因此 AIJob/Grant/Manifest 的提炼连接仍待后续明确归属；界面保持提炼不可用。协议适配完成不代表 AI-03-01 或整个 P3 完成。

## 限制与后续接入要求

原 v1 的 128 片段、120,000 UTF-16 输入、40 候选、引文及 256,000 UTF-8 输出限制全部保留。Gateway 单消息限制也为 120,000 字符；JSON 封装或转义可能使合法 v1 原文超限，此时返回 `KNOWLEDGE_EXTRACTION_GATEWAY_INPUT_TOO_LARGE`，提示缩小范围，整体拒绝，不裁剪资料。输出 token 上限走既有 Gateway 校验，默认 8,192，不代表保证所有候选可一次输出；截断结果不能采纳。

宿主必须先按当前 owner/空间权限加载已保存的范围和版本，不能直接采用客户端提交的 scope 或版本正文。此纯适配器不承担授权检查、预算或生命周期；未来执行方须在发送前、响应采纳前和事务入库时分别执行授权/资料集/来源检查、核价及预算、取消/超时/租约检查。不能绕过 Worker 把该请求作为真实付费调用入口。

后续 AI-03-01B/AI-03-02 需保存请求和提示词版本，并以原请求绑定输出、全部候选、证据及 provenance；同事务完成幂等提交。来源已删除、跨空间或授权撤销应拒绝，原文更新沿用旧不可变版本和来源待复核状态。取消后的迟到响应和重启恢复尚未在提炼任务层验收，不能据本次 Gateway 的预取消回归宣称已完成。

## 验收与证据

新增六项 API 自定义 runner 场景，全部只用真实内存范围服务与 Mock Gateway：

1. 所选/排除/仅上下文发送边界、真实 Gateway 请求/响应、候选兼容、人工确认前正式数量不变。
2. 模型工具、拒答、截断、资源终止和 aborted 不能形成计划。
3. 同批一个伪造引文导致整批拒绝；错请求 ID、模型自由确认字段拒绝。
4. 畸形 JSON 阻断，空候选允许且不写库。
5. 满 120,000 UTF-16 的转义原文超过消息限制时整体拒绝；既有输出 token 上限有效。
6. 调用前取消没有模型调用；原文在响应后变化仍使用旧版本证据并标记 `stale`。

本地基线 `1f23c09a6918c5483a7ebf61c6d455408e6770b8`，独立分支 `codex/knowra-ai-p3-slice-20261002`，Node.js 26.4.0 / npm 11.17.0；远端 CI 按仓库配置使用 Node.js 24。实际结果：

| 命令 | 结果 |
| --- | --- |
| `git fetch origin main` | 成功核实上述 main，不同步原 checkout |
| `npm ci --ignore-scripts --offline`（空用户/global 配置，既有公共缓存） | 成功安装 437 包；没有网络、用户凭据或安装脚本 |
| `npm run prisma:generate` | 成功；仅生成 client，不连接数据库 |
| 显式导入新增套件并逐项 `await test.run()` | 6/6 通过；不将直接导入等同测试执行 |
| `npm run test:api`（取消数据库连接变量，隔离 loopback 测试权限） | 411 项 runner 全通过；真实 PostgreSQL 条件场景本地未运行，由远端 CI 验证 |
| `npm run build:web` | 通过；仅有既有大 chunk 提示 |
| `git diff --check` | 通过 |

初次 runner 因忽略安装脚本后尚未生成 Prisma Client 而未开始测试；生成第一次被共享引擎缓存权限限制，定点沙盒升级后成功。后一次 runner 在沙盒内因临时 `127.0.0.1` HTTP 测试监听被拒绝中断，首次权限执行又遇宿主 transport disconnected；恢复连接、允许隔离 loopback 并重试后完整通过。这些环境准备失败没有通过修改断言或跳过场景解决。

本次只运行合成资料与 Mock；不接触真实笔记、凭据、APP 或外部模型。本地无重型浏览器或数据库套件，完整 CI 的容器/PostgreSQL/SQLite/页面回归等待远端结果。

剩余：AIJob/预算/取消超时/恢复连接、三驱动事务保存、provenance 同步、候选对照页面、真实供应商与正式 Mac 验收；这些均不在本批次完成声明中。

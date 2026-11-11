# AI-03-02B 持久化提炼任务与 Mock 执行

状态：2026-10-02，基于主干 `72d34bc24b903dd5349d00ea580376fce2a08213` 实施，并正常同步至 `4ef9ace522c30c7884b07480d4f3e3e811a1309d`。受信宿主的真实任务启动、Mock 调度和 [02A 原子接纳](AI-03-02A-提炼结果原子接纳.md) 已连接；本地 JSON/SQLite 定向验收与独立修正复验通过。本页保留本地验证及其限制，最终集成审查与真实 PostgreSQL/完整 CI 证据以对应 PR 为准。此记录不宣称 P3、AI-03-01 或 AI-03-02 的完整产品链路完成。

## 交付边界

`appContext.knowledgeExtractionTasks.start({ scopeId, idempotencyKey })` 接受已保存 AnalysisScope 的 ID 和幂等键。宿主从当前库加载 owner、空间、资料集/epoch、不可变版本及选定片段，同事务创建 scopeSnapshot、contextManifest、create grant、pending AIJob、私有任务描述和安全事件。测试仅创建合成笔记与真实保存范围，授权、任务和租约全部由这个入口产生。

只有宿主显式传入 `knowledgeExtractionMock: { gateway }` 才装配此服务，且 Gateway 能力必须声明 `provider: mock`；默认工厂返回 `knowledgeExtractionTasks: null`，不会自动恢复或执行任务。没有 HTTP/IPC 路由、环境变量开关、真实供应商回退、凭据读取或付费调用。显式 `start/retry` 提交后才唤醒内存队列；受信宿主也可调用 `run/idle/close`。真实 provider 的核价、预算预留/结算和用户界面仍是后续工作，Mock 不伪造用量费用或占用人民币预算。

v1 的 AIJob 没有 scopeId/executionMode，且 resultJson 仅用于问答。本批不改冻结 schema，新增严格版本化的私有描述来绑定 scopeId、范围/请求哈希、owner/dataset/epoch/space/job 和固定 Mock profile。描述包含整份 recordHash 与创建条件 creationHash；profile 固定 8192 输出 token、20 个授权目标、4 次尝试、120 秒租约、300 秒 grant，不接受外部覆盖。冻结 v1 的 provider/recipient 仍填 `deepseek` 作为旧配置字段；显式 `executionMode: mock`、Mock modelId 和无凭据标识共同约束本切片，不能把这些旧字段解释为真实 DeepSeek 调用。

## 原子生命周期与权限

- 同键查找发生在创建 UUID 依赖之前；同 owner/dataset/space/jobKind/幂等键复用原任务，同空间同键异范围拒绝。成功任务从 02A 回执回读候选 ID，保留用户后续修订，不重新生成。响应不返回授权、私有描述、原文或凭据引用。
- 领取在宿主事务内把 pending/retrying 变为 running，同时创建当前最高代租约；另一个执行器不能再次领取。发送前重读范围、版本、完整 manifest/payloadHash、创建授权及有效期；失效/撤销/删除/迁移/旧 epoch 均在调用前阻断，授权不能通过重试延长。
- Gateway 等待处于事务及维护门之外。返回后只调用 02A `commit`，由其再次校验并一次接纳全部候选、证据、来源、首份回执、validated attempt 与 succeeded job；worker 不逐条写候选、不自行写成功状态。
- 取消用一个事务结束任务和活动 attempt，再中断本机等待；其他实例依靠持久状态和 02A 校验拒绝迟到结果。失败收尾只修改自己持有的当前代，不能覆盖新租约、取消或成功结果。
- `recover()` 仅处理本描述绑定的当前 epoch 提炼任务：pending/retrying 标为失败，过期 running 的 attempt 标 timedOut，cancelling 完成取消；活租约不抢占。恢复不自动发送，需显式 `retry(jobId)`，且原 grant、来源和次数上限继续生效。旧 epoch 不复活。
- 队列沿用现有 2 个并发槽、8 个等待位；所有直接/队列运行共用 promise 跟踪，`idle/close` 等待活动任务收尾，关闭后拒绝新 run。队列信号不承担持久化权威，进程中断后仍以库内任务恢复。

`598aa87` 的独立审查确认了恢复与重试的 P2 竞态：旧 attempt 已 timedOut、任务已 retrying 时，旧 run 的迟到失败仍可能覆盖新状态；同实例旧 run 尚在收尾时也可能吞掉 retry 唤醒。修复限定带 attemptId 的失败只能收尾仍 leased/sent 且任务仍 running/cancelling 的当前代，保留未成功领取时的失败收尾；待重试信号进入原有有界队列，调度跳过仍 active 的同 job，旧 run 退出后再唤醒，不改变超时或恢复后显式重试规则。新回归在原实现上复现失败，仅修失败归属时仍能检出丢失唤醒，完整修复后通过；修正提交 `52a0e79c4cd8279ea5baedfd1bca50ea51815f52` 已独立复验为 `findings=[]`，原 P2 关闭。最终主线集成与 CI 另在对应 PR 留证。

旧 `worker.recover()` 原来枚举所有 jobKind，可能将新持久化提炼 pending/running 误当问答终止，并尝试结算其预算。现仅增加 `{ jobKind: 'answer' }` 过滤，与旧 `run()` 已有的 answer 限制对齐；不修改 Agent worker、访问授权或关键词检索。原 answer/budget suite 保持通过，新增提炼测试断言旧恢复器不修改提炼任务或调用预算。

## 存储和代码定位

| 部分 | 实现与边界 |
| --- | --- |
| 应用/调度 | `apps/api/src/modules/ai/knowledge-extraction-task-{service,context,lifecycle}.js`、`knowledge-extraction-task-contract.ts` 和 `knowledge-extraction-mock-worker.ts`；两个 app factory 仅在显式注入时装配。 |
| JSON | `file-data-store.js` 新增 `aiKnowledgeExtractionTasks: {version:1,tasks:[]}`，与 AI 记录、业务状态及 journal 同一最外层事务、最终原子替换。失败恢复全部内存记录，读写复制描述；未知/损坏状态保留原文并仅关闭本切片。 |
| SQLite | `knowledge-extraction-task-store.mjs` 新增 `ai_knowledge_extraction_tasks` 及独立 `metadata.aiKnowledgeExtractionTasksVersion=1`；升级前保护备份，DDL/标记同事务，不改 AI user_version。创建/领取/取消/恢复共享既有 BEGIN IMMEDIATE。 |
| PostgreSQL | migration `i_knowledge_extraction_tasks` 增加 owner/dataset/job 主键、TEXT 描述表，无业务外键；`postgres-knowledge-extraction-task-store.js` 复用 02A 宿主事务与核心 advisory 锁，AI repository 绑定同一连接。实际工厂外层仍是 syncRuntime 的 ReadCommitted，不因内层参数宣称升级了隔离级别。 |

私有任务描述不进入普通业务快照/同步；完整 JSON 文件和 SQLite 整库备份保留它。损坏/未来描述旁普通笔记仍可写，不能清空扩展“修复”错误。02A 的核心首份结果和候选不依赖描述表外键。独立恢复预检 validator、跨端 AI 元数据同步和来源清理引用保护仍归 AI-03-05；本批不修改备份独立恢复实现。

## 实际验证

环境为云端 Node.js 24.19.0 / npm 11.9.0；独立工作树 `knowra-p3-mock-tasks-cloud`。依赖以空 user/global npm 配置和 `npm ci --ignore-scripts` 安装，未使用真实资料、凭据、Mac、ECS 或付费服务。

| 实际执行 | 结果 |
| --- | --- |
| 新增任务与重试 suite，逐项 `await test.run()` | 13/13：原任务 10 项，加跨实例 recover→retry→旧代迟到、默认调度同实例旧 run 收尾期间重试、本机/跨实例取消待重试 3 项。断言只接纳第二代一份结果、取消不重发；旧任务回归继续覆盖真实启动、故障回滚、claim 失败收尾、权限/来源/epoch、最多四代、维护门和旧 worker 隔离。直接 run/排队/idle/close 场景仍在 15 秒硬超时子进程内执行。 |
| 受影响既有 API 回归 | 02A 原子接纳 10/10、旧 answer/budget worker 11/11、JSON 文件持久层 7/7；均明确执行 `.run()`。 |
| SQLite 原生 node:test | 任务 14/14（含跨实例旧代迟到、默认调度重试/取消），02A 接纳 4/4、核心回执 7/7；包含真实 SQL trigger/commit 回滚、双执行器、重启、完整备份恢复、独立升级与未来/损坏描述。竞态修复本轮重跑任务 14 项；未受影响的接纳/核心结果沿用前轮。 |
| 新 PG 条件 suite | 源码注册 5 项，本地尚未执行；测试用独立真实 schema/完整迁移，覆盖两实例 start/领取、重启、SQL 触发器创建/取消/恢复回滚、来源/epoch/描述隔离。连只收集导入也因未生成的 Prisma Client 缺少 `Prisma` 导出失败，不能计为 PG 通过。环境已知二进制下载受限，本批未重复下载或绕过；需最终 CI 生成客户端并运行。 |

API 定向复现（仓库根目录）：

```sh
node --input-type=module <<'NODE'
import { aiKnowledgeExtractionTaskTests } from './apps/api/test/ai-knowledge-extraction-task.test.js';
import { aiKnowledgeExtractionTaskRetryTests } from './apps/api/test/ai-knowledge-extraction-task-retry.test.js';
import { aiKnowledgeExtractionCommitTests } from './apps/api/test/ai-knowledge-extraction-commit.test.js';
import { aiBudgetWorkerTests } from './apps/api/test/ai-budget-worker.test.js';
import { fileDataStoreTests } from './apps/api/test/file-data-store.test.js';
for (const test of [...aiKnowledgeExtractionTaskTests, ...aiKnowledgeExtractionTaskRetryTests, ...aiKnowledgeExtractionCommitTests, ...aiBudgetWorkerTests, ...fileDataStoreTests]) {
  await test.run(); console.log('PASS', test.name);
}
NODE
node --test --test-concurrency=1 apps/desktop-runtime/test/knowledge-extraction-task.test.mjs apps/desktop-runtime/test/knowledge-extraction-commit.test.mjs apps/desktop-runtime/test/core-operation-store.test.mjs
```

`apps/api/test/run-tests.js` 注册新 JSON 与 PG suite；具备生成的 Prisma Client、回环专用 Knowra 测试库、`KNOWRA_SYNC_TEST_DATABASE_URL` 与 `KNOWRA_SYNC_TEST_ALLOW_WRITES=1` 的 CI 会实际执行 PG 条件 suite。本地未运行完整测试、浏览器、真实 PG 或容器；合并前须在最终同步提交完成独立审查及完整 CI，不能以本地 Mock 通过替代。

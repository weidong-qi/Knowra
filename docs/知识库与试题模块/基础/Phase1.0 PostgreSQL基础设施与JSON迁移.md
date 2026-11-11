# Phase1.0：PostgreSQL 基础设施与 JSON 迁移

> 文档状态：实施完成（本地验证完成，生产切换待执行）
> 完成版本：2.8.0
> 领域基准：[Knowra 知识与考卷系统领域冻结稿](Knowra%20知识与考卷系统领域冻结稿.md)

> 本文下列“已实现”记录的是当前代码已经落地的工程改动；它不代表正式知识点、学习目标、试题或试卷领域已经开始实现。工程阶段 Phase1.0 与领域建设阶段必须分开理解。

## 目标与边界

Phase1.0 为当前知识库模块建立 PostgreSQL 持久化后端和一次性 JSON 迁移工具，但不改变默认运行行为：

- `PERSISTENCE_DRIVER=local-json` 仍使用现有同步 JSON Repository，是开发和回退默认值。
- `PERSISTENCE_DRIVER=postgres` 才创建 Prisma Client、PostgreSQL Repository 和异步知识库应用服务；不做静默降级。
- 附件二进制继续保存在本地 `storage/uploads/`，PostgreSQL 只保存附件元数据。
- 当前阶段不加入 `NoteVersion`、知识点、题目、Embedding、DocumentChunk、IngestionJob 等后续模型。

## 已实现的结构

### Prisma 与迁移

- `prisma/schema.prisma`：`User`、`KnowledgeSpace`、`Folder`、`Tag`、`Note`、`NoteTag`、`Attachment`、`ContentAnnotation`。
- `prisma/migrations/0_phase1_initial/migration.sql`：初始表、索引、外键和目录同级名称唯一的 PostgreSQL partial unique index。
- `prisma/migrations/1_attachment_reliability/migration.sql`：为附件增加 `sha256`、`status`、`verifiedAt` 和完整性检查索引。
- `prisma/migrations/migration_lock.toml`：固定 PostgreSQL provider。
- `internalLinks` 与 `headingPath` 暂保留 JSONB，保持当前 API 语义；待语义稳定后再评估关系化。
- `deleted` 在数据库中映射为 `deletedAt`，不丢失回收站数据。

### 运行时接入

- `apps/api/src/postgres-app.factory.js` 是 PostgreSQL 应用上下文入口。
- `apps/api/src/modules/knowledge/infrastructure/postgres/` 提供按聚合拆分的异步 Repository。
- `apps/api/src/modules/knowledge/application/postgres-async/` 提供异步应用服务；原有同步服务不被替换，保证 JSON 路径稳定。
- `apps/api/src/infrastructure/postgres-attachment-store.js` 负责“pending 元数据 → 原子文件写入 → ready 确认”的附件提交闭环。
- `apps/api/src/infrastructure/local-attachment-store.js` 与 `local-attachment-upload.js` 在 JSON 驱动下使用同一套附件状态与原子写入规则。
- HTTP route 对服务结果统一 `await`，同步 JSON 返回值仍可直接被 `await`，因此 API envelope 不变。

启用前先执行：

```bash
npm run prisma:generate
npm run prisma:migrate:deploy
PERSISTENCE_DRIVER=postgres DATABASE_URL=postgresql://... npm run dev:api
```

PostgreSQL 驱动未配置 `DATABASE_URL` 时会显式失败，不会自动切回 JSON。

## 附件可靠性闭环

附件二进制仍然存放在 `storage/uploads/`，但附件元数据现在明确记录：

- `sha256`：文件内容 SHA-256，用于迁移、备份恢复和运行期完整性核对。
- `status`：`pending`、`ready`、`missing`、`corrupt`、`failed`。
- `verifiedAt`：最近一次确认文件存在且哈希一致的时间。

上传顺序固定为：

```text
写入 pending 元数据
        ↓
同目录临时文件 + fsync + 原子 rename
        ↓
写入 ready、sha256、verifiedAt
```

进程在中间步骤退出时不会产生“已完成元数据但没有文件”的新附件；下次完整性检查会把残留的 `pending`、缺失文件或损坏文件标记出来。数据库事务不包含文件 I/O，避免把 PostgreSQL 事务误当作文件系统事务。

完整性检查默认只读，可同时检查 JSON 驱动或 PostgreSQL 驱动：

```bash
npm run check:attachments -- --driver local-json --report storage/exports/attachments-check.json
PERSISTENCE_DRIVER=postgres DATABASE_URL=postgresql://... \
  npm run check:attachments -- --driver postgres --report storage/exports/attachments-check.json
```

仅在确认报告中的可修复项后，才显式使用 `--repair`。该选项只会补写实际存在文件的哈希/尺寸/验证时间，并同步把已确认缺失或损坏的记录标为 `missing`/`corrupt`；不会伪造或删除缺失文件，也不会自动覆盖损坏内容。

## Phase1.0 实际改动与执行状态

### 已落地的工程改动

Phase1.0 已经完成“保留 JSON 默认路径、增加 PostgreSQL 可选路径、提供可解释迁移和附件校验”的基础闭环：

1. **数据模型与迁移**：新增 `User`、`KnowledgeSpace`、`Folder`、`Tag`、`Note`、`NoteTag`、`Attachment`、`ContentAnnotation` 的 Prisma 映射、外键、索引、软删除字段和目录同级唯一约束；附件可靠性字段在独立迁移中追加，便于审查与回滚。
2. **Repository 与应用服务**：按知识库聚合拆分 PostgreSQL 异步 Repository 和应用服务，保留原同步 JSON Repository、Service 和测试注入路径；`PERSISTENCE_DRIVER=postgres` 显式接入，配置不完整时失败，不静默回退。
3. **HTTP 适配**：知识库 route/handler 统一等待同步或异步服务结果，保持现有 `{ data }` / `{ error }` response envelope 和既有 API 路径不变。
4. **附件基础闭环**：JSON 和 PostgreSQL 两条路径都使用 `pending → 原子写文件 → ready`；上传、读取、重命名、删除、快照导入和笔记删除分别处理文件实体与元数据一致性，完整性脚本可以报告 `missing`、`corrupt`、`pending`、`failed` 和孤儿文件。
5. **迁移工具**：新增 `scripts/migrate-json-to-postgres.mjs`，默认只读预检，生成 counts、repairs、warnings、errors 和 checksum；`--apply` 只允许写入空目标库，缺失附件默认阻断。
6. **运维门禁**：新增 `scripts/check-attachments.mjs` 和本地 `docker-compose.dev.yml`，支持本地 PostgreSQL 启动、迁移状态检查和附件完整性检查/显式修复。

对应主要代码落点：

- Prisma：`prisma/schema.prisma`、`prisma/migrations/0_phase1_initial/`、`prisma/migrations/1_attachment_reliability/`；
- PostgreSQL 装配：`apps/api/src/postgres-app.factory.js`、`apps/api/src/postgres-async-module.js`、`apps/api/src/modules/knowledge/infrastructure/postgres/`、`apps/api/src/modules/knowledge/application/postgres-async/`；
- 迁移与校验：`apps/api/src/infrastructure/migration/json-to-postgres.ts`、`scripts/migrate-json-to-postgres.mjs`、`scripts/check-attachments.mjs`；
- 附件：`apps/api/src/infrastructure/postgres-attachment-store.js`、`local-attachment-store.js`、`attachment-integrity.js`、`attachment-status.js` 及附件目录/快照辅助模块。

### 本地验证结果

- 本地 Docker PostgreSQL 开发实例已启动，容器名为 `knowra-postgres-dev`，仅绑定本机 `127.0.0.1:5432`；Prisma 两个 Phase1.0 migration 已应用，数据库状态可复核。
- 已完成一次 JSON → PostgreSQL 本地迁移演练。由于历史 JSON 中有 6 个截图文件实体已经缺失，演练只在明确使用 `--allow-missing-attachments` 的情况下完成，缺失元数据保留为 `missing`，没有伪造文件。
- 本地演练导入规模为：`User 1`、`KnowledgeSpace 1`、`Folder 6`、`Tag 12`、`Note 40`、`NoteTag 4`、`ContentAnnotation 1`、`Attachment 11`；其中 5 个附件已完成存在性和哈希确认，6 个历史截图仍待人工恢复或明确接受缺失。
- 已完成 PostgreSQL 驱动的附件上传、读取、删除 smoke test；API、Web 和脚本测试当前均通过（API 160、Web 128、脚本 8）。

### 当前未闭环项与切换门禁

- 6 个历史截图的物理文件不在当前工作区，代码无法恢复其内容；它们不会阻塞本地功能开发，但会继续阻断“严格无缺失附件”的生产迁移。
- 生产环境仍保持 JSON 驱动，尚未切换 `PERSISTENCE_DRIVER=postgres`，也未把本地迁移结果直接视为生产数据。正式切换前必须重新备份 JSON、`storage/uploads/` 和数据库，并生成无未解释错误的迁移/附件检查报告。
- 如果决定保留这 6 条缺失附件元数据，必须在迁移报告和发布记录中明确标注“历史文件缺失、内容不可恢复”，不能把 `--allow-missing-attachments` 变成默认流程。
- 当前附件方案完成的是本地文件 + 数据库元数据的基础闭环，不包含 OSS/CDN、去重、后台垃圾回收、对象存储切换或跨进程事务日志；这些属于后续附件增强任务。

## 与领域冻结稿的边界

Phase1.0 只提供持久化和迁移能力，不提前定义领域语义：

1. 不新增 `KnowledgeItem`、`KnowledgeEvidence`、`LearningObjective`、`ExamFocus`、`Question`、`Paper`、`LearningEvidence` 或 `MasteryState`。
2. `ContentAnnotation` 仍是当前笔记系统的标注基础，不等于 `KnowledgeItem`，也不是未来正式知识链路的强制唯一入口。
3. 冻结稿中的 `LearningObjective` 与 `ExamFocus` 必须保持职责分离；旧方案的 `AssessmentPoint` 命名不在 Phase1.0 中恢复。
4. RAG、图谱和 AI 输出只能在后续领域对象和来源证据模型稳定后接入；外部 AI、对象存储和网络 IO 不进入数据库事务。

## JSON 迁移流程

入口：`scripts/migrate-json-to-postgres.mjs`。

默认是只读预检，不连接数据库、不修改 JSON、不写附件：

```bash
npm run migrate:postgres -- --report storage/exports/phase1-migration.json
```

预检会：

1. 读取并校验本地 JSON 集合和跨实体引用。
2. 兼容无 `schemaVersion` 的旧文件，记录默认值、时间字段、内部链接等修复。
3. 原样保留字符串 ID（包括中文 ID）、回收站状态、标签关联和标注。
4. 为正文计算 `contentHash`，核对附件文件存在性、实际大小和 SHA-256。
5. 为已存在附件写入 `sha256`、`status=ready`、`verifiedAt`；缺失附件标记为 `missing` 并按门禁规则阻断 apply。
6. 生成 counts、repairs、warnings、errors、checksum 报告。

只有预检通过后才允许显式 `--apply`：

```bash
npm run migrate:postgres -- \
  --apply \
  --report storage/exports/phase1-migration-applied.json
```

迁移应用前检查目标库为空；应用阶段只在单个 Prisma `$transaction` 中写数据库，附件文件读取和哈希校验均在事务外完成。目标库已有数据时会拒绝执行，不做覆盖式迁移。

当前工作区的 JSON 元数据中有 6 个附件文件缺失，因此默认预检会阻断 apply。这是保护措施，不应使用 `--allow-missing-attachments` 掩盖生产数据缺失；只有明确接受“数据库保留缺失文件元数据”的临时恢复场景才可使用该参数。

## 回滚与切换

迁移前应完成三份可恢复备份：

1. JSON 源文件副本。
2. `storage/uploads/` 附件目录副本。
3. PostgreSQL 目标库在迁移前的 `pg_dump`（目标库应为空，仍建议保留）。

迁移事务中任一数据库写入失败会自动回滚全部数据库行；迁移脚本不在数据库事务内执行文件 I/O。切换 PostgreSQL 前先停止写入并做验证，确认 API 读写和附件读取正常后再切换 `PERSISTENCE_DRIVER`。若 PostgreSQL 已接受新写入，不能把 JSON 直接当作最新数据回退；应停止服务、按维护窗口决定恢复 PostgreSQL 备份或执行反向迁移。

## NoteVersion 决策：本阶段不加入

本阶段不加入 `NoteVersion`。理由是：

- 当前 JSON 没有稳定的版本集合和版本写入协议。
- 引入后会要求每次正文更新同时写 Note 与 NoteVersion，并定义并发冲突、保留策略、恢复接口和导入语义。
- Phase1.0 的目标是可靠基础设施与可验证迁移，不能用“先建表、后补语义”的半成品扩大切换风险。

按照领域冻结稿，`NoteVersion` 不只是一个历史表，还承担来源追溯、内容快照、分析起点和未来正式知识引用的稳定边界。因此它应在进入 `KnowledgeItem` / `KnowledgeEvidence` 实现前，作为独立设计任务整体确定，并至少包含“版本写入服务 + 并发控制 + 查询/恢复 API + 数据保留策略 + 来源定位语义”。本阶段不为未来语义预建半成品表。

## 进入下一领域建设任务的准入顺序

Phase1.0 完成后，知识点与试卷模块应按以下顺序继续，不再沿用已归档方案中的“KnowledgeItem → AssessmentPoint”旧阶段命名：

1. 先冻结 `NoteVersion`、来源定位和 `KnowledgeEvidence` 的最小可追溯协议；
2. 再实现 `KnowledgeItem` 候选/确认及其来源关系，明确人工创建、标注来源和 AI 候选的差异；
3. 单独设计 `LearningObjective`，再按需要建立可选的 `ExamFocus`，不能把二者合并为旧 `AssessmentPoint`；
4. 最后才进入 `Question`、`Paper`、作答、批改和 `LearningEvidence`，并保持正式试卷快照与历史记录不可变。

## 验收基线

- 默认 JSON API 行为和现有 API/Web 测试不被 PostgreSQL 改动破坏。
- Prisma schema 可通过 `prisma validate`，migration provider 为 PostgreSQL。
- 迁移脚本默认只读，缺失附件默认阻断 apply，目标非空默认拒绝。
- 迁移报告可解释所有修复和警告，字符串 ID、软删除、标签、标注和附件元数据可追溯。
- PostgreSQL 驱动不静默降级，应用层仍遵循 `domain -> application -> infrastructure -> http` 边界。
- 新附件必须经历 `pending -> ready`，并且具备可复核的 SHA-256；完整性脚本能报告 missing、corrupt、pending、failed 和孤儿文件。
- 本地 JSON 与 PostgreSQL 两条附件路径都通过 API 测试、完整性单元测试和本地 Docker PostgreSQL 演练。

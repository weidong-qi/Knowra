# Mac 个人应用：构建与使用

> 2026-11-14。面向 Apple Silicon Mac。当前构建仍是 ad-hoc 个人候选包，未配置 Developer ID / Apple 公证。支持手动检查稳定发布，不自动下载、安装或退出。验收使用隔离资料库；构建、CI 产物、正式 Release 和已经安装是不同状态。

## 推荐流程：GitHub 构建，本机只验收安装

1. PR 经审查和 CI 通过后合并到 main。合并会自动触发 **Actions → Mac 候选构建（不发布）**；已有 main 提交需要重建时才手动 Run workflow，不重复手工打包。
2. 等待该次 Mac 工作流全部成功。在作业汇总中核对版本、完整提交 SHA、分发 ZIP SHA-256 和签名状态，使用汇总里的 artifact 下载链接（保留 14 天，可能需要登录）。PR 候选包对应测试合并提交，不能代替合并后 main 的候选包。
3. 解开 GitHub artifact 的外层 ZIP，保留内部 `知境·Knowra-Mac-arm64.zip` 和同名 `.build-info.json`。核对目标 SHA、版本和分发 ZIP 哈希；不要使用失败运行的包或只凭文件名判断来源。
4. 确认安装来源与信任状态后，在应用中创建、检查并导出完整备份，正常退出旧 APP，保留旧程序再安装新版。不要删除或覆盖 `Knowra/offline` 和 `Knowra/shell`。候选包仍是 ad-hoc、未公证；macOS 若阻止打开，停止并等待受信任的签名/公证交付，不绕过系统保护。

此流程不要求在个人 Mac 安装开发依赖或运行重型构建、E2E、隔离验收；这些由 GitHub Actions 完成。候选包不是稳定 Release，应用内“检查更新”仍只读取正式稳定发布。

## 打开应用

`npm run build:mac` 只生成候选 APP 和 ZIP，不安装。开发者完成隔离验收后，可显式运行 `npm run install:mac` 安装到 `/Applications/知境·Knowra.app`；用户拿到经核验的正式发布包后按发布说明安装，双击打开即可，无需安装 Node、npm 或另外启动 API。菜单提供编辑快捷键、窗口操作和“打开本机资料目录”。关闭窗口、`⌘W` 和 `⌘Q` 均先请求页面保存正文，成功后结束本地服务；失败时保留窗口并显示原因。

输入法候选尚未确认时，请先确认或取消候选，再退出。系统强制结束进程不能执行退出握手；已提交内容在 SQLite 中保留，尚未提交的笔记和知识表单由独立恢复草稿保护。恢复草稿写入失败时会显示错误，不保证最后输入已落盘。

应用从独立本机资料库启动，不自动导入仓库或线上数据。云端连接在底部状态栏设置，笔记与知识可先离线保存，联网后同步。云端需声明 `knowledge-items-v1` 才能接收知识；旧云端仍同步笔记，知识保留在本机等待升级。训练写入、保存分析范围和 AI 提炼尚未开放离线入口。

知识库中可创建、编辑、确认、归档和恢复候选，也可追加、更换或移除来源；旧摘录历史会保留，来源全部失效时已确认知识转为待修订。表单输入会保留恢复草稿，异常退出后可在知识库恢复；恢复沿用原来源和编辑版本，发生并发变化时会拒绝覆盖。同步冲突处理前自动保存恢复记录。主页、左侧入口与 `⌘N` 均可直接新建笔记并打开。

## 数据与升级

- 本机业务数据：`~/Library/Application Support/Knowra/offline`。
- 桌面窗口配置及日志：`~/Library/Application Support/Knowra/shell`。
- 同步登录凭据只保留在运行内存，退出后需要重新输入。
- 底部同步面板的“本机备份与恢复”提供备份列表、检查和恢复。默认备份仍保存在本机 `offline/backups` 资料目录中。完整备份包含笔记、关联资料、附件、待同步修改及恢复草稿；检查包含文件哈希、声明大小、SQLite 完整性、资料引用、附件和草稿内容。检查通过后，勾选确认再恢复整个资料库。
- 先创建或选择一份备份，再点击“导出所选完整备份”，在原生选择器中选一个独立父目录或介质。应用创建 `Knowra-完整备份-<备份编号>` 新子目录，禁止覆盖已有目录；请保管其中全部文件。此操作允许你另行保存副本，不表示默认目录已自动拥有异机副本。
- 点击“导入外部完整备份”并选择导出的完整目录，应用会校验后复制到本机备份列表。导入成功不会自动恢复，仍需点击“检查所选备份”，核对后勾选整库确认并点击恢复。普通浏览器暂不支持完整目录导出与导入。
- 取消选择不会修改资料或已有目标；发生校验或复制错误时原资料保留。若所选路径或复制条目被外部替换，应用可能保留未完成目录并提示中断，以免清理替换物；不要将未完成目录当作已检查的完整备份。当前验收覆盖普通本地目录和两个独立合成资料根，真实外盘及 exFAT 尚未实测。
- 恢复前自动创建“恢复前保护”备份，原资料及待同步修改保留。恢复写入 `offline/restored/<编号>`，由 `offline/active-dataset.json` 选择活动资料；不要只复制根目录的 `local.sqlite` 作为当前备份。
- 恢复完成后点击“重新加载已恢复资料”，核对正文和附件，再主动连接云端。旧窗口必须重新加载后才能读写业务数据；旧恢复草稿保留导出入口，不自动覆盖恢复后的正文。
- CLI 独立救援导出会读取当前活动资料集并保留根目录恢复草稿。恢复与独立救援导出命令见阶段 4/5 文档。
- 更新前创建并导出经过检查的完整备份，再正常退出应用。安装命令只更换程序并保留旧程序用于恢复，不清理仓库构建副本、其他安装位置或用户数据目录。程序回退不等于资料库回退；若新版本迁移了资料格式，旧程序可能无法读取，应根据该版本说明恢复升级前的完整备份，不能直接覆盖新资料。

个人版本采用本地 ad-hoc 签名，不是 Apple Developer ID 分发签名。若 macOS 阻止运行，停止安装并核实来源或等待经 Developer ID 签名和公证的包。不要关闭 Gatekeeper、移除 quarantine 或将 ad-hoc 校验当作身份认证。该构建未作其他 Mac、Intel 架构或所有 macOS 版本的兼容承诺。

## 工程附录：CI 构建入口

以下命令用于 GitHub macOS runner，不是本机操作步骤。个人 Mac 只做阅读、差异检查和本次改动的轻量格式/静态检查；不要为了等待 CI 而改在本机运行构建或隔离验收。

```bash
npm ci --ignore-scripts
npm run prisma:generate
npm run build:mac
# 核对打包内的原生图像运行时之后，再执行：
npm run test:mac
```

`test:mac` 已包含 ZIP 解包后的身份、哈希、签名、架构核验以及隔离测试，不需要在它前面再执行一遍 `verify:mac`。`verify:mac` 保留为只做产物核验的独立入口。工作流另外保留构建期间的原生依赖核验与最终 APP 的 PNG/JPEG/WebP 解码检查，不能用元数据检查替代。

输出：`dist/mac/知境·Knowra-darwin-arm64/知境·Knowra.app`、`dist/mac/知境·Knowra-Mac-arm64.zip` 及其构建身份清单。构建不操作 `/Applications` 或用户资料；安装是单独、显式改变本机程序的操作。可通过 `KNOWRA_ELECTRON_ZIP_DIR` 指向已下载的 Electron ZIP 缓存目录。版本锁定在 lockfile；应用内置 Electron 运行环境，SQLite 在独立 utility process 中运行。

## 核对构建与隔离验收

设置 → 关于知境，以及 macOS 菜单 → 关于知境·Knowra，可查看应用版本、完整提交 SHA、构建状态和 UTC 时间。`clean` 表示构建时没有未提交的源码修改；`dirty` 明确表示含未提交修改，`unknown` 表示无法确认。SHA 是构建时实际检出的提交；PR 合并后产生不同 SHA 时，已有包仍保留原始来源，不覆盖为合并提交。需要交付合并提交包时，应重新构建。

APP 的 `Contents/Resources/app/build-info.json` 和 `web/build-info.json` 必须完全一致。`Contents/Info.plist` 也记录提交与状态。ZIP 旁的 `知境·Knowra-Mac-arm64.zip.build-info.json` 记录同一身份与 ZIP 的 SHA-256；分发时一起保留。正式安装校验当前工作树的版本/HEAD 和产物，未知/脏树、缺少标识或同版本旧 SHA 都会停止。

桌面打包测试在 GitHub 一次性 runner 中自行创建 `KNOWRA_DESKTOP_SMOKE_DIR` 合成资料目录，不自动回退到 `/Applications`。`test:mac` 串行执行全部桌面壳测试，包括会写系统剪贴板的 `packaged-list.test.mjs`；不在个人 Mac 重跑。`npm run build:mac` 是纯构建入口；`npm run install:mac` 才执行安装，且不运行无关副本清理。

没有 `.git` 的源码导出或容器构建，默认记录未知 SHA/状态。可在进程环境显式提供 `KNOWRA_BUILD_COMMIT=<40位小写SHA>`；不提供 `KNOWRA_BUILD_STATE` 时仍为 `unknown`。受控构建者确认来源后才可显式提供 `clean` 或 `dirty`，信息来源显示为 `external`，不宣称是本地 Git 核验。隔离 Dockerfile 支持同名 `--build-arg`。Git 工作树中，显式输入必须与实际 HEAD/状态相同。发布身份不读取开发 `.env`；正式安装和 Linux 发布均要求完整 SHA 与 `clean`。

打包仅收集主进程、隔离 preload、编译后的本地服务和 V4 资源；不包含仓库 `storage/`、`.env`、云端凭据或测试资料。PostgreSQL 客户端不随本机服务分发，本机固定使用 SQLite，云端通过 HTTP 同步。

窗口启用 context isolation、sandbox 并禁用 Node integration；预加载只暴露保存握手、受限恢复草稿、模型设置、附件和完整备份动作。完整目录路径由受信主进程的原生选择器取得，页面不能指定本机路径或 URL；导入导出通过私有服务通道，不新增 HTTP 路径入口。外部链接交给系统浏览器，本地服务保持回环会话隔离。

## 工程检查

- V4 类型检查、构建、架构边界及回归测试。
- 退出握手：附件在途等待、正文保存顺序、保存失败保留窗口、输入法候选阻止退出。
- 打包程序在隔离资料库启动，中文输入后立即退出，检查 SQLite 落盘并重新启动读取；确认渲染页面没有 Node `require`。
- `codesign --verify --deep --strict` 检查本地签名。

以上工程检查不代替用户验收；本轮不宣称真实云端、完整交互、所有异常退出和升级路径已经人工验收。

2026-09-10 历史工程记录：Electron 44.3.0、内置 Node 24.20.0；V4 回归 281 + 4 项通过，最后编辑器定向检查 15 项通过，打包程序冒烟 1 项通过。验证记录见 [Mac 应用工程检查](验收证据/Mac个人应用/验证记录.json)。

验收日志和验证记录仅保存在本机，不随公开源码仓库发布。


## 发布、检查更新与信任边界

macOS 菜单“知境·Knowra → 检查更新…”由用户主动触发，仅访问固定仓库 `1848956505/Knowra` 的 GitHub 最新稳定 Release API，不上传本机资料、设置或凭据。无稳定 Release、缺少 Mac ZIP/身份清单、离线、限流和响应异常都会明确提示。相同版本号无法证明相同构建，界面显示当前完整 SHA 并提示核对，不声称“已是最新”。关闭或取消不会下载、安装、退出，也不会修改资料。点击“打开发布页”才打开固定仓库发布页；发布说明中的其他 URL 不会自动执行。

### CI 候选包不是正式发布

Mac 工作流在 GitHub macOS ARM runner 上构建、解包核验并用合成目录启动测试，上传短期候选 artifact。下载 artifact 可能要求 GitHub 登录且受保留期限制；它不是永久安装地址，也不会出现在应用的稳定更新检查中。当前 workflow 无发布写权限，不创建 tag 或 Release，不自动向公众发包。main 合并后会重新构建真实合并 SHA，不能把 PR 的包改标签冒充 main 包。

### 不写代码也能获取新的候选包

工作流合并到 main 后，在仓库网页打开 **Actions → Mac 候选构建（不发布）**。main 每次合并会自动构建；需要重新构建时，点击 **Run workflow** 并选择 main。等待该次运行所有步骤绿色通过，核对运行对应完整 SHA，再在底部 **Artifacts** 下载 `knowra-mac-arm64-candidate-<SHA>`。解开 GitHub artifact 外层 ZIP，里面还有 APP 分发 ZIP 与 `.build-info.json`。不要使用失败运行或其他来源同名包。此步骤不需要 assistant 手工打包，也不需要在个人 Mac 装开发工具。

首次引导安装仍需要一个获准交付的包，旧版 APP 不会凭空出现新菜单。当前这些是未公证候选包：可以取得并核对候选产物，但不能把它视为普通用户可无障碍安装的稳定交付。若系统阻止打开，停止，不绕过保护；等待签名/公证和正式发版决策。首次安装新版后才出现手动更新入口。当前还没有稳定 Release 时，入口会提示“尚无可用的稳定发布”；以后仍需维护者按下面流程发布才会出现稳定更新。

### 正式发布者检查清单（本阶段尚未执行）

1. 每次面向用户的新二进制递增 SemVer，同步更新三处正式版本清单（根目录、`apps/api`、`apps/web` 的 `package.json`）和 lockfile，具体一致性由 `scripts/build-info.mjs` 检查。不得以相同版本号替换已发布包。审查、CI 通过且合并后，以合并提交构建。
2. 确认 Apple Developer Program、Developer ID 证书、签名及公证授权和安全凭据配置。现有 `@electron/packager` 支持 `osxSign` / `osxNotarize`，无需另换重型打包工具。签名公证后重新生成 ZIP/哈希并核验；现有 ad-hoc 候选包不能宣称已完成这些步骤。
3. 在 macOS 核验签名身份、Apple 公证/评估结果、ZIP 解包后的版本/完整 SHA/clean 状态、启动和保存重开；以合成旧资料副本验证本次升级及备份恢复。当前 CI 不替代每次资料格式变化的升级矩阵。
4. 经批准创建对应 `vX.Y.Z` tag 与稳定 GitHub Release。上传该提交的 ZIP 和同名 `.build-info.json`，记录完整 SHA、Apple 签名身份、公证状态、最低系统/架构要求、变更与安装/恢复步骤。不把 CI artifact 地址当永久更新地址。本阶段不自动发布。
5. 同页可变清单中的 SHA-256 只能发现损坏或意外混包，不能认证发布者，也不能防止仓库账号被入侵。发布来源信任依赖固定仓库 HTTPS 与账号权限；可执行文件身份还需 Apple 签名和公证。不要把本入口描述成安全自动安装器。

### 用户手动更新

在应用内导出完整备份，查看固定仓库发布页版本、完整提交及说明。只有确认来源、架构和签名/公证状态后才下载；核对 ZIP 哈希与身份清单，解包后核对应用“关于”中的版本及 SHA。正常退出旧程序，将旧程序另存以便恢复，再将新版放到 Applications。独立 `Knowra/offline` 与 `Knowra/shell` 不属于 APP 包，不删除或覆盖它们。新版本首次打开后核对资料和模型设置；ad-hoc 身份变化可能触发钥匙串再次确认，不保证跨构建免提示。出现异常先保留现状与新旧备份，再按该版本恢复说明操作。

后续若获准配置 Developer ID 和公证，可采用官方 Electron `autoUpdater` / `update-electron-app`；macOS 的 Squirrel.Mac 依赖签名。当前不接入未经验证的自动下载或后台覆盖安装，也不绕过既有保存退出握手。

官方参考：[签名与公证](https://www.electronjs.org/docs/latest/tutorial/code-signing)、[更新应用](https://www.electronjs.org/docs/latest/tutorial/updates)、[autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater)。

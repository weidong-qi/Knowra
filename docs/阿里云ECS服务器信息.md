# 阿里云 ECS 服务器信息

2026-10-02独立验收核查：现网PM2两进程及Basic Auth在线，当前约745MiB可用内存，暂无Docker/PG或独立测试实例。本轮没有部署/安装/认证/网络变更。新的[独立合成验收配置](../deploy/isolated-test/README.md)应在另获授权的验收主机运行；生产JSON发布流程与资料真源不变，目标/费用/凭据/公网入口尚待明确。

更新时间：2026-09-29

本文档用于在其他设备上的 Codex 继续接入和维护当前 知境·Knowra 服务器。不要在本文档中保存私钥、服务器密码、API Key 或其他明文密钥。

## 基础信息

- 云厂商：阿里云
- 服务器类型：ECS
- 操作系统：Ubuntu 22.04.5 LTS
- 主机名：`iZ2ze79rc2xe67bwj2jq4gZ`
- 公网 IP：`47.95.236.184`
- 内网 IP：`172.26.73.107`
- SSH 用户：`root`
- SSH 端口：`22`
- 域名：`https://knowra.qwdream.top/`
- 公网 IP：`http://47.95.236.184/`（HTTP 自动跳转 HTTPS）
- 健康检查地址：`https://knowra.qwdream.top/api/health`
- HTTPS 证书：Let's Encrypt，2026-09-21 检查有效期至 2026-12-05

## SSH 连接

当前运维 Mac 和此前的 Windows 电脑均已配置各自的 SSH 公钥，可以直接连接：

```bash
ssh root@47.95.236.184
```

其他新设备需要单独添加自己的 SSH 公钥，不能复用现有设备的私钥。

## MacBook Codex 接入步骤

在 MacBook 终端执行：

```bash
ls ~/.ssh
```

如果已有 `id_ed25519.pub`，查看公钥：

```bash
cat ~/.ssh/id_ed25519.pub
```

如果没有，生成一把新 key：

```bash
ssh-keygen -t ed25519 -C "macbook-codex"
cat ~/.ssh/id_ed25519.pub
```

复制输出的整行公钥，然后在服务器上执行：

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
printf '%s\n' 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIm+9chI8ys897hzAxZB59G0J4yu7ROdpGGW72R2kiNK macbook-codex' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

之后在 MacBook 上测试：

```bash
ssh root@47.95.236.184
```

测试通过后，该设备上的 Codex 就可以通过 SSH 管理这台服务器。当前 Mac 已于 2026-09-29 验证 SSH 连接。

## 项目部署位置

服务器项目目录：

```text
/opt/knowra
```

Git 仓库远程地址：`git@github.com:1848956505/Knowra.git`（部署用 Deploy Key 认证）

当前运行方式（首次 CI 发布包激活前）：

> 下方 `web-v4` 路径记录当时的服务器状态。仓库现行前端目录已改为 `apps/web`；服务器实际运行版本和路径需以部署后的 PM2 状态为准。

- Node.js monorepo（Git 克隆）
- 前端服务：`apps/web-v4/server.mjs`（静态服务 + `/api/*` 同源代理）
- 后端服务：`apps/api/src/main.ts`
- 进程管理：PM2（进程名 `knowra-web` / `knowra-api`）
- 反向代理：Nginx（HTTPS 443 端口）
- 对外端口：`443`（HTTPS），`80`（HTTP → HTTPS 跳转）

## 运行时服务

Node.js 和 npm：

```text
Node.js: v24.18.0
npm: 11.16.0
```

PM2 服务：

```text
knowra-api  -> /opt/knowra/apps/api/src/main.ts, PORT=3001, KNOWRA_OWNER_ID=demo
knowra-web  -> /opt/knowra/apps/web-v4/server.mjs, PORT=3000, API_ORIGIN=http://127.0.0.1:3001
```

`NODE_ENV=production` 下两个进程严格绑定上述端口。端口被占用时必须启动失败，不得自动切换到 Nginx 未代理的其他端口。

常用命令：

```bash
pm2 status
pm2 logs knowra-api
pm2 logs knowra-web
pm2 restart knowra-api knowra-web --update-env
pm2 save
```

## 部署流程

2026-09-02 V4 正式切换前备份已保存在：

```text
/opt/knowra-backups/pre-v4-20260902-191737
```

该目录包含整个 `storage/` 归档、独立 `knowledge-base.json`、当前 Git 提交、PM2 状态和 Nginx 配置。`SHA256SUMS` 已通过，归档可读，且归档内知识库与独立副本哈希一致。该备份不替代每次部署前的新备份。

### 百度网盘异地加密备份

服务器已通过百度网盘开放平台自有应用直连，不再依赖第三方 `bypy` 授权。备份只写入应用目录：

```text
/apps/知境/KnowraBackup/
```

每天北京时间 03:30 后的 10 分钟随机窗口内，`knowra-baidu-backup.timer` 会执行一次备份。脚本复制生产 `storage/data/`、`storage/uploads/`、Git 提交、PM2 状态、Nginx 配置和 Basic Auth 哈希文件，以服务器证书进行 CMS AES-256 加密，再通过百度官方 Go SDK 上传。每次上传后必须回下载并比较 SHA-256；只有一致时任务才成功，同时上传 `.sha256` 校验文件。当前不自动删除本地或网盘历史备份。

```bash
# 查看计划和最近结果
systemctl list-timers knowra-baidu-backup.timer --all
systemctl status knowra-baidu-backup.service
journalctl -u knowra-baidu-backup.service -n 100 --no-pager

# 手动执行一次完整备份、上传和回下载校验
systemctl start knowra-baidu-backup.service

# 查看网盘目录（输出不得包含 token）
/opt/knowra-backup-tools/baidu-drive list "/apps/知境/KnowraBackup"
```

敏感文件只保存在服务器 `/etc/knowra-backup/`，权限必须保持 `600`；备份客户端和脚本权限为 `700`。访问令牌会在到期前 7 天自动刷新。解密私钥不在服务器和 Git 中，只保存在运维工作站已被 Git 忽略的 `storage/exports/backup-keys/knowra-backup-private-key.pem`。若该私钥丢失，网盘中的 `.p7m` 备份无法解密；应另做离线保管，但不得把私钥上传到同一个百度网盘目录。

正式部署只允许从 GitHub `main` 的已审核提交执行。完整 `npm test`、原始 E2E 和依赖审计必须先在 CI 或与生产隔离的验收机上完成，并将结果绑定到待部署提交。**不得在正在提供服务的生产主机上运行 `npm test`**；主机约 1.6 GiB 可用物理内存，曾因并行测试失去响应。2026-09-29 已检查到 2 GiB swap，但它不能替代物理内存。

### CI 构建、Codex 按需发布

现有 `.github/workflows/ci.yml` 在 Ubuntu 24.04 上完成构建、测试、浏览器验收和依赖审计；推送触发的成功运行随后生成包含 Linux 生产依赖、V4 `dist`、源码及提交清单的发布包。发布包不包含 `storage/`、密钥或服务器配置。

用户指定当前 `main` 的已验收提交后，Codex 在运维 Mac 上执行以下命令；用户无需在 GitHub 网页下载或手动上传：

```bash
cd /path/to/Knowra
bash scripts/deploy-ci-release.sh <main的完整40位提交SHA> root@47.95.236.184
```

Mac 脚本核对 GitHub `main` 与成功 CI 运行，下载发布包并校验 SHA-256，然后经现有 SSH 权限传至 ECS。服务器脚本依次完成：

1. 核对服务器源码干净、目标是当前 `main` 且允许快进，并确认两个 PM2 进程存在。
2. 每次新建 `/opt/knowra-backups/ci-release-*`，备份当前 JSON 数据与附件；旧版和候选版均对服务器真源执行附件只读检查。
3. 将上一版哈希资源补入候选目录，放入 `/opt/knowra/.deploy-releases/`，原子切换 `/opt/knowra/current`；两个进程从该目录启动，通过符号链接继续使用 `/opt/knowra/storage`。
4. 删除旧 PM2 进程定义并从发布目录重新启动；确认两个进程的实际执行路径、API/Web 健康检查都通过后，快进 `/opt/knowra` 的 Git 提交并保存 PM2 状态。切换会短暂重启服务；失败时恢复先前运行目录和进程。
5. 成功后清除本次上传到 `.deploy-incoming/` 的压缩包和校验文件；发布目录与发布前备份继续保留，按磁盘占用定期人工清理过旧记录。

生产主机不执行 `npm ci`、`npm test` 或 V4 构建。当前脚本只支持 `local-json`；正式切换 PostgreSQL 前必须增补数据库备份、迁移、验证和回滚门禁。旧 `scripts/post-deploy.sh` 仅保留为人工应急入口。

附件完整性门禁：

```bash
# 当前 JSON 生产模式：只读检查，status=degraded 时先处理报告中的缺失/损坏文件
npm run check:attachments -- \
  --driver local-json \
  --report "$backup_dir/attachments-check.json"
```

若切换到 PostgreSQL，必须额外备份数据库并在切换前后执行 PostgreSQL 检查；不能只备份 `storage/uploads/` 而遗漏数据库中的附件元数据：

```bash
# DATABASE_URL 应来自服务器受保护的环境文件，不要写入仓库
pg_dump --format=custom --file="$backup_dir/knowra.dump" "$DATABASE_URL"
npm run prisma:generate
npm run prisma:migrate:deploy
npm run check:attachments -- \
  --driver postgres \
  --report "$backup_dir/postgres-attachments-check.json"
```

`check:attachments` 默认只读；只有确认报告中的可修复项后才允许追加 `--repair`。报告出现 `ATTACHMENT_FILE_MISSING` 或 `ATTACHMENT_HASH_MISMATCH` 时，不得以 `--repair` 伪造文件完整性，也不得继续把该库宣称为可恢复状态。

CI 构建完成后必须确认 V4 入口存在且不包含 Source Map：

```bash
test -f apps/web/dist/index.html
test -z "$(find apps/web/dist -type f -name '*.map' -print -quit)"
```

`Transformer` 历史资料中的 5 张 HTTP 外链图使用以下脚本迁移。脚本默认只读预检，备份数据后才能显式执行：

```bash
node scripts/migrate-transformer-http-images.mjs
node scripts/migrate-transformer-http-images.mjs --apply
```

成功结果必须显示 `status: migrated`、5 个本地附件，并确认原始 HTTP URL 数量为 0；再次运行预检应显示 `status: already-migrated`。

> 经验教训：2026-07-05 的 404 事件就是因为部署只跑了 `git pull` + `pm2 restart`，
> 忘了重新生成 bundle，PM2 起来后发现 bundle 不存在，前端 50% 资源加载失败。
> 常规发布由 CI 绑定提交生成完整发布包，避免遗漏构建产物。

### 代码回滚

新发布在健康检查失败时自动恢复 `/opt/knowra/current` 的旧指向并重新加载旧进程。若发布成功后需要人工回退，先保留故障现场，再用 `/opt/knowra/.deploy-releases/` 中已验收的旧目录切回；首次采用 CI 发布包之前的版本位于原始 Git 工作区，需按下面的人工应急步骤恢复。数据格式不兼容时还需按备份恢复数据。不要只回退 Git 代码而保留新版进程。

旧现场构建流程的人工应急回退方式如下；它会在服务器执行安装和构建，不属于常规发布：

```bash
cd /opt/knowra
git switch --detach <known-good-sha>
npm ci --ignore-scripts
./scripts/post-deploy.sh
curl --fail http://127.0.0.1:3001/api/health
```

确认问题解决后再 `git switch main`。只有发生数据格式或运行时数据损坏时才恢复备份；恢复前必须先停止 PM2，并保留故障现场副本。

## Nginx 配置

> 待发布代码的来源保护约定（未在生产应用）：`deploy/ecosystem.config.cjs` 显式设置 `WEB_TRUST_LOOPBACK_PROXY=1`，Web 仅对回环连接采纳单值 `X-Forwarded-Proto: http|https`。前置 Nginx 必须覆盖该头与 Host；示例改为 `$http_host` 保留非默认端口。独立运行 Web 默认不信任转发头，API 始终不信任它们。Web 校验外部同源写入后改写上游 Origin 并清除转发头；具体 `CORS_ALLOWED_ORIGINS` 保持跨源客户端兼容，`*` 仅开放读取，跨源写入需列出可信来源。来源保护不是身份认证，Basic Auth 仍需保留。本次仅修改配置与隔离测试，未部署、未验证线上浏览器凭据行为。

当前配置文件：

```text
/etc/nginx/sites-available/knowra
```

当前完整配置（HTTPS + HTTP 跳转）：

```nginx
server {
    listen 80;
    server_name knowra.qwdream.top;
    client_max_body_size 100m;

    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name knowra.qwdream.top;
    client_max_body_size 100m;

    ssl_certificate /etc/letsencrypt/live/knowra.qwdream.top/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/knowra.qwdream.top/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_types
        text/plain
        text/css
        application/javascript
        application/json
        image/svg+xml;

    auth_basic "Knowra";
    auth_basic_user_file /etc/nginx/.htpasswd-knowra;

    location = /api/health {
        auth_basic off;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

说明：

- HTTP（80）自动 301 跳转到 HTTPS（443）。
- 除 `/api/health` 外，整个站点由 Nginx HTTP Basic Authentication 保护；密码文件只存在服务器 `/etc/nginx/.htpasswd-knowra`。
- 浏览器访问域名后，前端请求使用相对路径 `/api/...`。
- 前端服务内部再把 `/api/...` 代理到 `http://127.0.0.1:3001`。
- 证书由 Let's Encrypt 自动续期（`certbot renew`）。
- Nginx 对 HTML 以及 JavaScript、CSS、JSON、SVG 和文本资源启用 gzip；Web 静态资源使用 ETag/`Last-Modified` 协商缓存，SSR 首页保持 `no-store`。

> **当前运行状态（2026-09-02）**：生产 Basic Auth 已恢复，用户名为 `knowra`；未认证主页返回 `401`，`/api/health` 仍匿名返回 `200`。恢复前的 Nginx 配置保留在 `/etc/nginx/sites-available/knowra.pre-auth-20260902-191737`。

首次启用访问保护：

```bash
apt-get update
apt-get install -y apache2-utils
htpasswd -c /etc/nginx/.htpasswd-knowra knowra
chown root:www-data /etc/nginx/.htpasswd-knowra
chmod 640 /etc/nginx/.htpasswd-knowra
cp /opt/knowra/deploy/nginx/knowra.conf.example /etc/nginx/sites-available/knowra
```

不要把密码或 `.htpasswd-knowra` 写入仓库。正式配置模板见 `deploy/nginx/knowra.conf.example`。

检查和重启 Nginx：

```bash
nginx -t
systemctl restart nginx
systemctl status nginx
```

## 数据路径

当前统一的活跃数据文件：

```text
/opt/knowra/storage/data/knowledge-base.json
```

本地对应路径：

```text
storage/data/knowledge-base.json
```

历史原因：旧数据曾位于 `apps/api/storage/data/knowledge-base.json`。现在运行时统一读取根目录下的 `storage/data/knowledge-base.json`，本地与服务器都应保持这个路径为准。

附件路径约定：

- 运行时附件目录统一使用根级 `storage/uploads/`
- `attachments[*].storagePath` 统一保存为跨平台相对路径：`storage/uploads/<attachment-id>-<safeName>`
- 不再把 Windows 风格 `storage\\uploads\\...`、Linux/macOS 绝对路径，或旧的 `apps/api/storage/uploads/...` 作为长期真源
- 如遇旧快照或旧服务器目录残留，优先迁移文件到根级 `storage/uploads/`，再让元数据回写为上述统一格式

CI 发布包的发布前备份放在：

```text
/opt/knowra-backups/ci-release-<随机标识>/
├── previous-commit.txt
├── storage.tar.gz
├── attachments-before.json
└── attachments-candidate.json
```

历史现场构建流程的发布备份格式为：

```text
/opt/knowra-backups/<YYYYMMDD-HHMMSS>/
├── knowledge-base.json
├── uploads.tar.gz
└── attachments-check.json
```

启用 PostgreSQL 的部署备份还应包含 `knowra.dump`。恢复时先停止 PM2，恢复数据库和附件目录，再运行完整性检查；检查未通过前不得重新开放写入：

```bash
pg_restore --clean --if-exists --dbname="$DATABASE_URL" "$backup_dir/knowra.dump"
tar -C /opt/knowra/storage -xzf "$backup_dir/uploads.tar.gz"
npm run check:attachments -- --driver postgres --report "$backup_dir/restore-check.json"
```

每次正式部署前都必须新建一份备份，不复用旧备份目录。

## 部署辅助文件

当前部署文件：

```text
deploy/README.md
deploy/nginx/knowra.conf.example
scripts/package-ci-release.sh
scripts/deploy-ci-release.sh
scripts/activate-ci-release.sh
scripts/post-deploy.sh
```

激活脚本最多等待 120 轮健康检查，以容纳大历史库启动时的引用校验；超时仍自动回滚。

常规发布使用 GitHub CI 生成的带提交清单与校验文件的 Linux 发布包；服务器只拉取 GitHub `main` 用于校验目标提交和更新备份所记录的版本。

## 安全组

当前公网 HTTP 能访问的前提：

- ECS 实例绑定的安全组已放行入方向 TCP `80`
- 来源当前为 `0.0.0.0/0`
- SSH 使用 TCP `22`

如果只想自己访问，建议把 TCP `80` 的来源改成自己的公网 IP `/32`。

## 安全注意事项

当前代码尚未提供多用户账号系统，因此生产安全基线采用 Nginx HTTP Basic Authentication 作为单用户访问保护。2026-09-02 已恢复该保护：

- **已启用 HTTPS**（Let's Encrypt 证书）。
- API 的 `KNOWRA_OWNER_ID`（当前建议 `demo`）只固定知识空间所有者并忽略客户端 `userId`，不校验访问者身份，不能替代 Basic Auth。
- 除 `/api/health` 外的页面和 API 均经过 Basic Auth。
- `3000`、`3001` 端口只允许服务器本机访问，不得对公网放行。
- 不要把私钥、密码、云账号凭据写入仓库或本文档。

后续建议：

1. 只有在需要多用户或更细权限时，再增加完整的账号、会话、CSRF、限流与恢复系统，替换 Basic Auth；不要只增加登录表单。
2. 创建非 root 的部署用户，例如 `deploy`。
3. 关闭 root SSH 登录或限制 root 登录来源。
4. 定期备份 `storage/data/knowledge-base.json` 和 `storage/uploads/`。

## 快速验证

在任意能联网的机器上执行：

```bash
curl https://knowra.qwdream.top/api/health
```

期望返回：

```json
{"data":{"status":"ok"}}
```

未认证访问 `https://knowra.qwdream.top/` 应返回 `401`，`/api/health` 仍返回 `200`。

服务器本地验证：

```bash
curl http://127.0.0.1:3001/api/health
curl http://127.0.0.1:3001/api/knowledge/spaces
pm2 status
```


## 2026-09-10 云端同步升级

该次同步服务部署提交：`a492d52954797c2e9300f3a82c52caa9ee19c494`。仍使用 local-json 与现有 Basic Auth；新增 `/api/sync/*`，支持完整实体事务与附件传输。

本机隔离回归、真实 PostgreSQL 测试和 GitHub CI 已通过；原始 55 项页面用例在初始化等待修正及重跑后均通过。生产主机没有运行测试套件。

部署前完成一致性备份；在线 npm 下载超时后回退旧程序，再通过与锁文件一致的公开 Linux 依赖缓存离线升级。详细备份路径和操作记录保存在本机忽略的 `docs/离线编辑与同步/验收证据/云端升级20260910/部署记录.json`，不随公开仓库上传。

## 2026-09-21 保存修复与知识同步发布

运行版本 `2.24.0`，功能提交 `a19c3f93f852725cb50b3b5a6531af1f0fdffee6`。先发布独立验收的 `2.23.0`（`6f66486e`），再发布知识离线同步、恢复草稿和 AI 纯契约准备；未启用模型调用。

- 一致性备份：`/opt/knowra-backups/20260920T170801Z-2.23.0` 和 `/opt/knowra-backups/20260920T172427Z-2.24.0`，UTC 路径对应北京时间 9 月 21 日。包含运行数据、旧前端、代码版本和 SHA-256；未删除旧历史库。
- 两次均在本地完成测试，生产仅执行依赖安装、附件只读检查、构建与原子发布。PM2 的 API/Web 均刷新为 2.24.0。
- 线上健康接口返回 200，未认证主页保留 401，入口引用的前端资源均可读取；`/api/sync/status` 包含 `knowledge-items-v1` 且允许推送。
- 发布前后数据对比没有笔记、正文或历史版本变化；只更新附件验证时间和同步元数据。附件 15 项均完整。
- 当前仍为 local-json，未切换 PostgreSQL。代码回滚不自动回滚运行数据；应先保留故障现场，再决定是否恢复备份。

验证范围与已知边界见 [知识离线同步与 AI 接入准备](已归档/审查/2026-09-21-知识离线同步与AI接入准备.md)。

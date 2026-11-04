#!/usr/bin/env bash
# 在 ECS 上验收并激活 CI 发布包；只执行轻量校验、备份与进程切换。
set -Eeuo pipefail
umask 077

if [[ $# -ne 3 || ! "$2" =~ ^[0-9a-f]{40}$ ]]; then
  echo '用法：activate-ci-release.sh <项目根目录> <40位提交SHA> <已解包目录>' >&2
  exit 2
fi

root="$(realpath -e "$1")"
commit="$2"
stage="$(realpath -e "$3")"
incoming_dir="$(dirname "$stage")"
case "$stage" in
  "$root/.deploy-incoming/"*) ;;
  *) echo '发布包必须先解压到项目的 .deploy-incoming 目录。' >&2; exit 1 ;;
esac
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || {
  echo '只能在 Linux x86_64 生产主机上激活发布包。' >&2
  exit 1
}
[[ "$(node -v)" == v24.* ]] || {
  echo '生产主机必须运行 Node.js 24。' >&2
  exit 1
}
[[ "$(node -e 'const m=require(process.argv[1]); process.stdout.write(`${m.commit}:${m.platform}:${m.nodeMajor}`)' "$stage/.knowra-release.json")" == "$commit:linux-x64:24" ]] || {
  echo '发布包清单与目标提交或运行平台不匹配。' >&2
  exit 1
}
node "$stage/scripts/release-artifact.mjs" --verify-linux "$stage" "$commit"
test -f "$stage/apps/web/dist/index.html"
test -d "$stage/node_modules"
test -f "$stage/packages/web-core/dist/index.js"
test ! -e "$stage/storage"
if find "$stage/apps/web/dist" -type f -name '*.map' -print -quit | grep -q .; then
  echo '发布包包含 Source Map。' >&2
  exit 1
fi

exec 9>"$root/.deploy.lock"
flock -n 9 || { echo '已有发布正在进行。' >&2; exit 1; }
[[ "$(git -C "$root" branch --show-current)" == main ]] || {
  echo '服务器源码目录必须位于 main 分支。' >&2
  exit 1
}
[[ -z "$(git -C "$root" status --porcelain --untracked-files=no)" ]] || {
  echo '服务器存在未提交的源码更改，发布已停止。' >&2
  exit 1
}
for name in knowra-api knowra-web; do
  pm2 describe "$name" >/dev/null || { echo "未找到生产进程：$name" >&2; exit 1; }
done

# SSH 非交互会话不一定继承 PM2 进程的环境；拒绝会改变端口或存储模式的切换。
runtime="$(pm2 jlist | node -e '
let input = "";
process.stdin.on("data", chunk => input += chunk).on("end", () => {
  const apps = JSON.parse(input);
  const api = apps.find(app => app.name === "knowra-api");
  const web = apps.find(app => app.name === "knowra-web");
  if (!api || !web || api.pm2_env?.status !== "online" || web.pm2_env?.status !== "online") process.exit(1);
  const env = api.pm2_env;
  if (env.STORAGE_UPLOADS_DIR) process.exit(1);
  process.stdout.write(`${env.PERSISTENCE_DRIVER || "local-json"}:${env.PORT}:${web.pm2_env.PORT}`);
})' )" || {
  echo '无法确认 PM2 运行环境，或附件目录使用了非默认路径。' >&2
  exit 1
}
[[ "$runtime" == "${PERSISTENCE_DRIVER:-local-json}:${KNOWRA_API_PORT:-3001}:${KNOWRA_WEB_PORT:-3000}" ]] || {
  echo 'SSH 会话的存储模式或端口与当前 PM2 进程不一致，发布已停止。' >&2
  exit 1
}

git -C "$root" fetch origin main
[[ "$(git -C "$root" rev-parse FETCH_HEAD)" == "$commit" ]] || {
  echo 'CI 发布包不对应当前 GitHub main，发布已停止。' >&2
  exit 1
}
old_commit="$(git -C "$root" rev-parse HEAD)"
git -C "$root" merge-base --is-ancestor "$old_commit" "$commit" || {
  echo '服务器源码无法快进到目标提交。' >&2
  exit 1
}

driver="${PERSISTENCE_DRIVER:-local-json}"
[[ "$driver" == local-json ]] || {
  echo 'PostgreSQL 发布须先加入数据库备份与迁移门禁；此脚本当前只支持 local-json。' >&2
  exit 1
}
current_link="$root/current"
[[ ! -e "$current_link" || -L "$current_link" ]] || {
  echo 'current 已存在且不是符号链接。' >&2
  exit 1
}
previous_release="$root"
if [[ -L "$current_link" ]]; then
  previous_release="$(realpath -e "$current_link")"
fi

# 按当前 PM2 进程确认上一版入口，兼容上一版 web-v4、web-v5 与现役 web 发布。
previous_web_dir="$(pm2 jlist | node -e '
const fs = require("node:fs");
const path = require("node:path");
let input = "";
process.stdin.on("data", chunk => input += chunk).on("end", () => {
  const root = fs.realpathSync(process.argv[1]);
  const env = JSON.parse(input).find(item => item.name === "knowra-web")?.pm2_env;
  if (!env || fs.realpathSync(env.pm_cwd) !== root) process.exit(1);
  const actual = fs.realpathSync(env.pm_exec_path);
  const dir = ["web", "web-v5", "web-v4"].find(name => {
    const entry = path.join(root, "apps", name, "server.mjs");
    return fs.existsSync(entry) && fs.realpathSync(entry) === actual;
  });
  if (!dir) process.exit(1);
  process.stdout.write(dir);
})' "$previous_release")" || {
  echo '无法确认上一版本的前端入口，发布已停止。' >&2
  exit 1
}

# 已打开的旧页面可能继续请求旧版哈希资源；沿用上一运行版本的资源文件。
if [[ -d "$previous_release/apps/$previous_web_dir/dist/assets" ]]; then
  mkdir -p "$stage/apps/web/dist/assets"
  cp -an "$previous_release/apps/$previous_web_dir/dist/assets/." "$stage/apps/web/dist/assets/"
fi
if find "$stage/apps/web/dist" -type f -name '*.map' -print -quit | grep -q .; then
  echo '候选目录包含 Source Map。' >&2
  exit 1
fi

release_dir="$root/.deploy-releases/$(basename "$(dirname "$stage")")"
[[ ! -e "$release_dir" ]] || { echo '同名发布目录已经存在。' >&2; exit 1; }
backup_root="${KNOWRA_DEPLOY_BACKUP_ROOT:-/opt/knowra-backups}"
mkdir -p "$root/.deploy-releases" "$backup_root"
backup_dir="$(mktemp -d "$backup_root/ci-release-XXXXXXXX")"
printf '%s\n' "$old_commit" > "$backup_dir/previous-commit.txt"
tar -C "$root" -czf "$backup_dir/storage.tar.gz" storage/data storage/uploads

echo '校验当前服务器附件...'
(
  cd "$root"
  # 首次发布也使用候选包的轻量检查器；旧运行版本可能还没有这个参数。
  node "$stage/scripts/check-attachments.mjs" --driver local-json --attachments-only --report "$backup_dir/attachments-before.json" >/dev/null
)

ln -s "$root/storage" "$stage/storage"
echo '校验新版本读取当前服务器附件...'
(
  cd "$stage"
  node scripts/check-attachments.mjs --driver local-json --attachments-only --report "$backup_dir/attachments-candidate.json" >/dev/null
)
mv -- "$stage" "$release_dir"

activated=0
switch_pm2() {
  local target="$1"
  # startOrReload 不会更新已有进程的 pm_exec_path/cwd；先移除旧定义再从目标目录启动。
  pm2 delete knowra-api knowra-web >/dev/null 2>&1 || true
  pm2 start "$target/deploy/ecosystem.config.cjs" --update-env
}
verify_pm2_release() {
  pm2 jlist | node -e '
const fs = require("node:fs");
const path = require("node:path");
let input = "";
process.stdin.on("data", chunk => input += chunk).on("end", () => {
  const target = fs.realpathSync(process.argv[1]);
  const webDir = process.argv[2];
  if (!["web", "web-v5", "web-v4"].includes(webDir)) process.exit(1);
  const apps = JSON.parse(input);
  for (const [name, script] of [["knowra-api", "apps/api/src/main.js"], ["knowra-web", `apps/${webDir}/server.mjs`]]) {
    const app = apps.find(item => item.name === name);
    const env = app?.pm2_env;
    if (!env || env.status !== "online" || fs.realpathSync(env.pm_cwd) !== target || fs.realpathSync(env.pm_exec_path) !== path.join(target, script)) process.exit(1);
  }
})' "$1" "$2"
}
rollback() {
  local result=$?
  local rollback_failed=0
  trap - EXIT
  if [[ "$activated" == 1 ]]; then
    echo '发布失败，恢复上一版本...' >&2
    if [[ "$(git -C "$root" rev-parse HEAD)" != "$old_commit" ]]; then
      git -C "$root" reset --hard "$old_commit" >&2 || rollback_failed=1
    fi
    if [[ "$previous_release" == "$root" ]]; then
      rm -f -- "$current_link" || rollback_failed=1
    else
      ln -s "$previous_release" "$current_link.rollback.$$" || rollback_failed=1
      mv -Tf -- "$current_link.rollback.$$" "$current_link" || rollback_failed=1
    fi
    switch_pm2 "$previous_release" >&2 || rollback_failed=1
    verify_pm2_release "$previous_release" "$previous_web_dir" >&2 || rollback_failed=1
    pm2 save >&2 || rollback_failed=1
    if [[ "$rollback_failed" == 1 ]]; then
      echo '自动恢复未完成，请立即检查 PM2、current 与 Git HEAD。' >&2
    fi
  fi
  exit "$result"
}
trap rollback EXIT

ln -s "$release_dir" "$current_link.next.$$"
mv -Tf -- "$current_link.next.$$" "$current_link"
activated=1
switch_pm2 "$release_dir"
verify_pm2_release "$release_dir" web || {
  echo 'PM2 仍指向旧运行目录，发布已停止。' >&2
  exit 1
}

api_port="${KNOWRA_API_PORT:-3001}"
web_port="${KNOWRA_WEB_PORT:-3000}"
healthy=0
# 大资料库启动需要完成历史引用校验；保留有界等待，避免就绪前误回滚。
for _ in {1..120}; do
  if curl -fsS --max-time 2 "http://127.0.0.1:$api_port/api/health" >/dev/null \
    && curl -fsSI --max-time 2 "http://127.0.0.1:$web_port/" >/dev/null; then
    healthy=1
    break
  fi
  sleep 1
done
[[ "$healthy" == 1 ]] || { echo '新版本健康检查失败。' >&2; exit 1; }

# 旧备份任务通过 /opt/knowra 的 Git HEAD 记录版本；激活成功后同步这份记录。
git -C "$root" merge --ff-only "$commit"
pm2 save
activated=0
trap - EXIT
# 成功后只删除本次传输的两个已校验文件；发布目录和备份继续保留。
archive_name="knowra-release-$commit.tar.gz"
if [[ -f "$incoming_dir/$archive_name" && -f "$incoming_dir/$archive_name.sha256" ]]; then
  if ! rm -- "$incoming_dir/$archive_name" "$incoming_dir/$archive_name.sha256" || ! rmdir -- "$incoming_dir"; then
    echo "发布已成功，但传输目录清理失败：$incoming_dir" >&2
  fi
fi
echo "发布成功：${commit}；发布前备份：${backup_dir}"

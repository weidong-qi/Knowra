#!/usr/bin/env bash
# post-deploy.sh — 部署/拉取代码后构建 V4 并刷新正式进程

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

V4_DIST_DIR="${KNOWRA_V4_DIST_DIR:-apps/web/dist}"
if [[ "$V4_DIST_DIR" = /* ]]; then
  V4_DIST_ROOT="$V4_DIST_DIR"
else
  V4_DIST_ROOT="$ROOT_DIR/$V4_DIST_DIR"
fi
V4_BUILD_DIR="$(mktemp -d "${V4_DIST_ROOT}.staging.XXXXXX")"
ATTACHMENT_REPORT_DIR="${KNOWRA_DEPLOY_REPORT_DIR:-storage/exports/deploy-checks}"
ATTACHMENT_DRIVER="${PERSISTENCE_DRIVER:-local-json}"
ATTACHMENT_REPORT="$ATTACHMENT_REPORT_DIR/attachments-$(date +%Y%m%d-%H%M%S).json"

cleanup_build() {
  rm -rf -- "$V4_BUILD_DIR"
}

trap cleanup_build EXIT

mkdir -p "$ATTACHMENT_REPORT_DIR"
echo "▶ post-deploy: 只读检查服务器附件完整性..."
npm run check:attachments -- \
  --driver "$ATTACHMENT_DRIVER" \
  --report "$ATTACHMENT_REPORT"
echo "✓ post-deploy: 附件报告 $ATTACHMENT_REPORT"

echo "▶ post-deploy: 构建 V4 前端..."
KNOWRA_V4_OUT_DIR="$V4_BUILD_DIR" NODE_ENV=production npm run build:web
test -f "$V4_BUILD_DIR/index.html"
if find "$V4_BUILD_DIR" -type f -name '*.map' -print -quit | grep -q .; then
  printf '%s\n' '✗ post-deploy: V4 生产产物不应包含 Source Map' >&2
  exit 1
fi

publish_v4_file() {
  local source="$1"
  local destination="$2"
  local temporary="${destination}.tmp.$$"
  cp -- "$source" "$temporary"
  mv -f -- "$temporary" "$destination"
}

echo "▶ post-deploy: 原子发布 V4 资源并保留旧哈希资源..."
mkdir -p "$V4_DIST_ROOT/assets"
for source in "$V4_BUILD_DIR/assets"/*; do
  [ -f "$source" ] || continue
  case "$source" in
    *.map) continue ;;
  esac
  publish_v4_file "$source" "$V4_DIST_ROOT/assets/${source##*/}"
done

# 先发布非入口静态文件，最后替换 no-store 的 index.html，避免入口指向尚未写完的 chunk。
for source in "$V4_BUILD_DIR"/*; do
  name="${source##*/}"
  [ "$name" = 'assets' ] && continue
  [ "$name" = 'index.html' ] && continue
  [ -f "$source" ] || continue
  case "$name" in
    *.map) continue ;;
  esac
  publish_v4_file "$source" "$V4_DIST_ROOT/$name"
done
publish_v4_file "$V4_BUILD_DIR/index.html" "$V4_DIST_ROOT/index.html"

test -f "$V4_DIST_ROOT/index.html"
if find "$V4_DIST_ROOT" -type f -name '*.map' -print -quit | grep -q .; then
  printf '%s\n' '✗ post-deploy: V4 生产目录不应包含 Source Map' >&2
  exit 1
fi

# 如果用 PM2 管理进程，校验并重启正式服务（dev 模式无需）
if command -v pm2 >/dev/null 2>&1; then
  for process_name in knowra-api knowra-web; do
    if ! pm2 describe "$process_name" >/dev/null 2>&1; then
      printf '✗ post-deploy: 未找到 PM2 进程 %s\n' "$process_name" >&2
      exit 1
    fi
  done

  echo "▶ post-deploy: 将 PM2 入口刷新为 API + V4 Web..."
  pm2 startOrReload deploy/ecosystem.config.cjs --update-env
  pm2 save
fi

echo "✓ post-deploy: 完成"

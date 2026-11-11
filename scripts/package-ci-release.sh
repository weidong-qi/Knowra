#!/usr/bin/env bash
# 在 Linux CI 中生成与已验收提交一一对应的生产发布包。
set -Eeuo pipefail

if [[ $# -ne 2 || ! "$1" =~ ^[0-9a-f]{40}$ ]]; then
  echo '用法：package-ci-release.sh <40位提交SHA> <输出目录>' >&2
  exit 2
fi

commit="$1"
output_dir="$2"
root="$(git rev-parse --show-toplevel)"

[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || {
  echo '生产依赖必须在 Linux x86_64 构建。' >&2
  exit 1
}
[[ "$(git -C "$root" rev-parse HEAD)" == "$commit" ]] || {
  echo '发布提交与当前检出的提交不一致。' >&2
  exit 1
}
test -f "$root/apps/web/dist/index.html"
node "$root/scripts/release-artifact.mjs" --verify-web "$root" "$commit"
test -f "$root/packages/web-core/dist/index.js"
test -f "$root/packages/shared/src/attachments.js"
test -f "$root/packages/shared/src/attachments.d.ts"
if find "$root/apps/web/dist" -type f -name '*.map' -print -quit | grep -q .; then
  echo '生产前端产物包含 Source Map。' >&2
  exit 1
fi

stage="$(mktemp -d)"
trap 'rm -rf -- "$stage"' EXIT
git -C "$root" archive "$commit" | tar -xf - -C "$stage"
mkdir -p "$stage/apps/web/dist" "$stage/packages/web-core/dist"
cp -a "$root/apps/web/dist/." "$stage/apps/web/dist/"
cp -a "$root/packages/web-core/dist/." "$stage/packages/web-core/dist/"

# 全新安装 Linux 生产依赖；不把 CI 的测试依赖或 Mac 原生模块放入发布包。
(
  cd "$stage"
  npm ci --omit=dev --ignore-scripts
  node --input-type=module -e "await import('@study-accelerator/shared/attachments'); await import('./apps/api/src/app.factory.ts'); await import('./apps/web/server/app.mjs')"
)

node "$stage/scripts/release-artifact.mjs" --write-linux "$stage" "$commit"
mkdir -p "$output_dir"
archive="$output_dir/knowra-release-$commit.tar.gz"
tar -C "$stage" -czf "$archive.tmp" .
mv -f -- "$archive.tmp" "$archive"
(
  cd "$output_dir"
  sha256sum "${archive##*/}" > "${archive##*/}.sha256"
)
echo "已生成发布包：$archive"

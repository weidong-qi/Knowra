#!/bin/zsh -l
cd "${0:A:h}" || exit 1
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo "需要 Node.js 24 或更新版本，以及 npm。"
  read "?按回车键退出…"
  exit 1
fi
exec npm run dev

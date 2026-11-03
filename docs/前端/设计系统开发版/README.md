# 知境 Knowra 设计系统 · 本地开发版

这份工程用于在本地浏览、修改和构建设计系统。原始主题数据、组件演示、运行包和资源保存在 `project/`；本地预览外壳是新建的。原版备份及开发版完整快照继续保存在仓库外的原备份目录。

开发版当前仅保留“现橙·浅色”和“现橙·深色”。原版备份与已有完整快照保留初始内容，开发版的修改独立生效。

## 启动

双击本目录的 `启动本地开发版.command`，或在当前目录执行：

```sh
npm run dev
```

首次重新安装依赖时执行 `npm ci`。依赖已经安装，日常启动不需要联网。服务只监听 `127.0.0.1`，端口自动选择，以终端输出的地址为准。可用 `KNOWRA_DESIGN_PORT` 指定端口。

## 修改位置

| 内容                                                   | 源文件                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| 颜色、现橙浅色、深色主题、字体、间距、圆角、尺寸、阴影 | `project/tokens.json`                                      |
| 原始总说明                                             | `project/README.md`                                        |
| 组件演示 HTML 与使用说明                               | `project/components/<组件名>/preview.html`、`README.md`    |
| 已构建的组件运行包、样式、类型                         | `project/components/bundle.js`、`bundle.css`、`index.d.ts` |
| 品牌与图标                                             | `project/assets/`                                          |
| 本地预览外壳                                           | `viewer.js`、`viewer.css`、`index.html`                    |

修改 `project/`、`viewer.js` 或 `viewer.css` 后，开发服务器会刷新页面。修改开发服务器本身后需要重新启动。

原始组件包基于 React 18 的浏览器全局变量，本地运行时沿用 React 18.3.1。原始 `preview.html` 依赖 Claude 自动注入的运行环境，直接打开原文件不能运行；本地服务器和构建脚本会为 `/previews/<组件名>.html` 注入本地 React、ReactDOM、组件包和主题样式，原文件不需要改写。

`project/` 与原始 ZIP 一样共有133个文件，其中84个是 SVG。Claude 界面显示的 `manifest.json` 是运行时生成的目录；服务端源文件对应 `project/design-system.json`。本地预览使用界面导出的目录快照 `catalog.json`；新增组件时也需要更新其中的 `components` 列表。

`bundle.js` 是已经编译的组件代码，原 Artifact 不包含其完整 TypeScript 源码工程。若要从当前 Knowra 产品组件重新构建，需要另行建立源代码同步流程；此副本不会自动写回 Claude 或产品仓库。

## 构建与备份核验

```sh
npm run build
npm run verify:backup
```

`dist/` 包含可通过普通 HTTP 服务预览的静态文件和本地依赖，不需要 Claude 登录。`verify:backup` 核对原版备份的文件长度和 SHA-256。对开发版的修改不会影响原版备份。

本机的备份路径保存在 `.backup-location.json` 的 `backupDirectory` 中；此文件已加入 Git 忽略。也可以用 `KNOWRA_DESIGN_BACKUP_DIR` 指定备份目录。未设置时，校验脚本沿用上一级 `原版备份/` 的布局，兼容先前保存的完整快照。启动脚本、依赖和静态构建产物均随开发版迁移，原位置的启动脚本会转到本目录。

原 Artifact 的官方编辑器、评论、云端存储、分享权限和历史版本属于 Claude 平台；本地工程保留设计内容与组件预览，不包含这些平台服务。

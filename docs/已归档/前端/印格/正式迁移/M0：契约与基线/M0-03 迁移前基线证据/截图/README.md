# M0 迁移前验收证据

本目录保存 M0-03 在正式 API/Web 运行态下采集的基线截图。完整的运行态、数据状态、控制台记录、视口说明和已知差异见 [M0-03 迁移前基线报告](<../M0-03 迁移前基线报告.md>)。

## 证据分组

### 2048×1024

- `m0-03-2048-home-default-library.jpg`：默认入口（当前正式实现为资料索引）
- `m0-03-2048-library-index.jpg`：资料索引
- `m0-03-2048-editor-both-sidebars.jpg`：编辑器双侧栏
- `m0-03-2048-editor-no-right-sidebar.jpg`：仅目录栏
- `m0-03-2048-editor-only-right-sidebar.jpg`：仅边注栏
- `m0-03-2048-editor-no-sidebars.jpg`：无侧栏
- `m0-03-2048-knowledge-overview.jpg`：知识工作域
- `m0-03-2048-training-overview.jpg`：训练工作域

### 1440×1024

- `m0-03-1440-home-default-library.jpg`
- `m0-03-1440-library-index.jpg`
- `m0-03-1440-editor-both-sidebars.jpg`
- `m0-03-1440-knowledge-overview.jpg`
- `m0-03-1440-training-overview.jpg`

### 1280×720

- `m0-03-1280-home-default-library.jpg`
- `m0-03-1280-library-index.jpg`
- `m0-03-1280-editor-compact-both-sidebars.jpg`
- `m0-03-1280-knowledge-overview.jpg`
- `m0-03-1280-training-overview.jpg`

### 1024×768 补充

- `m0-03-1024-home-default-library.jpg`
- `m0-03-1024-library-index.jpg`
- `m0-03-1024-editor-overlay-panel.jpg`

## 采集约束

- 运行于 `http://localhost:3000/`，API 为 `http://localhost:3001/`。
- 每张图对应一次页面状态采集；截图之外的结构化记录已写入报告。
- 文件名中的 `home-default-library` 明确表示当前没有独立正式首页，避免与资料索引状态混淆。

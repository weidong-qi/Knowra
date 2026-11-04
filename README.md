<div align="center">

<img src="apps/web/src/assets/knowra-brand-mark.svg" width="96" height="96" alt="知境 Knowra 标志">

# 知境 · Knowra

**本地优先的个人学习工作台 —— 把资料沉淀为可追溯的知识，再把知识转化为可检验的能力。**

[![CI](https://github.com/1848956505/Knowra/actions/workflows/ci.yml/badge.svg)](https://github.com/1848956505/Knowra/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2024-339933?logo=nodedotjs&logoColor=white)
![React](https://img.shields.io/badge/React-TypeScript-3178C6?logo=react&logoColor=white)
![Platform](https://img.shields.io/badge/平台-Web%20%7C%20macOS%20%7C%20Android%20预览-1368F8)
![Local first](https://img.shields.io/badge/数据-本地优先-0755E8)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue)](LICENSE)

[核心能力](#核心能力) · [运行形态](#运行形态) · [快速开始](#快速开始) · [架构](#架构) · [文档](#文档) · [路线图](#路线图)

</div>

---

## 简介

知境（Knowra）是一款面向长期学习者的知识工作台。它不只是笔记软件：资料、知识、试题与学习记录是四个彼此连通的工作域，每一条知识都能回到原文出处，每一道题目都能对应到学习目标。

- **资料** —— 目录化的 Markdown 笔记、附件、重点标记与不可变版本。
- **知识** —— 从资料中提炼知识候选，经人工确认后成为带证据的知识条目。
- **试题** —— 学习目标、考试配置、考点与题目资产的统一管理。
- **学习档案** —— 掌握度、薄弱点与复习计划（规划中，待学习证据模型完成后开放）。

AI、检索与知识图谱是贯穿各工作域的横向能力，而不是独立的孤岛。AI 默认可关闭、可替换，任何 AI 产出都需要你确认后才会写入资料。

<p align="center">
  <img src="docs/readme/notes-index.webp" alt="知境资料工作区：左侧目录树与快速入口，右侧以卡片展示文件夹和最近笔记">
</p>

<p align="center">
  <img src="docs/readme/note-editor.webp" alt="知境笔记编辑器：标签页、面包屑、标题与 Markdown 格式工具栏">
</p>

## 核心能力

### 📝 资料工作区

- **所见即所得的 Markdown 编辑器**：基于 Milkdown，支持源码模式、表格、数学公式、图片、代码块、查找替换与 Markdown 导入。
- **结构化组织**：目录树拖拽整理、标签串联主题、笔记双链、知识空间划分。
- **重点标记**：把重要内容直接标进正文，随编辑自动跟随，并可作为知识提炼的来源。
- **版本与恢复**：每次保存形成不可变版本；回收站支持恢复，编辑草稿在异常退出后可找回。
- **检查器面板**：大纲、标注、记录与 AI 面板常驻侧边，随正文同步。
- **全局搜索**：⌘K 命令面板，直达笔记正文、标签与操作。

### 🧠 知识库

- **候选 → 确认** 的知识闭环：知识先以候选形式出现，经你审阅确认后才成为正式知识。
- **来源可追溯**：每条知识绑定原文证据，可对比来源；来源全部失效时，已确认知识会自动转为待修订。
- **学习目标**：知识可关联可度量的学习目标，为出题与复习提供依据。
- **概念图**：以图谱视角浏览知识之间的关系。

### 🎯 试题库

- 管理学习目标、考试配置（ExamProfile）与考点（ExamFocus）。
- 手工编写题目资产，一道题可绑定多个学习目标，并保留题目来源对照。
- 正式考卷、作答与批改正在设计中（见[路线图](#路线图)）。

### ✨ AI 助手

- **多轮对话 Agent**：在你授权的资料范围内自动检索与阅读，回答附带逐字校验的引用。
- **成果收件箱**：AI 新建或改写笔记的结果先进入收件箱，由你审阅后再采纳，不直接覆盖原文。
- **成本可控**：逐请求发送清单、可撤销的范围授权与每日预算硬上限。
- **可替换的模型接入**：统一适配层，当前接入 DeepSeek，可在设置中配置凭据。

### 🤝 Agent 协作

- **本机 MCP 服务**：Claude Code、Codex 等外部 AI 客户端可通过 stdio MCP 只读访问笔记，并提交待审核的知识候选。
- **任务工作区**：发布协作文档与任务，外部 Agent 经单独配对许可领取、执行并提交，由你进行人工验收。

### 🔒 离线、同步与数据安全

- **离线优先**：桌面端以 SQLite 保存全部资料，断网也能完整编辑，联网后双向同步，并提供冲突处理。
- **完整备份**：一键导出 / 导入完整备份（笔记、附件、待同步修改与恢复草稿），恢复前自动创建保护备份。
- **可靠写入**：JSON 原子替换与引用校验；附件带 SHA-256 完整性元数据与修复检查；缓存恢复期间启用只读保护。
- **可选数据库**：默认使用本地 JSON，可显式切换到 PostgreSQL，失败时不会静默回退。

## 运行形态

| 形态 | 说明 | 状态 |
| --- | --- | --- |
| **Web** | 浏览器访问，Node 服务提供同源 `/api` | 可用 |
| **macOS 桌面应用** | Electron 外壳 + 本机 SQLite，离线编辑、云端同步、完整备份 | Apple Silicon 个人构建（ad-hoc 签名，未公证） |
| **服务器部署** | Linux + Nginx + PM2，可选 PostgreSQL | 可用；公开部署须启用 Nginx Basic Auth |
| **Android** | 通过系统浏览器安全标签页打开你自己的知境服务 | 在线启动器预览，未签名 |


## 快速开始

**环境要求**：Node.js ≥ 24，npm ≥ 11。支持 macOS、Windows 与 Linux。

```bash
git clone https://github.com/1848956505/Knowra.git
cd Knowra
npm install
npm run dev:all
```

`dev:all` 会同时启动 API 与 V4 前端，并自动选择可用端口（不假定 3000/3001），终端会输出访问地址。

### 常用命令

| 用途 | 命令 |
| --- | --- |
| 同时启动 API + 前端 | `npm run dev:all` |
| 单独启动 API / 前端 | `npm run dev:api` / `npm run dev:web` |
| 构建前端 / 生产启动 | `npm run build:web` / `npm run start:web` |
| 本地离线运行（先构建前端） | `npm run start:desktop` |
| 构建 Mac 应用（仅构建，不安装） | `npm run build:mac` |
| 核验 / 安装 Mac 应用 | `npm run verify:mac` / `npm run install:mac` |
| 前端类型、架构边界与测试 | `npm run check:web:v4` |
| 全部测试 | `npm test` |

### 使用 PostgreSQL（可选）

```bash
export PERSISTENCE_DRIVER=postgres
export DATABASE_URL=postgresql://user:pass@localhost:5432/knowra
npm run prisma:migrate:deploy
```

从本地 JSON 迁移数据可使用 `npm run migrate:postgres`，默认为演练模式（dry-run），缺失附件时会阻止迁移。

## 架构

```mermaid
flowchart LR
  subgraph Client["客户端"]
    Web["V4 Web<br/>React · TypeScript · Vite"]
    Mac["macOS 桌面<br/>Electron + SQLite"]
    Android["Android 启动器"]
  end
  subgraph Server["服务端"]
    API["API<br/>node:http · 路由 → 应用服务 → Repository"]
    JSON[("本地 JSON<br/>默认")]
    PG[("PostgreSQL<br/>可选")]
  end
  Agents["外部 Agent<br/>Claude Code · Codex"]
  LLM["模型服务<br/>DeepSeek"]

  Web -- "同源 /api" --> API
  Android -- "系统浏览器" --> Web
  Mac -- "双向同步" --> API
  Agents -- "MCP" --> Mac
  API --> JSON
  API --> PG
  API -. "授权范围内调用" .-> LLM
```

### 技术栈

- **前端**：React、TypeScript、Vite、Zustand、CSS Modules、react-aria-components、Milkdown
- **服务端**：Node.js（`node:http`）、Prisma、PostgreSQL / 本地 JSON
- **桌面**：Electron、SQLite
- **测试**：Vitest、node:test、Playwright

### 项目结构

```text
Knowra/
├─ apps/
│  ├─ web/            # 当前唯一可启动的前端（React + TypeScript）
│  ├─ api/               # API 服务
│  ├─ desktop-runtime/   # 桌面本地运行时：SQLite、同步引擎、MCP
│  ├─ desktop-shell/     # macOS 桌面外壳（Electron）
│  ├─ android/           # Android 在线启动器
│  └─ web/               # V3 历史源码，仅保留回归测试
├─ packages/
│  ├─ web-core/          # 与框架无关的共享 API 与状态逻辑
│  ├─ content-anchor/    # 正文锚点与来源投影
│  └─ shared/            # 通用共享工具
├─ prisma/               # PostgreSQL schema 与迁移
├─ deploy/               # 可公开的生产部署模板
├─ scripts/              # 开发、构建与迁移脚本
└─ docs/                 # 产品、领域与工程文档
```

> 工作区内部包名沿用早期代号 `study-accelerator`。

## 文档

| 文档 | 内容 |
| --- | --- |
| [领域冻结稿](docs/知识库与试题模块/基础/Knowra%20知识与考卷系统领域冻结稿.md) | 知识与考卷系统的当前领域基准 |
| [资产生命周期规范](docs/Knowra_资产生命周期规范_v1.0.md) | 删除、归档、恢复与清理规则 |
| [AI 功能开发工作区](docs/AI功能/README.md) | AI 总体方案、权限契约与各阶段验收 |
| [Agent 知识提议与 MCP](docs/AI功能/p3/AI-03-07-Agent知识提议与MCP方案.md) | 本机 MCP 的设计与实现 |
| [任务工作区](docs/任务工作区V1.md) | 任务协作的数据边界与接口 |
| [Mac 应用构建与使用](docs/离线编辑与同步/Mac个人应用-构建与使用.md) | 桌面应用构建、备份、恢复与升级 |
| [生产部署](deploy/README.md) | Nginx、Basic Auth 与发布流程 |
| [Android 在线预览](docs/Android/在线预览版.md) | Android 启动器的范围与安全边界 |
| [开发规范](docs/开发规范.md) · [项目结构导航](docs/项目结构导航.md) · [工程变更日志](docs/工程变更日志.md) | 参与开发前建议阅读 |

## 路线图

- [x] 资料工作区：笔记、目录、标签、附件、重点标记、版本与回收站
- [x] 知识库：候选确认闭环、来源证据、学习目标、概念图
- [x] 试题库：考试配置、考点与题目资产
- [x] AI 助手：授权检索、引用校验、成果收件箱与预算控制
- [x] macOS 桌面：离线编辑、双向同步、完整备份与恢复
- [x] 本机 MCP 与任务工作区
- [ ] 正式考卷、作答与批改（基于不可变题目快照）
- [ ] 学习证据、掌握度与学习档案
- [ ] 执行模块：待办、打卡与习惯追踪
- [ ] 正式登录与多端身份认证
- [ ] Developer ID 签名与公证的 macOS 正式发布

## 参与开发

提交改动前请阅读[开发规范](docs/开发规范.md)与根目录 [AGENTS.md](AGENTS.md)，并按改动范围运行对应检查（如 `npm run check:web:v4`、`npm run test:api`）。结构性变更请记入[工程变更日志](docs/工程变更日志.md)。

## 许可证

知境以 [GNU Affero 通用公共许可证 v3.0](LICENSE)（AGPL-3.0-only）开源。你可以自由使用、修改和分发；若分发修改版本，或将修改版本作为网络服务提供给他人使用，须以相同许可证公开对应源代码。

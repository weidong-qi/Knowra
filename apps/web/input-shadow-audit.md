# V4 输入框阴影状态审计

日期：2026-08-23
范围：`TextField`、`SearchField`、`Select`、全局 `SearchCommand`，以及 `/materials` 的笔记索引搜索框和上下文侧栏搜索框。
参考问题截图：`C:/Users/DELL/AppData/Local/Temp/codex-clipboard-f1b5ee5e-32e5-4461-b643-ee989b7b9338.png`

## 结论

代码与自动化验证通过；应用内 Browser 视觉 QA **blocked**。本次修复没有生成未经运行态确认的截图，也没有用 Chrome 或 Playwright CLI 替代应用内 Browser。

## 根因

此前全局 `:where(input, select, textarea):focus-visible` 和输入组件局部规则都直接给原生控件写入 `box-shadow`；`NotesIndexView`、`NotesContextSidebar`、`SearchCommand` 又在外层搜索容器上绘制焦点影，造成阴影所有权分裂。旧 `--shadow-input-focus` 还是黑色，无法表达冻结契约中的焦点蓝色。

## 代码审计

- `--shadow-input-rest`：2px 2px 0 `var(--ink)`，默认黑色硬影。
- `--shadow-input-focus`：3px 3px 0 `var(--ink-accent)`，外壳 `:focus-within` / Select focus。
- `--shadow-input-invalid`：3px 3px 0 `var(--ink-danger)`，invalid + focused 时保持红色优先。
- TextField 的 `.inputShell`、SearchField 的 `.searchShell`、Select 的触发器和三处业务搜索外壳是唯一阴影所有者。
- 原生 `input` / `textarea` / `select` 的全局 focus-visible 阴影清零；输入控件局部 `.input` 也显式 `box-shadow: none`。
- 既有 checkbox/button disabled 规则未改动；Select disabled 仍无影。

## 自动化证据

- `npm run typecheck -w @study-accelerator/web-v4`：passed
- `npm run test -w @study-accelerator/web-v4`：passed，17 files / 93 tests
- `npm run check:boundaries -w @study-accelerator/web-v4`：passed
- `npm run build -w @study-accelerator/web-v4`：passed
- RTL 新增断言：外壳 `data-input-shadow-owner` 与原生控件 `data-input-control` 分离；invalid 字段聚焦后仍保留 invalid 语义；Select invalid 触发器由外壳持有阴影。

## 视觉 QA 阻塞

任务要求使用 Codex 应用内 Browser 检查默认 / 聚焦 / 错误三态。当前 Browser 能力发现结果只有 Chrome 扩展，没有 `iab` 应用内 Browser；按约束未连接 Chrome、未使用 Playwright CLI，因此无法诚实提供运行态截图、控制台和像素级三态结论。

待 Browser 可用时，应在 `/showcase` 检查 TextField 默认 / focus / invalid+focus，以及 `/materials` 和侧栏搜索框的默认 / focus；同时确认原生 input 计算样式无阴影、外壳只有一层硬影。

最终结果：**blocked（仅视觉运行态 QA；代码与自动化门禁 passed）**。

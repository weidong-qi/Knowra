# V4 StatusBar 修复审查

日期：2026-08-22

## 修复结论

- `/materials` 的状态路径现在只由 pathname / surface 派生，固定为 `主页 / 笔记库`。
- workspace hydration 产生的 `selectedNoteId` / `selectedFolderId` 不再被误认为用户进入了详情页。
- `StatusBar` 的 context/path 可收缩并对长段使用 ellipsis；右侧数据模式和面板开关使用 `flex: 0 0 auto`，不参与挤压。
- 状态路径逻辑已从 `App.tsx` 抽到 `apps/web/src/shell/statusPath.ts`，并添加纯函数测试。

## 本次静态与自动化检查

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| `/materials` + latent selected note | passed | `App.test.tsx` 回归断言只出现“主页 / 笔记库”，不出现 `Note` / `M4-02`。 |
| 长 current label + 右侧控件 | passed | `StatusBar.test.tsx` 断言长标题、`数据模式：已同步`、侧栏/检查器切换按钮同时存在。 |
| 状态路径纯函数 | passed | `shell/statusPath.test.ts`。 |
| TypeScript | passed | `npm run typecheck -w @study-accelerator/web-v4`。 |
| Vitest | passed | 16 files / 83 tests。 |
| V4 boundary check | passed | `npm run check:boundaries -w @study-accelerator/web-v4`。 |
| Production build | passed | `npm run build -w @study-accelerator/web-v4`。 |

## 运行态审查范围

用户提供的 bug 截图已确认：状态栏原先被长笔记标题占满，右侧同步/面板状态不可见。
证据文件：`C:/Users/DELL/AppData/Local/Temp/codex-clipboard-2986579b-d626-47ee-9511-2d6997abc8fe.png`。

本轮应检查以下视口与状态：

- 1920×900：状态栏高度、左右内容、主区是否被遮挡、横向溢出、独立滚动、唯一 h1、console。
- 920×900：侧栏收起策略、状态栏右侧控件、焦点可见性和主区可达性。
- 390×844：移动底栏/状态栏、标题截断、最后一行内容是否可达、横向溢出。

## Browser blocker

本轮 Codex 内置 Browser 不可用；浏览器能力发现结果只有 Chrome extension。根据任务约束未使用 Chrome，也未使用 Playwright CLI 替代，因此没有伪造上述三档运行态截图或 console 结论。

## 审查步骤状态

1. 桌面 1920×900：代码/测试可验证，运行态截图 blocked。
2. 窄桌面 920×900：响应式规则已静态检查，运行态截图 blocked。
3. 移动 390×844：移动断点规则已静态检查，运行态截图 blocked。

此前 `apps/web/design-qa.md` 的历史 blocker 保持不变；本报告不将无法重捕的视觉验证标记为 passed。

final result: blocked

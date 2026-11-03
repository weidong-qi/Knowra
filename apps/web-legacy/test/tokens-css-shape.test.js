import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tokensPath = path.resolve(__dirname, '../styles/tokens.css');
const tokens = fs.readFileSync(tokensPath, 'utf8');

// 阶段 0 基线契约:在 UI 重构期间,以下"先存在"的 token 不能被悄悄移除。
// 阶段 1.1 完成后,本测试会扩展为"晨光纸笺完整版",新增更多 token 断言。
// 任何移除本列表中的 token,必须同步:
//   1) 更新 components.css 与所有 renderer 中的 var(--xxx) 引用
//   2) 更新 docs/项目结构导航.md 的样式章节
const baselineTokens = [
  // 字体
  '--font-body',
  '--font-display',
  // 旧版背景与面板(阶段 4 切换到纸面色阶后将被替换为 --color-paper-*)
  '--color-bg',
  '--color-panel',
  '--color-panel-solid',
  '--color-panel-strong',
  '--color-panel-muted',
  // 文本
  '--color-text',
  '--color-text-muted',
  '--color-text-soft',
  // 旧版蓝色强调(阶段 4 切换到 --color-accent-500 墨蓝)
  '--color-accent',
  '--color-accent-strong',
  '--color-accent-soft',
  // 状态色
  '--color-success',
  '--color-warning',
  '--color-danger',
  // 边框
  '--color-border',
  '--color-border-strong',
  // 阴影
  '--shadow-soft',
  '--shadow-float',
  // 圆角
  '--radius-xl',
  '--radius-lg',
  '--radius-md',
  '--radius-sm',
  // 间距
  '--space-1',
  '--space-2',
  '--space-3',
  '--space-4',
  '--space-5',
  '--space-6',
  '--space-8',
  '--space-10',
  // 布局常量
  '--rail-width',
  '--topbar-height',
  '--statusbar-height'
];

const missing = baselineTokens.filter((token) => !tokens.includes(`${token}:`));

assert.equal(
  missing.length,
  0,
  `tokens.css 缺少以下基线变量:\n  - ${missing.join('\n  - ')}\n请在 styles/tokens.css 内补充,或在评审后调整本测试。`
);

console.log(`ok - tokens.css 保留 ${baselineTokens.length} 个基线 design token(阶段 1.1 将扩展为晨光纸笺完整版)`);

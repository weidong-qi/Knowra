import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../../apps/web/src');
const paths = [
  'features/assistant/AIInbox.module.css',
  'features/assistant/AssistantView.module.css',
  'features/assistant/BudgetAlertBanner.module.css',
  'features/assistant/ConversationAttachmentPicker.module.css',
  'features/assistant/ConversationView.module.css',
  'features/assistant/NoteActions.module.css',
  'features/assistant/ReadableMarkdown.module.css',
  'features/settings/SettingsView.module.css',
  'features/spaces/SpaceManagerView.module.css',
  'views/HomeView.module.css'
];
for (const path of paths)
  test(`V5 AI/设置表面使用主题令牌：${path}`, () => {
    const css = readFileSync(resolve(root, path), 'utf8');
    assert.doesNotMatch(css, /#[\da-f]{3,8}\b|rgba?\(/i, '业务页面不内嵌主题颜色');
    assert.doesNotMatch(css, /box-shadow\s*:\s*\d+px\s+\d+px\s+0\s/, '不保留偏移硬阴影');
    assert.doesNotMatch(css, /var\(--ink(?:-|\))/, '本批样式使用明确语义令牌');
  });
test('Markdown 代码字体与危险预算提示保留内容语义', () => {
  const markdown = readFileSync(resolve(root, paths[6]), 'utf8');
  const budget = readFileSync(resolve(root, paths[2]), 'utf8');
  assert.match(markdown, /var\(--font-mono\)/);
  assert.match(budget, /var\(--color-danger\)/);
});

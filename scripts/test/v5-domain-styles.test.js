import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { tagColorStyle } from '../../apps/web/src/features/tags/tagColor.ts';

const root = resolve(import.meta.dirname, '../../apps/web/src');
const paths = [
  'features/knowledge/KnowledgeWorkspaceView.module.css',
  'features/knowledge/KnowledgeSourceComparisonDialog.module.css',
  'features/training/TrainingWorkspaceView.module.css',
  'features/training/QuestionDetailPanel.module.css',
  'features/tags/TagManagerView.module.css'
];
for (const path of paths)
  test(`V5 领域样式使用可定制语义表面：${path}`, () => {
    const css = readFileSync(resolve(root, path), 'utf8');
    assert.doesNotMatch(css, /#[\da-f]{3,8}\b|rgba?\(/i, '业务面板不内嵌主题颜色');
    assert.doesNotMatch(css, /box-shadow\s*:\s*\d+px\s+\d+px\s+0\s/, '不保留旧偏移硬阴影');
    assert.doesNotMatch(css, /--index-(?:blue|tile-shadow)/, '不依赖旧视觉别名');
    assert.match(css, /var\(--surface-/);
    assert.match(css, /var\(--text-/);
    assert.match(css, /var\(--radius-/);
  });
test('领域选择态无左侧强调条', () => {
  const knowledge = readFileSync(resolve(root, paths[0]), 'utf8');
  const training = readFileSync(resolve(root, paths[2]), 'utf8');
  for (const css of [knowledge, training]) {
    for (const [, selector, declarations] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/aria-current|\.selected\b/.test(selector)) assert.doesNotMatch(declarations, /border-left|inset/);
    }
  }
});
test('标签管理使用共享颜色映射，预设蓝色不跟随品牌色', () => {
  const tags = readFileSync(resolve(root, paths[4]), 'utf8');
  assert.match(tags, /\.color\s+i\s*\{[^}]*background:\s*var\(--tag-color\)/);
  assert.deepEqual(tagColorStyle('blue'), { '--tag-color': 'var(--color-info)' });
  assert.deepEqual(tagColorStyle('#3C68FF'), { '--tag-color': '#3c68ff' });
});

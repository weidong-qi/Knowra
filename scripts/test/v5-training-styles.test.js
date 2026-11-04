import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const workspace = readFileSync(
  resolve(import.meta.dirname, '../../apps/web/src/features/training/TrainingWorkspaceView.module.css'),
  'utf8'
);
const detail = readFileSync(
  resolve(import.meta.dirname, '../../apps/web/src/features/training/QuestionDetailPanel.module.css'),
  'utf8'
);

describe('训练模块 V5 样式约束', () => {
  it('业务样式只引用可替换的语义颜色，移除旧选中竖线和硬阴影', () => {
    for (const css of [workspace, detail]) {
      assert.doesNotMatch(
        css,
        /#[\da-f]{3,8}\b|var\(--ink(?:-|\))|var\(--index-|border-left|font-mono|text-transform:\s*uppercase/i
      );
      assert.ok(css.includes('var(--surface-page)'));
      assert.ok(css.includes('var(--border-subtle)'));
      assert.ok(css.includes('var(--radius-panel)'));
    }
    assert.ok(workspace.includes('var(--surface-selected)'));
    assert.ok(workspace.includes('var(--shadow-control)'));
  });

  it('保留移动端纵向检查器与来源对照，并对长文本和焦点提供样式', () => {
    assert.match(workspace, /@media\s*\(max-width:\s*760px\)/);
    assert.match(workspace, /\.questionLayout\s*\{[^}]*flex-direction:\s*column/);
    assert.match(workspace, /\.questionList\s*\{[^}]*max-height:\s*260px/);
    assert.match(workspace, /\.detailPanel\s*\{[^}]*overflow:\s*visible/);
    assert.match(workspace, /\.filterGroup\s*\{[^}]*flex-wrap:\s*wrap/);
    assert.match(detail, /@media\s*\(max-width:\s*560px\)/);
    assert.match(detail, /\.contentLink\s*\{[^}]*white-space:\s*normal/);
    assert.ok(detail.includes('overflow-wrap: anywhere'));
    assert.ok(detail.includes(':focus-visible'));
    assert.ok(detail.includes('var(--focus-ring)'));
  });
});

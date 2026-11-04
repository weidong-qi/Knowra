/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const tokens = readFileSync('src/styles/tokens.css', 'utf8');
const editorStyles = readFileSync('src/features/editor/MilkdownNoteEditor.module.css', 'utf8');

const headingRule = (level: number) => editorStyles.match(new RegExp(`\\.milkdownEditor :global\\(\\.ProseMirror\\) h${level} \\{([^}]+)\\}`))?.[1] ?? '';

describe('正文标题排版契约', () => {
  it('六级标题使用集中管理的相对字号，H4 大于正文、H5/H6 等于正文', () => {
    [2.25, 1.75, 1.5, 1.25, 1, 1].forEach((size, index) => {
      const level = index + 1;
      expect(tokens).toContain(`--note-heading-${level}-size: ${size}em;`);
      expect(headingRule(level)).toContain(`font-size: var(--note-heading-${level}-size);`);
      expect(headingRule(level)).toMatch(/font-weight: (600|700);/);
    });
  });
  it('H6 使用随明暗主题变化的次级文字色，内嵌加粗保持灰色', () => {
    expect(headingRule(6)).toContain('color: var(--text-secondary);');
    expect(editorStyles).toContain('h6 strong { color: inherit; }');
  });
  it('所有标题保留目录定位偏移，且不增加参考图中的底线', () => {
    expect(editorStyles).toContain(':is(h1, h2, h3, h4, h5, h6) { scroll-margin-top:');
    for (let level = 1; level <= 6; level++) expect(headingRule(level)).not.toMatch(/border|text-decoration/);
  });
});

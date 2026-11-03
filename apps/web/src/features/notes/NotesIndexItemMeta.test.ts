import { describe, expect, it } from 'vitest';
import type { Note } from '@study-accelerator/web-core';
import { notePreview } from './NotesIndexItemMeta';

const note = (summary: string) => ({ summary } as unknown as Note);

describe('notePreview 与公式', () => {
  it('公式里的下划线和星号不被当作 Markdown 标记吞掉', () => {
    expect(notePreview(note('## 推导\n设 $x_i * y_j$ 成立，**重点**'))).toBe('推导 设 $x_i * y_j$ 成立，重点');
  });

  it('块公式在预览里折成一行行内公式', () => {
    expect(notePreview(note('前文\n$$\n\\frac{a}{b}\n$$\n后文'))).toBe('前文 $\\frac{a}{b}$ 后文');
  });

  it('截断时不会把公式从中间切开', () => {
    const text = `${'字'.repeat(195)}$\\frac{a}{b}$ 之后`;
    const result = notePreview(note(text));
    expect(result).toBe('字'.repeat(195));
  });

  it('金额保持原文', () => {
    expect(notePreview(note('价格 $5 和 $10'))).toBe('价格 $5 和 $10');
  });
});

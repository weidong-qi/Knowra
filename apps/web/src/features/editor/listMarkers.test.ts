/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const styles = readFileSync('src/features/editor/MilkdownNoteEditor.module.css', 'utf8');
const item = "ul > li:not([data-item-type='task'])::before";
const rule = (selector: string) => styles.split(`.milkdownEditor :global(.ProseMirror) ${selector} {`)[1]?.split('}')[0] ?? '';

describe('无序列表层级标记契约', () => {
  it('保留自绘实心圆，二级空心圆，三级及更深实心方块', () => {
    expect(rule(item)).toContain('border-radius: 50%;');
    expect(rule(item)).toContain('background: var(--accent);');
    expect(rule(`:is(ul, ol) ${item}`)).toContain('border: 1px solid var(--accent);');
    expect(rule(`:is(ul, ol) ${item}`)).toContain('background: transparent;');
    expect(rule(`:is(ul, ol) ${item}`)).toContain('box-sizing: border-box;');
    expect(rule(`:is(ul, ol) :is(ul, ol) ${item}`)).toContain('border-radius: 0;');
    expect(rule(`:is(ul, ol) :is(ul, ol) ${item}`)).toContain('border: 0;');
    expect(rule(`:is(ul, ol) :is(ul, ol) ${item}`)).toContain('background: var(--accent);');
  });
  it('混合有序列表计入视觉深度，且层级选择器不匹配编号或任务项', () => {
    document.body.innerHTML = '<ol><li><ul><li id="second"><ol><li id="ordered"><ul><li id="fourth"></li><li id="task" data-item-type="task"></li></ul></li></ol></li></ul></li></ol>';
    const second = `:is(ul, ol) ${item.replace('::before', '')}`;
    const deeper = `:is(ul, ol) ${second}`;
    expect(document.querySelector('#second')!.matches(second)).toBe(true);
    expect(document.querySelector('#second')!.matches(deeper)).toBe(false);
    expect(document.querySelector('#fourth')!.matches(deeper)).toBe(true);
    for (const id of ['ordered', 'task']) {
      expect(document.querySelector(`#${id}`)!.matches(second)).toBe(false);
      expect(document.querySelector(`#${id}`)!.matches(deeper)).toBe(false);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { renderMath } from './editorMathRender';

describe('公式渲染安全边界', () => {
  it('拒绝 LaTeX 外链及 HTML 注入，错误仅作为纯文本展示', () => {
    const target = document.createElement('div');
    renderMath(target, '\\href{javascript:alert(1)}{点我}');
    expect(target.querySelector('a')).toBeNull();
    renderMath(target, '\\htmlClass{injected}{x}');
    expect(target.querySelector('.injected')).toBeNull();
    renderMath(target, '\\bad{<img src=x onerror=alert(1)>}');
    expect(target.classList.contains('math-error')).toBe(true);
    expect(target.querySelector('img')).toBeNull();
  });

  it('限制用户指定的巨大尺寸及递归宏，错误后仍可恢复', () => {
    const target = document.createElement('div');
    renderMath(target, '\\rule{100000em}{100000em}');
    expect(target.querySelector('.katex-html')?.innerHTML).not.toContain('100000em');
    expect(target.innerHTML).toContain('20em');
    renderMath(target, '\\def\\a{\\a}\\a');
    expect(target.classList.contains('math-error')).toBe(true);
    renderMath(target, 'x');
    expect(target.classList.contains('math-error')).toBe(false);
    expect(target.querySelector('.katex')).not.toBeNull();
    renderMath(target, ' ');
    expect(target.dataset.empty).toBe('');
    expect(target.textContent).toBe('');
  });
});

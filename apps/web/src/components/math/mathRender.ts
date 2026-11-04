import katex from 'katex';
import 'katex/dist/katex.min.css';

/** 去掉复制自 LaTeX 文档的最外层环境，源码仍原样保存在文档中。 */
export function stripTexDelimiters(source: string): string {
  const match = /^\s*(?:\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\))\s*$/.exec(source);
  return match ? (match[1] ?? match[2] ?? '') : source;
}

export function renderMath(target: HTMLElement, source: string, displayMode = true): void {
  target.classList.remove('math-error');
  source = stripTexDelimiters(source);
  if (!source.trim()) {
    target.textContent = '';
    target.dataset.empty = '';
    return;
  }
  delete target.dataset.empty;
  try {
    katex.render(source, target, {
      displayMode, throwOnError: true, strict: 'ignore', trust: false,
      output: 'htmlAndMathml', maxSize: 20, maxExpand: 1000
    });
  } catch (error) {
    target.classList.add('math-error');
    target.textContent = error instanceof Error ? error.message.replace(/^KaTeX parse error:\s*/, '') : '公式无法渲染';
  }
}

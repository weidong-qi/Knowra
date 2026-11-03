import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MathText } from './MathText';

describe('MathText', () => {
  it('没有公式时只输出文本', () => {
    const { container } = render(<p><MathText text="价格 $5 和 $10" /></p>);
    expect(container.querySelector('[data-math-text]')).toBeNull();
    expect(container).toHaveTextContent('价格 $5 和 $10');
  });

  it('公式异步渲染为 KaTeX，周围文字不变', async () => {
    const { container } = render(<p><MathText text="设 $x^2$ 为正" /></p>);
    expect(container).toHaveTextContent('设 $x^2$ 为正');
    await waitFor(() => expect(container.querySelector('.katex')).toBeInTheDocument());
    expect(container).toHaveTextContent('设');
    expect(container).toHaveTextContent('为正');
  });

  it('无法解析的公式回到原文，不显示解析错误', async () => {
    const { container } = render(<p><MathText text="坏公式 $\frac{1$ 结束" /></p>);
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(container.querySelector('.katex')).toBeNull();
    expect(container).toHaveTextContent('$\\frac{1$');
  });

  it('inlineOnly 时块公式保留原文', () => {
    render(<p data-testid="p"><MathText text="先 $$x$$ 后" inlineOnly /></p>);
    expect(screen.getByTestId('p')).toHaveTextContent('先 $$x$$ 后');
  });
});

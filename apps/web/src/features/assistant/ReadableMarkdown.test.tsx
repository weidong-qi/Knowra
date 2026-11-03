import { render, screen, waitFor } from '@testing-library/react';
import { ReadableMarkdown } from './ReadableMarkdown';

it('空标题行仍可继续显示后面的聊天正文', () => {
  render(<ReadableMarkdown text={'# \n## \n### \n正文'} />);
  expect(screen.getByText('正文')).toBeInTheDocument();
  expect(screen.getByText('#')).toBeInTheDocument();
});

it('渲染对话中的行内与块公式，金额保持原文', async () => {
  const { container } = render(<ReadableMarkdown text={'设 $x^2$ 成立，价格 $5 和 $10。\n\n$$\n\\frac{a}{b}\n$$\n\n结束'} />);
  await waitFor(() => expect(container.querySelectorAll('.katex').length).toBe(2));
  expect(container).toHaveTextContent('价格 $5 和 $10。');
  expect(screen.getByText('结束')).toBeInTheDocument();
});


it.each(['$$x$$ 和 $$y$$', '$$x$$ 是结果\n\n$$y$$'])('连续公式不吞掉正文：%s', async text => {
  const { container } = render(<ReadableMarkdown text={text} />);
  await waitFor(() => expect(container.querySelectorAll('.katex')).toHaveLength(2));
  expect(container).toHaveTextContent(text.includes('是结果') ? '是结果' : '和');
});

it('无效块公式完整保留原始定界符', async () => {
  const text = '$$\n\\notACommand{x}\n$$';
  const { container } = render(<ReadableMarkdown text={text} />);
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(container.textContent).toBe(text);
  expect(container.querySelector('.katex')).toBeNull();
});

it.each([
  '\\[x\\] 和 \\[y\\]',
  '\\[x\\] 是结果\n\n\\[y\\]',
  '$$\nx\n$$\n\n$$y$$',
  '\\[\nx\n\\]\n\n\\[y\\]'
])('两种块公式定界符保持独立：%s', async text => {
  const { container } = render(<ReadableMarkdown text={text} />);
  await waitFor(() => expect(container.querySelectorAll('.katex')).toHaveLength(2));
});

it.each(['$$x+', '\\[x+', '$$ $$'])('未闭合或空块公式保持原文：%s', text => {
  const { container } = render(<ReadableMarkdown text={text} />);
  expect(container.textContent).toBe(text);
  expect(container.querySelector('.katex')).toBeNull();
});

it('代码围栏内的定界符不渲染为公式', () => {
  const { container } = render(<ReadableMarkdown text={'```latex\n$$x$$\n```'} />);
  expect(container.querySelector('code')).toHaveTextContent('$$x$$');
  expect(container.querySelector('[data-math-text]')).toBeNull();
});

import { Schema } from '@milkdown/kit/prose/model';
import { EditorState } from '@milkdown/kit/prose/state';
import { EditorView } from '@milkdown/kit/prose/view';
import { setTextSelection } from '../../e2e/fixtures/textSelection';

function markWith(content: string) {
  const mark = document.createElement('mark');
  mark.innerHTML = content;
  document.body.append(mark);
  return mark;
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

it('复现旧部分剪切夹具把 decoration span 当文本节点导致的 IndexSizeError', () => {
  const mark = markWith('<span data-annotation-ids="[&quot;a&quot;]">abc</span>');
  const range = document.createRange();
  range.setStart(mark.firstChild!, 1);
  expect(() => range.setEnd(mark.firstChild!, 2)).toThrow(expect.objectContaining({ name: 'IndexSizeError' }));
  setTextSelection(mark, { from: 1, to: 2 });
  const selection = window.getSelection()!;
  expect(selection.toString()).toBe('b');
  expect(selection.isCollapsed).toBe(false);
  expect(selection.anchorNode?.nodeType).toBe(Node.TEXT_NODE);
  expect(selection.focusNode?.nodeType).toBe(Node.TEXT_NODE);
});

it.each(['abc', '<span><span>abc</span></span>', '<span>a</span><span><b>b</b>c</span>'])(
  '嵌套或分裂文本中的代码光标严格位于第一个字符后：%s',
  content => {
    const mark = markWith(content);
    setTextSelection(mark, { from: 1 });
    const selection = window.getSelection()!;
    expect(selection.isCollapsed).toBe(true);
    expect(selection.focusNode?.nodeType).toBe(Node.TEXT_NODE);
    const prefix = document.createRange();
    prefix.selectNodeContents(mark);
    prefix.setEnd(selection.focusNode!, selection.focusOffset);
    expect(prefix.toString()).toBe('a');
    const suffix = document.createRange();
    suffix.selectNodeContents(mark);
    suffix.setStart(selection.focusNode!, selection.focusOffset);
    expect(suffix.toString()).toBe('bc');
  }
);

it('跨多个装饰文本节点的部分选区保持精确字符范围', () => {
  const mark = markWith('<span>a<b>b</b></span><span>c<em>d</em></span>');
  setTextSelection(mark, { from: 1, to: 3 });
  expect(window.getSelection()!.toString()).toBe('bc');
});

it('超出正文的偏移必须报错，不能默默裁剪成另一个选区', () => {
  const mark = markWith('<span>abc</span>');
  expect(() => setTextSelection(mark, { from: 1, to: 4 })).toThrow(RangeError);
  expect(() => setTextSelection(mark, { from: 2, to: 1 })).toThrow(RangeError);
});

it('旧代码光标夹具在装饰元素中会落到整段末尾，新定位仍在 a 后', () => {
  const mark = markWith('<span>abc</span>');
  const oldRange = document.createRange();
  oldRange.setStart(mark.firstChild!, 1);
  oldRange.collapse(true);
  const prefix = document.createRange();
  prefix.selectNodeContents(mark);
  prefix.setEnd(oldRange.startContainer, oldRange.startOffset);
  expect(prefix.toString()).toBe('abc');
  setTextSelection(mark, { from: 1 });
  const selection = window.getSelection()!;
  prefix.setEnd(selection.focusNode!, selection.focusOffset);
  expect(prefix.toString()).toBe('a');
});

it('注入选区立即同步 ProseMirror 状态，focus 延迟恢复不再清空选区', () => {
  vi.useFakeTimers();
  const schema = new Schema({
    nodes: {
      doc: { content: 'paragraph+' },
      paragraph: { content: 'text*', toDOM: () => ['p', 0] },
      text: {}
    }
  });
  const host = document.createElement('div');
  document.body.append(host);
  const view = new EditorView(host, {
    state: EditorState.create({
      schema,
      doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('abc')])])
    })
  });
  try {
    view.focus();
    setTextSelection(view.dom, { from: 1, to: 2 });
    expect(view.state.selection.from).toBe(2);
    expect(view.state.selection.to).toBe(3);
    vi.advanceTimersByTime(20);
    expect(window.getSelection()?.toString()).toBe('b');
    expect(view.state.selection.from).toBe(2);
    expect(view.state.selection.to).toBe(3);
  } finally {
    view.destroy();
    vi.useRealTimers();
  }
});

/** 以正文字符偏移定位，不能把装饰元素的 child offset 当成文本 offset。可直接传给 Locator.evaluate。 */
export function setTextSelection(element: Element, { from, to = from }: { from: number; to?: number }) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
    throw new RangeError('选区字符偏移无效');
  }
  const document = element.ownerDocument;
  const locate = (offset: number) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node as Text;
      if (offset <= text.length) return { node: text, offset };
      offset -= text.length;
    }
    throw new RangeError('选区字符偏移超出正文范围');
  };
  const start = locate(from),
    end = locate(to);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  const selection = document.defaultView?.getSelection();
  if (!selection) throw new Error('无法取得浏览器选区');
  selection.removeAllRanges();
  selection.addRange(range);
  // 同步通知编辑器，避免 focus 的延迟选区恢复覆盖尚未消费的 DOM 选区。
  document.dispatchEvent(new Event('selectionchange'));
}

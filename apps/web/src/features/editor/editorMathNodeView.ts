import { TextSelection } from '@milkdown/kit/prose/state';
import type { NodeViewConstructor } from '@milkdown/kit/prose/view';
import { renderMath } from './editorMathRender';

/** 两类公式共用源码/预览边界，编辑和历史始终由 ProseMirror 文档管理。 */
export function createMathNodeView(displayMode: boolean): NodeViewConstructor {
  return (initialNode, view, getPos) => {
    let node = initialNode;
    let rendered: string | null = null;
    const dom = document.createElement(displayMode ? 'div' : 'span');
    dom.setAttribute(displayMode ? 'data-math-block' : 'data-math-inline', '');
    const source = document.createElement(displayMode ? 'pre' : 'span');
    source.dataset.mathSource = '';
    const contentDOM = displayMode ? document.createElement('code') : source;
    contentDOM.spellcheck = false;
    contentDOM.setAttribute('aria-label', displayMode ? 'LaTeX 公式源码' : 'LaTeX 行内公式源码');
    if (displayMode) source.append(contentDOM);
    const preview = document.createElement(displayMode ? 'div' : 'span');
    preview.dataset.mathPreview = '';
    preview.contentEditable = 'false';
    preview.setAttribute('role', 'math');
    dom.append(source, preview);
    const fitPreview = () => {
      if (!dom.isConnected) return;
      const origin = dom.getBoundingClientRect().left;
      const editor = view.dom.getBoundingClientRect();
      const left = Math.max(8, editor.left);
      const right = Math.min(window.innerWidth - 8, editor.right);
      const shift = Math.max(left - origin, Math.min(0, right - origin - preview.offsetWidth));
      preview.style.transform = `translateX(${shift}px)`;
    };
    const resizeObserver = !displayMode && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fitPreview) : null;
    if (resizeObserver) [view.dom, dom, preview].forEach(element => resizeObserver.observe(element));
    const sync = () => {
      if (node.textContent === rendered) return;
      rendered = node.textContent;
      renderMath(preview, rendered, displayMode);
    };
    sync();
    preview.addEventListener('mousedown', (event) => {
      if (!(event instanceof MouseEvent) || !view.editable || event.button !== 0) return;
      const pos = getPos();
      if (pos === undefined) return;
      event.preventDefault();
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1 + node.content.size)));
      view.focus();
    });
    return {
      dom, contentDOM,
      update(next) {
        if (next.type !== node.type) return false;
        node = next;
        sync();
        return true;
      },
      stopEvent: (event) => event.target instanceof Node && preview.contains(event.target),
      ignoreMutation: (mutation) => mutation.type !== 'selection' && preview.contains(mutation.target),
      destroy: () => resizeObserver?.disconnect()
    };
  };
}

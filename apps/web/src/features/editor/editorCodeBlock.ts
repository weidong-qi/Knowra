import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { writeClipboardText } from '../../browser/clipboard';
import { leaveCode } from './editorCodeCommands';
import { TextSelection } from '@milkdown/kit/prose/state';

/** Keep the editable code in ProseMirror so selection, IME, undo and Markdown share one document. */
export function createCodeBlockBehavior(onStatus: (message: string) => void) {
  return $prose(() => new Plugin({
    key: new PluginKey('V4_CODE_BLOCK'),
    props: {
      nodeViews: {
        code_block(initialNode, view, getPos) {
          let node = initialNode;
          const dom = document.createElement('pre');
          dom.dataset.codeBlock = '';
          const toolbar = document.createElement('span');
          toolbar.dataset.codeToolbar = '';
          toolbar.contentEditable = 'false';
          toolbar.setAttribute('role', 'group');
          toolbar.setAttribute('aria-label', '代码块工具');
          const language = document.createElement('input');
          language.setAttribute('aria-label', '代码语言');
          language.placeholder = '纯文本';
          language.title = '填写语言，如 python、javascript、c++；留空为纯文本';
          language.spellcheck = false;
          const copy = document.createElement('button');
          copy.type = 'button';
          copy.textContent = '复制代码';
          const exit = document.createElement('button');
          exit.type = 'button';
          exit.textContent = '在下方继续';
          exit.title = '在代码块下方继续编写正文（Ctrl/⌘ + Enter）';
          toolbar.append(language, exit, copy);
          const contentDOM = document.createElement('code');
          contentDOM.spellcheck = false;
          dom.append(toolbar, contentDOM);
          const sync = () => {
            language.value = String(node.attrs.language ?? '');
            dom.dataset.language = language.value;
            language.disabled = !view.editable;
            exit.disabled = !view.editable;
          };
          sync();
          language.addEventListener('change', () => {
            const pos = getPos();
            if (!view.editable || pos === undefined) return sync();
            const value = language.value.trim().replace(/[\s`~]/g, '');
            view.dispatch(view.state.tr.setNodeAttribute(pos, 'language', value));
          });
          language.addEventListener('keydown', (event) => {
            if (event.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter') { language.blur(); view.focus(); }
            if (event.key === 'Escape') { sync(); view.focus(); }
          });
          copy.addEventListener('click', () => {
            if (!node.textContent) { onStatus('代码块为空'); return; }
            void writeClipboardText(node.textContent).then((ok) => onStatus(ok ? '代码已复制' : '复制失败，请选择代码后手动复制'));
          });
          exit.addEventListener('click', () => {
            const pos = getPos();
            if (!view.editable || pos === undefined) return;
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1)));
            leaveCode(view.state, view.dispatch, view);
            view.focus();
          });
          // setProps(editable) does not necessarily update an unchanged node view.
          const observer = new MutationObserver(() => {
            language.disabled = !view.editable;
            exit.disabled = !view.editable;
          });
          observer.observe(view.dom, { attributes: true, attributeFilter: ['contenteditable'] });
          return {
            dom,
            contentDOM,
            update(nextNode) {
              if (nextNode.type !== node.type) return false;
              node = nextNode;
              sync();
              return true;
            },
            stopEvent: (event) => event.target instanceof Node && toolbar.contains(event.target),
            ignoreMutation: (mutation) => mutation.type !== 'selection' && (mutation.target === dom || toolbar.contains(mutation.target)),
            destroy: () => observer.disconnect()
          };
        }
      }
    }
  }));
}

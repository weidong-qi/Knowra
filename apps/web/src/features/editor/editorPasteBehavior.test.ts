import { Fragment, Schema, Slice } from '@milkdown/kit/prose/model';
import { describe, expect, it, vi } from 'vitest';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import {
  uploadPastedImages,
  findUnsupportedPasteSources,
  looksLikeMarkdown,
  removeSpuriousEmptyCodeBlocks,
  shouldPreferPlainMarkdown,
  stripPastedInlineStyles
} from './editorPasteBehavior';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'text*', group: 'block' },
    code_block: { content: 'text*', group: 'block', code: true },
    text: { group: 'inline' }
  }
});

describe('editorPasteBehavior', () => {
  it('recognizes Markdown blocks and respects VS Code clipboard metadata', () => {
    expect(looksLikeMarkdown('## 标题\n\n- 列表')).toBe(true);
    expect(looksLikeMarkdown('普通句子')).toBe(false);
    expect(shouldPreferPlainMarkdown({ text: '# 标题', html: '<h1>标题</h1>', vscodeData: '' })).toBe(true);
    expect(shouldPreferPlainMarkdown({ text: '# 标题', html: '', vscodeData: '{"mode":"markdown"}' })).toBe(false);
  });

  it('removes foreign inline presentation while preserving semantic markup', () => {
    expect(stripPastedInlineStyles('<p style="color:red"><strong style="font-size:30px">重点</strong></p>'))
      .toBe('<p><strong>重点</strong></p>');
  });

  it('preserves HTML code language and removes copied editor controls', () => {
    expect(stripPastedInlineStyles('<pre><span data-code-toolbar>复制代码</span><code class="language-c++">  a\n\n b</code></pre>'))
      .toBe('<pre data-language="c++"><code class="language-c++">  a\n\n b</code></pre>');
    expect(stripPastedInlineStyles('<pre>plain</pre>')).toBe('<pre data-language="">plain</pre>');
  });

  it('removes only a spurious empty code block before a populated code block', () => {
    const slice = new Slice(Fragment.fromArray([
      schema.nodes.code_block.create(),
      schema.nodes.code_block.create(null, schema.text('const value = 1')),
      schema.nodes.paragraph.create(null, schema.text('正文'))
    ]), 0, 0);
    const repaired = removeSpuriousEmptyCodeBlocks(slice);
    expect(repaired.content.childCount).toBe(2);
    expect(repaired.content.firstChild?.textContent).toBe('const value = 1');
  });

  it('detects insecure image sources without blocking ordinary links', () => {
    expect(findUnsupportedPasteSources('<img src="http://unsafe.test/a.png">', '![b](http://unsafe.test/b.png)'))
      .toEqual(['http://unsafe.test/a.png', 'http://unsafe.test/b.png']);
    expect(findUnsupportedPasteSources('<img src=http://unsafe.test/unquoted.png>', ''))
      .toEqual(['http://unsafe.test/unquoted.png']);
    expect(findUnsupportedPasteSources('', '[site](http://example.test)')).toEqual([]);
  });
});


describe('异步粘贴图片', () => {
  it.each(['selection', 'document', 'readonly', 'destroyed'])('上传等待期间 %s 改变则保留正文并取消插入', async change => {
    const imageSchema = new Schema({ nodes: {
      doc: { content: 'block+' }, paragraph: { content: 'inline*', group: 'block' },
      text: { group: 'inline' }, image: { inline: true, group: 'inline', attrs: { src: {}, alt: {}, title: { default: null } } }
    } });
    const doc = imageSchema.node('doc', null, imageSchema.node('paragraph', null, imageSchema.text('保留正文')));
    const view = { state: EditorState.create({ doc, selection: TextSelection.create(doc, 1) }), editable: true, isDestroyed: false, dispatch: vi.fn() };
    let finish!: (value: { url: string; alt: string }) => void;
    const upload = vi.fn(() => new Promise<{ url: string; alt: string }>(resolve => { finish = resolve; }));
    const status = vi.fn();
    const pending = uploadPastedImages(view as unknown as EditorView, [new File(['bytes'], 'a.png', { type: 'image/png' })], upload, status);
    if (change === 'selection') view.state = view.state.apply(view.state.tr.setSelection(TextSelection.create(doc, 1, 5)));
    if (change === 'document') view.state = view.state.apply(view.state.tr.insertText('新输入', 1));
    if (change === 'readonly') view.editable = false;
    if (change === 'destroyed') view.isDestroyed = true;
    finish({ url: '/api/storage/attachments/a/content', alt: 'a' });
    await pending;
    expect(view.dispatch).not.toHaveBeenCalled();
    expect(status).toHaveBeenLastCalledWith(expect.stringContaining('未插入正文'));
  });
});

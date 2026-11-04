import { afterEach, describe, expect, it } from 'vitest';
import { Editor, defaultValueCtx, editorViewCtx, parserCtx, rootCtx } from '@milkdown/kit/core';
import { gfm } from '@milkdown/kit/preset/gfm';
import { history } from '@milkdown/kit/plugin/history';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { getHTML, getMarkdown } from '@milkdown/kit/utils';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { joinBackward, splitBlock } from '@milkdown/kit/prose/commands';
import { splitListItem } from '@milkdown/kit/prose/schema-list';
import { undo } from '@milkdown/kit/prose/history';
import { createCodeBlockBehavior } from './editorCodeBlock';
import { commonmarkPreset } from './editorHardbreakMarks';
import { mathBlockSchema } from './editorMathBlock';
import { mathInlineSchema } from './editorMathInline';
import { mathInlineGuardRemark, mathRemark } from './editorMathMarkdown';
import {
  IDENTITY_META,
  configureBlockIdentitySchema,
  createBlockIdentityBehavior,
  stripIdentityFromHtml,
  withoutIdentity
} from './editorBlockIdentity';
import { createDocumentEventsBehavior } from './editorDocumentEvents';
import { createKnowraMarksCodec, knowraMarkSchema } from './editorKnowraMarks';

const globals = globalThis as Record<string, unknown>;
globals.ClipboardEvent ??= class extends Event {
  clipboardData: DataTransfer | null;
  constructor(type: string, init?: { clipboardData?: DataTransfer }) {
    super(type);
    this.clipboardData = init?.clipboardData ?? null;
  }
};

interface TestEditor {
  editor: Editor;
  view: EditorView;
  markdown: () => string;
  destroy: () => Promise<void>;
}
const editors: TestEditor[] = [];
afterEach(async () => {
  for (const editor of editors.splice(0)) await editor.destroy();
});

async function createEditor(
  markdown: string,
  options: { onChange?: (markdown: string) => void } = {}
): Promise<TestEditor> {
  const root = document.createElement('div');
  document.body.append(root);
  const editor = await Editor.make()
    .config(ctx => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
    })
    .use(commonmarkPreset)
    .use(createCodeBlockBehavior(() => {}))
    .use(gfm)
    .use(mathRemark)
    .use(mathInlineGuardRemark)
    .use(mathBlockSchema)
    .use(mathInlineSchema)
    .use(clipboard)
    .use(
      createDocumentEventsBehavior(
        () => {},
        options.onChange ?? (() => {}),
        () => {}
      )
    )
    .use(createBlockIdentityBehavior())
    .use(knowraMarkSchema)
    .use(createKnowraMarksCodec())
    .use(history)
    .config(configureBlockIdentitySchema)
    .create();
  const view = editor.ctx.get(editorViewCtx);
  view.dispatch(view.state.tr.setMeta(IDENTITY_META, true).setMeta('addToHistory', false));
  const result: TestEditor = {
    editor,
    view,
    markdown: () => editor.action(getMarkdown()),
    destroy: async () => {
      await editor.destroy();
      root.remove();
    }
  };
  editors.push(result);
  return result;
}

const blockIds = (doc: ProseNode, type?: string) => {
  const ids: string[] = [];
  doc.descendants(node => {
    if (node.attrs.blockId && (!type || node.type.name === type)) ids.push(node.attrs.blockId);
  });
  return ids;
};
const cursor = (e: TestEditor, position: number) =>
  e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, position)));
const child = (doc: ProseNode, index: number) => {
  let from = 0;
  for (let i = 0; i < index; i++) from += doc.child(i).nodeSize;
  return { from, to: from + doc.child(index).nodeSize, start: from + 1, end: from + doc.child(index).nodeSize - 1 };
};
const clipboardHtml = (e: TestEditor, from: number, to: number) =>
  e.view.serializeForClipboard(e.view.state.doc.slice(from, to)).dom.innerHTML;

describe('块身份', () => {
  it('加载后所有块都有唯一 ID，Markdown 不变', async () => {
    const markdown =
      '# 标题\n\n段落 **加粗**\n\n* 甲\n  * 乙\n\n```js\ncode\n```\n\n$$\nx^2\n$$\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n> 引用\n\n***\n';
    const e = await createEditor(markdown);
    const types: string[] = [];
    e.view.state.doc.descendants(node => {
      if (node.attrs.blockId) types.push(node.type.name);
    });
    expect(types).toEqual(
      expect.arrayContaining([
        'heading',
        'paragraph',
        'list_item',
        'code_block',
        'math_block',
        'table',
        'blockquote',
        'hr'
      ])
    );
    const ids = blockIds(e.view.state.doc);
    expect(new Set(ids).size).toBe(ids.length);
    expect(e.markdown()).toBe(markdown);
  });

  it('拆分段落时前半保留 ID，合并时保留前一段 ID', async () => {
    const e = await createEditor('甲乙丙丁\n');
    const [original] = blockIds(e.view.state.doc, 'paragraph');
    cursor(e, 3);
    splitBlock(e.view.state, e.view.dispatch);
    const split = blockIds(e.view.state.doc, 'paragraph');
    expect(split[0]).toBe(original);
    expect(split[1]).not.toBe(original);
    cursor(e, child(e.view.state.doc, 1).start);
    joinBackward(e.view.state, e.view.dispatch);
    expect(blockIds(e.view.state.doc, 'paragraph')).toEqual([original]);
  });

  it('拆分列表项时前半保留 ID', async () => {
    const e = await createEditor('* 甲乙\n* 丙\n');
    const before = blockIds(e.view.state.doc, 'list_item');
    let position = 0;
    e.view.state.doc.descendants((node, pos) => {
      if (!position && node.isText && node.text?.startsWith('甲乙')) position = pos + 1;
    });
    cursor(e, position);
    splitListItem(e.view.state.schema.nodes.list_item)(e.view.state, e.view.dispatch);
    const after = blockIds(e.view.state.doc, 'list_item');
    expect(after).toHaveLength(3);
    expect([after[0], after[2]]).toEqual(before);
  });

  it('删除后撤销恢复块 ID', async () => {
    const e = await createEditor('甲\n\n乙丙\n\n丁\n');
    const ids = blockIds(e.view.state.doc, 'paragraph');
    const second = child(e.view.state.doc, 1);
    e.view.dispatch(e.view.state.tr.delete(second.from, second.to));
    undo(e.view.state, e.view.dispatch);
    expect(blockIds(e.view.state.doc, 'paragraph')).toEqual(ids);
  });

  it('复制粘贴：副本获得新 ID，原块保留 ID', async () => {
    const e = await createEditor('甲乙\n\n丙\n');
    const ids = blockIds(e.view.state.doc, 'paragraph');
    const first = child(e.view.state.doc, 0);
    cursor(e, e.view.state.doc.content.size - 1);
    e.view.pasteHTML(clipboardHtml(e, first.from, first.to));
    const after = blockIds(e.view.state.doc, 'paragraph');
    expect(after[0]).toBe(ids[0]);
    expect(new Set(after).size).toBe(3);
    expect(e.view.state.doc.child(after.findIndex(id => !ids.includes(id))).textContent).toBe('甲乙');
  });

  it('剪切后粘贴：保留块 ID', async () => {
    const e = await createEditor('甲乙\n\n丙\n\n丁\n');
    const ids = blockIds(e.view.state.doc, 'paragraph');
    const first = child(e.view.state.doc, 0);
    const html = clipboardHtml(e, first.from, first.to);
    e.view.dispatch(e.view.state.tr.delete(first.from, first.to).setMeta('uiEvent', 'cut'));
    cursor(e, e.view.state.doc.content.size - 1);
    e.view.pasteHTML(html);
    expect([...blockIds(e.view.state.doc, 'paragraph')].sort()).toEqual([...ids].sort());
  });

  it('拖拽移动（同一事务插入并删除原位置）保留块 ID', async () => {
    const e = await createEditor('甲乙\n\n丙\n\n丁\n');
    const ids = blockIds(e.view.state.doc, 'paragraph');
    const first = child(e.view.state.doc, 0);
    const slice = e.view.state.doc.slice(first.from, first.to);
    e.view.dispatch(
      e.view.state.tr
        .insert(e.view.state.doc.content.size, slice.content)
        .delete(first.from, first.to)
        .setMeta('uiEvent', 'drop')
    );
    expect(blockIds(e.view.state.doc, 'paragraph')).toEqual([ids[1], ids[2], ids[0]]);
  });
});

describe('正文事件', () => {
  it('块 ID 不进入 Markdown 与导出 HTML', async () => {
    const markdown = '前文 `"hello".upper()` 后文\n第二行\n\n```py\nX = x.reshape(3,4)\n```\n';
    const e = await createEditor(markdown);
    expect(e.markdown()).toBe(markdown);
    expect(stripIdentityFromHtml(e.editor.action(getHTML()))).not.toMatch(/data-block-id/);
  });

  it('与重新解析的 Markdown 比较正文时忽略块 ID', async () => {
    const markdown = '第一处文字\n\n第二处文字\n';
    const e = await createEditor(markdown);
    const parsed = e.editor.ctx.get(parserCtx)(markdown) as ProseNode;
    expect(e.view.state.doc.eq(parsed)).toBe(false);
    expect(withoutIdentity(e.view.state.doc).eq(parsed)).toBe(true);
    expect(
      withoutIdentity(e.view.state.doc).eq(e.editor.ctx.get(parserCtx)('第一处文字\n\n第三处文字\n') as ProseNode)
    ).toBe(false);
  });

  it('只改身份的事务不触发正文变更回调', async () => {
    const changes: string[] = [];
    const e = await createEditor('甲乙\n', { onChange: markdown => changes.push(markdown) });
    e.view.dispatch(e.view.state.tr.setNodeAttribute(0, 'blockId', 'manual').setMeta(IDENTITY_META, true));
    expect(changes).toEqual([]);
    e.view.dispatch(e.view.state.tr.insertText('丙', 3));
    expect(changes).toEqual(['甲乙丙\n']);
  });

  it('不改正文的非历史维护事务不通知保存，非历史正文编辑仍通知保存', async () => {
    const changes: string[] = [];
    const e = await createEditor('## 标题\n\n正文', { onChange: markdown => changes.push(markdown) });
    e.view.dispatch(e.view.state.tr.setNodeAttribute(0, 'blockId', 'kept').setMeta('addToHistory', false));
    expect(changes).toEqual([]);
    const paragraph = child(e.view.state.doc, 1);
    e.view.dispatch(e.view.state.tr.insertText('补充', paragraph.start).setMeta('addToHistory', false));
    expect(changes).toEqual([e.markdown()]);
    expect(e.markdown()).toContain('补充正文');
  });
});

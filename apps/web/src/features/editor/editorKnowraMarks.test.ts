import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  parserCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
  serializerCtx
} from '@milkdown/kit/core';
import { gfm } from '@milkdown/kit/preset/gfm';
import { history } from '@milkdown/kit/plugin/history';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { undo, redo } from '@milkdown/kit/prose/history';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import {
  insertKnowraMarks,
  knowraCheck,
  parseKnowraMarks,
  stripKnowraMarks
} from '@study-accelerator/shared/knowra-marks';
import { commonmarkPreset } from './editorHardbreakMarks';
import { noteLinkSchema } from './editorNoteLinks';
import { createCodeBlockBehavior } from './editorCodeBlock';
import { mathBlockSchema, mathBlockSerializerGuard } from './editorMathBlock';
import { mathInlineSchema } from './editorMathInline';
import { mathInlineGuardRemark, mathRemark } from './editorMathMarkdown';
import { highlightRemark, highlightSchema } from './editorHighlight';
import { internalLinkRemark, internalLinkSchema } from './editorInternalLink';
import { configureImageSize } from './editorImageBehavior';
import {
  annotationMarkSchema,
  annotationSerializerGuard,
  configureBlockIdentitySchema,
  createBlockIdentityBehavior
} from './editorBlockIdentity';
import { annotationPluginKey, createAnnotationHighlightBehavior } from './editorAnnotations';
import { createEditorPasteBehavior } from './editorPasteBehavior';
import { runEditorClipboardAction } from './editorClipboard';
import {
  createKnowraMarksCodec,
  KNOWRA_BLOCKS_ATTR,
  KNOWRA_MARK,
  knowraMarkSchema,
  type KnowraMarkProblem
} from './editorKnowraMarks';

const globals = globalThis as Record<string, unknown>;
globals.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globals.ClipboardEvent ??= class extends Event {
  clipboardData: DataTransfer | null;
  constructor(type: string, init?: { clipboardData?: DataTransfer }) {
    super(type);
    this.clipboardData = init?.clipboardData ?? null;
  }
};

const destroyers: Array<() => Promise<void>> = [];
// Milkdown 已完成的 Timer 仍留下超时回调，必须在 jsdom 销毁前执行，不能丢弃或忽略异常。
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(async () => {
  try {
    for (const destroy of destroyers.splice(0)) await destroy();
    await vi.runOnlyPendingTimersAsync();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

/** 与 MilkdownNoteEditor 相同的 schema、remark 与序列化包装（只取影响文档结构和 Markdown 的部分）。 */
async function createEditor(markdown: string, problems: KnowraMarkProblem[] = []) {
  const root = document.createElement('div');
  document.body.append(root);
  const editor = await Editor.make()
    .config(ctx => {
      configureImageSize(ctx);
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
      // 与 MilkdownNoteEditor 相同的 ==高亮== 与 [[内部链接]] 写出规则。
      ctx.update(remarkStringifyOptionsCtx, options => {
        type MarkdownHandler = NonNullable<typeof options.handlers>['text'];
        const delimited =
          (open: string, close = open): MarkdownHandler =>
          (node, _parent, state, info) => {
            const exit = state.enter('emphasis');
            const tracker = state.createTracker(info);
            let value = tracker.move(open);
            value += tracker.move(state.containerPhrasing(node, { before: value, after: close, ...tracker.current() }));
            value += tracker.move(close);
            exit();
            return value;
          };
        return {
          ...options,
          handlers: { ...options.handlers, highlight: delimited('=='), internalLink: delimited('[[', ']]') }
        };
      });
    })
    .use(commonmarkPreset)
    .use(noteLinkSchema)
    .use(createCodeBlockBehavior(() => {}))
    .use(gfm)
    .use(mathRemark)
    .use(mathInlineGuardRemark)
    .use(mathBlockSchema)
    .use(mathBlockSerializerGuard)
    .use(mathInlineSchema)
    .use(highlightRemark)
    .use(highlightSchema)
    .use(internalLinkRemark)
    .use(internalLinkSchema)
    .use(annotationMarkSchema)
    .use(annotationSerializerGuard)
    .use(knowraMarkSchema)
    .use(createKnowraMarksCodec(problem => problems.push(problem)))
    .use(createEditorPasteBehavior(() => {}))
    .use(clipboard)
    .use(createAnnotationHighlightBehavior(() => {}))
    .use(
      createBlockIdentityBehavior(
        () => null,
        state => annotationPluginKey.getState(state)?.editIntent.moveKind === 'paste'
      )
    )
    .use(history)
    .config(configureBlockIdentitySchema)
    .create();
  destroyers.push(async () => {
    await editor.destroy();
    root.remove();
  });
  const view = editor.ctx.get(editorViewCtx);
  view.setProps({ handleScrollToSelection: () => true });
  return {
    editor,
    view,
    serialize: (doc: ProseNode = view.state.doc) => editor.ctx.get(serializerCtx)(doc),
    parse: (text: string) => editor.ctx.get(parserCtx)(text) as ProseNode
  };
}

/** 每条行内标记覆盖的编辑器文字（按出现顺序拼接）。 */
function markedText(doc: ProseNode) {
  const result = new Map<string, string>();
  doc.descendants(node => {
    if (!node.isText) return;
    for (const mark of node.marks)
      if (mark.type.name === KNOWRA_MARK) result.set(mark.attrs.id, (result.get(mark.attrs.id) ?? '') + node.text);
  });
  return Object.fromEntries(result);
}

function blockMarks(doc: ProseNode) {
  const result: Array<[string, string]> = [];
  doc.descendants(node => {
    for (const item of node.attrs[KNOWRA_BLOCKS_ATTR] ?? []) result.push([node.type.name, item.id]);
  });
  return result;
}

describe('正文 Knowra 标记与编辑器文档互转', () => {
  it.each(['copy', 'cut'] as const)(
    '编辑菜单 %s：保留重点载体，部分剪切保留身份，复制和再次粘贴得新身份',
    async action => {
      const { editor, view } = await createEditor('<mark data-k="a">abc</mark>\n\n尾段');
      let text = '';
      vi.stubGlobal('navigator', {
        userAgent: navigator.userAgent,
        clipboard: {
          writeText: async (value: string) => {
            text = value;
          },
          readText: async () => text
        }
      });
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 3)));
      expect(await runEditorClipboardAction(editor, action)).toEqual({ ok: true });
      expect(text).toContain('data-k="a"');
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 1)));
      expect(await runEditorClipboardAction(editor, 'paste')).toEqual({ ok: true });
      if (action === 'cut') expect(markedText(view.state.doc)).toEqual({ a: 'acb' });
      else {
        expect(markedText(view.state.doc).a).toBe('abc');
        expect(Object.values(markedText(view.state.doc)).sort()).toEqual(['abc', 'b']);
      }
      expect(await runEditorClipboardAction(editor, 'paste')).toEqual({ ok: true });
      expect(Object.keys(markedText(view.state.doc))).toHaveLength(action === 'cut' ? 2 : 3);
    }
  );

  it('编辑菜单复制代码范围到代码内部：不粘贴 Markdown 标签，副本成为新重点', async () => {
    const { editor, view } = await createEditor(`<!--k a s=code r=0-3 h=${knowraCheck('abc')}-->\n~~~\nabc\n~~~`);
    let text = '';
    vi.stubGlobal('navigator', {
      userAgent: navigator.userAgent,
      clipboard: {
        writeText: async (value: string) => {
          text = value;
        },
        readText: async () => text
      }
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 3)));
    expect(await runEditorClipboardAction(editor, 'copy')).toEqual({ ok: true });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    expect(await runEditorClipboardAction(editor, 'paste')).toEqual({ ok: true });
    expect(view.state.doc.textContent).toBe('abbc');
    expect(Object.values(markedText(view.state.doc)).sort()).toEqual(['abc', 'b']);
  });

  it.each(['menu-native', 'native-menu'])('剪贴板入口互通 %s：部分剪切保留原重点，下一次粘贴生成副本', async mode => {
    const { editor, view } = await createEditor('<mark data-k="a">abc</mark>\n\n尾段');
    const values = new Map<string, string>();
    const data = {
      items: [],
      clearData: () => values.clear(),
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? ''
    } as unknown as DataTransfer;
    vi.stubGlobal('navigator', {
      userAgent: navigator.userAgent,
      clipboard: {
        writeText: async (text: string) => {
          values.clear();
          values.set('text/plain', text);
        },
        readText: async () => values.get('text/plain') ?? '',
        read: async () => [
          {
            types: ['text/plain', ...(values.has('text/html') ? ['text/html'] : [])],
            getType: async (type: string) => ({ text: async () => values.get(type) ?? '' })
          }
        ]
      }
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 3)));
    if (mode === 'menu-native') expect(await runEditorClipboardAction(editor, 'cut')).toEqual({ ok: true });
    else view.dom.dispatchEvent(new ClipboardEvent('cut', { clipboardData: data }));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 1)));
    const paste = async () =>
      mode === 'menu-native'
        ? view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data }))
        : runEditorClipboardAction(editor, 'paste');
    await paste();
    expect(markedText(view.state.doc)).toEqual({ a: 'acb' });
    await paste();
    expect(Object.values(markedText(view.state.doc)).sort()).toEqual(['acb', 'b']);
  });
  it('剪切后替换为同文异重点的剪贴板：不误判移动，外部副本获得新身份', async () => {
    const { editor, view } = await createEditor('<mark data-k="a">abc</mark>\n\n<mark data-k="x">b</mark>');
    const values = new Map<string, string>();
    const data = {
      items: [],
      clearData: () => values.clear(),
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? ''
    } as unknown as DataTransfer;
    vi.stubGlobal('navigator', {
      userAgent: navigator.userAgent,
      clipboard: {
        read: async () => [
          {
            types: ['text/plain', 'text/html'],
            getType: async (type: string) => ({ text: async () => values.get(type) ?? '' })
          }
        ]
      }
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 3)));
    view.dom.dispatchEvent(new ClipboardEvent('cut', { clipboardData: data }));
    values.clear();
    values.set('text/plain', 'b');
    values.set('text/html', '<mark data-knowra-mark="x" data-knowra-attrs="{}">b</mark>');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 1)));
    expect(await runEditorClipboardAction(editor, 'paste')).toEqual({ ok: true });
    const covered = markedText(view.state.doc);
    expect(covered.a).toBe('ac');
    expect(covered.x).toBe('b');
    expect(Object.values(covered).sort()).toEqual(['ac', 'b', 'b']);
  });
  it('不可信剪贴板：拒绝 null/数组/非法 ID/非字符串属性和损坏块条目，正文仍可粘贴保存', async () => {
    const { view, serialize } = await createEditor('原文');
    const html =
      '<p data-knowra-blocks=\'[null,{"id":"bad!","attrs":{}},{"id":"b","attrs":{"s":"blocks","future":"ok"}}]\'>' +
      ['null', '[]', '{"t":1}']
        .map(data => `<mark data-knowra-mark="a" data-knowra-attrs='${data}'>字</mark>`)
        .join('') +
      '<mark data-knowra-mark="bad!">文</mark></p>';
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 1)));
    expect(() => view.pasteHTML(html)).not.toThrow();
    expect(markedText(view.state.doc)).toEqual({});
    expect(view.state.doc.textContent).toContain('字字字文');
    expect(() => serialize()).not.toThrow();
  });
  it('紧邻原文复制：副本成为新重点，撤销重做保持副本身份', async () => {
    const { view, serialize, parse } = await createEditor('<mark data-k="a" data-t="key">abc</mark>');
    const html = view.serializeForClipboard(view.state.doc.slice(1, 4)).dom.innerHTML;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));
    view.pasteHTML(html);
    const covered = markedText(view.state.doc);
    expect(covered.a).toBe('abc');
    expect(Object.values(covered)).toEqual(['abc', 'abc']);
    const copyId = Object.keys(covered).find(id => id !== 'a')!;
    expect(copyId).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    const saved = serialize();
    expect(markedText(parse(saved))).toEqual(covered);
    undo(view.state, view.dispatch);
    expect(markedText(view.state.doc)).toEqual({ a: 'abc' });
    redo(view.state, view.dispatch);
    expect(markedText(view.state.doc)).toEqual(covered);
  });

  it.each(['code', 'inlineCode'])('粘贴到 %s：保留纯文字语义，复制代码范围仍生成新重点', async mode => {
    const markdown =
      mode === 'code'
        ? `<!--k a s=code r=0-3 h=${knowraCheck('abc')}-->\n~~~\nabc\n~~~`
        : '<mark data-k="a">`abc`</mark>';
    const { view, serialize, parse } = await createEditor(markdown);
    const html = view.serializeForClipboard(view.state.doc.slice(1, 4)).dom.innerHTML;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    const data = {
      items: [],
      getData: (type: string) => (type === 'text/html' ? html : type === 'text/plain' ? 'abc' : '')
    } as unknown as DataTransfer;
    view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data }));
    expect(view.state.doc.textContent).toBe('aabcbc');
    const covered = markedText(view.state.doc);
    expect(covered.a).toBe('abc');
    expect(Object.values(covered)).toEqual(['abc', 'abc']);
    if (mode === 'code') expect(markedText(parse(serialize()))).toEqual(covered);
    else expect(serialize()).not.toContain('==');
  });

  it.each(['native', 'menu'])('代码内 %s 粘贴普通文字只扩展原重点，不凭空创建新重点', async mode => {
    const { editor, view, serialize, parse } = await createEditor(
      `<!--k a s=code r=0-3 h=${knowraCheck('abc')}-->\n~~~\nabc\n~~~`
    );
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    if (mode === 'native') {
      const data = {
        items: [],
        getData: (type: string) => (type === 'text/plain' ? 'X' : '')
      } as unknown as DataTransfer;
      view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data }));
    } else {
      vi.stubGlobal('navigator', { userAgent: navigator.userAgent, clipboard: { readText: async () => 'X' } });
      expect(await runEditorClipboardAction(editor, 'paste')).toEqual({ ok: true });
    }
    expect(view.state.doc.textContent).toBe('aXbc');
    expect(markedText(view.state.doc)).toEqual({ a: 'aXbc' });
    expect(markedText(parse(serialize()))).toEqual({ a: 'aXbc' });
  });

  it('复制章节：同一副本的行内、块级分段与排除项共用新 ID，再复制再换新', async () => {
    const { view, serialize, parse } = await createEditor(
      '## 节 <!--k a s=section-->\n\n**<mark data-k="a">甲</mark>**<mark data-k="a">乙</mark>\n\n排除 <!--k- a-->\n\n末块 <!--k a s=blocks-->'
    );
    const original = view.state.doc;
    const html = view.serializeForClipboard(original.slice(0, original.content.size)).dom.innerHTML;
    const paste = () => {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 1)));
      view.pasteHTML(html);
    };
    paste();
    const covered = markedText(view.state.doc);
    expect(covered.a).toBe('甲乙');
    expect(Object.values(covered)).toEqual(['甲乙', '甲乙']);
    const copiedId = Object.keys(covered).find(id => id !== 'a')!;
    const entries = blockMarks(view.state.doc);
    expect(entries.filter(([, id]) => id === copiedId)).toHaveLength(3);
    expect(markedText(parse(serialize()))).toEqual(covered);
    paste();
    expect(Object.values(markedText(view.state.doc))).toEqual(['甲乙', '甲乙', '甲乙']);
  });

  it('同一重点的部分文字剪切再粘贴仍共用原 ID，随后复制则产生新 ID', async () => {
    const { view, serialize, parse } = await createEditor('<mark data-k="a">abc</mark>\n\n尾段');
    const values = new Map<string, string>();
    const data = {
      items: [],
      clearData: () => values.clear(),
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? ''
    } as unknown as DataTransfer;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 3)));
    view.dom.dispatchEvent(new ClipboardEvent('cut', { clipboardData: data }));
    expect(view.state.doc.textContent).toBe('ac尾段');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 1)));
    view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data }));
    expect(markedText(view.state.doc)).toEqual({ a: 'acb' });
    expect(markedText(parse(serialize()))).toEqual({ a: 'acb' });
    view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data }));
    expect(Object.values(markedText(view.state.doc)).sort()).toEqual(['acb', 'b']);
  });

  it('仅复制排除块不把副本继续关联原章节；拖动部分文字保留原重点 ID', async () => {
    const { view } = await createEditor(
      '## 章节 <!--k a s=section-->\n\n排除 <!--k- a-->\n\n<mark data-k="m">abc</mark>'
    );
    const headingSize = view.state.doc.child(0).nodeSize;
    const excludedSize = view.state.doc.child(1).nodeSize;
    const html = view.serializeForClipboard(view.state.doc.slice(headingSize, headingSize + excludedSize)).dom
      .innerHTML;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 1)));
    view.pasteHTML(html);
    expect(blockMarks(view.state.doc).map(([, id]) => id)).toEqual(['a', 'a']);
    let from = -1;
    view.state.doc.descendants((node, position) => {
      if (node.isText && node.text?.includes('abc')) from = position + 1;
    });
    const piece = view.state.doc.slice(from, from + 1);
    view.dispatch(
      view.state.tr
        .insert(headingSize + 1, piece.content)
        .delete(from + 1, from + 2)
        .setMeta('uiEvent', 'drop')
    );
    expect(markedText(view.state.doc)).toEqual({ m: 'bac' });
  });
  it('行内重点：解析成 mark，序列化逐字还原', async () => {
    const markdown = '勾股定理指出 <mark data-k="a1b2" data-t="key" data-l="core">两边平方和</mark>等于斜边平方\n';
    const { view, serialize } = await createEditor(markdown);
    expect(markedText(view.state.doc)).toEqual({ a1b2: '两边平方和' });
    const mark = view.state.doc.nodeAt(view.state.doc.textContent.indexOf('两') + 1)!.marks[0];
    expect(mark.attrs.data).toEqual({ t: 'key', l: 'core' });
    expect(serialize()).toBe(markdown);
  });

  it('与强调、链接、行内代码、高亮正确嵌套；重叠与跨格式切段', async () => {
    const { serialize } = await createEditor('前文 **加粗** [链接](https://e.com) `code` ==亮==');
    const canonical = serialize();
    const marked = insertKnowraMarks(canonical, {
      inline: [
        { id: 'a', from: canonical.indexOf('粗'), to: canonical.indexOf('粗') + 1 },
        { id: 'c', from: canonical.indexOf('code'), to: canonical.indexOf('code') + 2 },
        { id: 'd', from: canonical.indexOf('亮'), to: canonical.indexOf('亮') + 1 }
      ],
      snap: true
    });
    const reopened = await createEditor(marked);
    expect(markedText(reopened.view.state.doc)).toEqual({ a: '粗', c: 'code', d: '亮' });
    expect(reopened.serialize()).toBe(marked);
  });

  it('编辑器里给跨格式的文字加标记，写出的 HTML 合法且重开后覆盖不变', async () => {
    const { view, serialize, parse } = await createEditor('普通**粗体**和*斜体*结尾 `代码` 后');
    const type = view.state.schema.marks[KNOWRA_MARK];
    const text = view.state.doc.textContent;
    const at = (needle: string) => text.indexOf(needle) + 1;
    view.dispatch(
      view.state.tr
        .addMark(at('通'), at('斜体') + 1, type.create({ id: 'x1', data: { t: 'key' } }))
        .addMark(at('体和') + 1, at('结尾') + 2, type.create({ id: 'x2', data: { t: 'cloze' } }))
        .addMark(at('代') + 1, at('码') + 1, type.create({ id: 'x3', data: {} }))
    );
    const markdown = serialize();
    expect(parseKnowraMarks(markdown).problems).toEqual([]);
    expect(markdown).toContain('<mark data-k="x3">`代码`</mark>');
    expect(markdown).toContain('**<mark data-k="x1" data-t="key">粗体</mark>**');
    const reopened = parse(markdown);
    expect(markedText(reopened)).toEqual({ ...markedText(view.state.doc), x3: '代码' });
    expect(serialize(reopened)).toBe(markdown);
  });

  it('跨段落、跨行的选区按块按行切段，共用同一个 ID', async () => {
    const { view, serialize } = await createEditor('第一段\n\n第二段甲  \n第二段乙');
    const type = view.state.schema.marks[KNOWRA_MARK];
    view.dispatch(view.state.tr.addMark(2, view.state.doc.content.size - 1, type.create({ id: 'span', data: {} })));
    const markdown = serialize();
    expect(parseKnowraMarks(markdown).inline.map(item => item.id)).toEqual(['span', 'span', 'span']);
    expect(stripKnowraMarks(markdown)).toBe(
      serialize(view.state.tr.removeMark(0, view.state.doc.content.size, type).doc)
    );
  });

  it('块级标记：标题、列表项、段落、表格、代码块与排除挂到对应块节点', async () => {
    const source =
      '## 牛顿第二定律\n\n- 动量守恒\n- 能量守恒\n\n一段正文\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```python\nprint(1)\n```\n\n### 子节';
    const { serialize } = await createEditor(source);
    const canonical = serialize();
    const lines = canonical.split('\n');
    const line = (needle: string) => lines.findIndex(item => item.includes(needle));
    const marked = insertKnowraMarks(canonical, {
      blocks: [
        { id: 'sec', line: line('牛顿'), attrs: { s: 'section', l: 'core' } },
        { id: 'lst', line: line('动量'), attrs: { s: 'list' } },
        { id: 'blk', line: line('一段'), attrs: { s: 'blocks' } },
        { id: 'tbl', line: lines.findIndex(item => item.startsWith('|')), attrs: { s: 'blocks' } },
        { id: 'cod', line: line('```python'), attrs: { s: 'blocks' } },
        { id: 'sec', line: line('子节'), exclude: true }
      ]
    });
    const { view, serialize: again } = await createEditor(marked);
    expect(blockMarks(view.state.doc)).toEqual([
      ['heading', 'sec'],
      ['list_item', 'lst'],
      ['paragraph', 'blk'],
      ['table', 'tbl'],
      ['code_block', 'cod'],
      ['heading', 'sec']
    ]);
    expect(again()).toBe(marked);
  });

  it('代码块内范围：s=code 成为代码文字上的 mark；代码在外部被改后作为块属性原样保留', async () => {
    const source = '问题\n\n```python\nz = torch.zeros_like(y)\nw = 2\n```';
    const { serialize } = await createEditor(source);
    const canonical = serialize();
    const fence = canonical.split('\n').findIndex(item => item.startsWith('```'));
    const marked = insertKnowraMarks(canonical, {
      inline: [{ id: 'q1', from: 0, to: 2, attrs: { t: 'key' } }],
      blocks: [{ id: 'q1', line: fence, attrs: { t: 'key' }, code: { from: 4, to: 23 } }]
    });
    const opened = await createEditor(marked);
    expect(markedText(opened.view.state.doc)).toEqual({ q1: '问题torch.zeros_like(y)' });
    expect(opened.serialize()).toBe(marked);

    const stale = marked.replace('zeros_like', 'ones_like');
    const reopened = await createEditor(stale);
    expect(markedText(reopened.view.state.doc)).toEqual({ q1: '问题' });
    expect(blockMarks(reopened.view.state.doc)).toEqual([['code_block', 'q1']]);
    expect(reopened.serialize()).toBe(stale);
  });

  it('表格单元格里的行内标记', async () => {
    const { serialize } = await createEditor('| 名称 | 说明 |\n| - | - |\n| 卷积 | 提取局部特征 |');
    const canonical = serialize();
    const from = canonical.indexOf('局部');
    const marked = insertKnowraMarks(canonical, { inline: [{ id: 'cell', from, to: from + 2 }] });
    const opened = await createEditor(marked);
    expect(markedText(opened.view.state.doc)).toEqual({ cell: '局部' });
    expect(opened.serialize()).toBe(marked);
  });

  it('表格单元格里的块级标记无处可写：报告问题而不是悄悄丢掉', async () => {
    const problems: KnowraMarkProblem[] = [];
    const { view, serialize } = await createEditor('| a | b |\n| - | - |\n| 1 | 2 |', problems);
    let cell = -1;
    view.state.doc.descendants((node, position) => {
      if (cell < 0 && node.type.name === 'paragraph') cell = position;
    });
    serialize(view.state.tr.setNodeAttribute(cell, KNOWRA_BLOCKS_ATTR, [{ id: 'c1', attrs: { s: 'blocks' } }]).doc);
    expect(problems).toEqual([{ stage: 'serialize', id: 'c1', reason: 'blockUnsupported' }]);
  });

  it('没有标记时解析与序列化结果不变', async () => {
    const plain =
      '## 标题\n\n<mark>普通高亮</mark> ==高亮== <!-- 注释 -->\n\n```\n<mark data-k="x">代码里是字面</mark>\n```';
    const problems: KnowraMarkProblem[] = [];
    const { view, serialize } = await createEditor(plain, problems);
    expect(markedText(view.state.doc)).toEqual({});
    expect(blockMarks(view.state.doc)).toEqual([]);
    const reference = await createEditor(plain);
    expect(serialize()).toBe(reference.serialize());
    expect(problems).toEqual([]);
  });

  it('无法落位的标记：整篇按原文解析并报告，保存时原样写回', async () => {
    const markdown = '<div>块级 HTML <mark data-k="lost">里面</mark></div>\n\n正文\n';
    const problems: KnowraMarkProblem[] = [];
    const { view, serialize } = await createEditor(markdown, problems);
    expect(problems.map(item => item.stage)).toEqual(['parse']);
    expect(markedText(view.state.doc)).toEqual({});
    expect(serialize()).toBe(markdown);
  });

  it.each(SYNTHETIC)('随机标记往返：%s', async markdown => {
    const failures = await randomRoundTrip(markdown, 20, 7);
    expect(failures).toEqual([]);
  });

  // 真实语料：KNOWRA_MARKS_CORPUS 指向隔离目录中的 [{ id, md, marks }]（只读副本，marks 为迁移预演结果），不设置时跳过。
  const corpusPath = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.KNOWRA_MARKS_CORPUS;
  const loadCorpus = async () => {
    const fs = (await import('node:fs' as string)) as { readFileSync(path: string, encoding: string): string };
    return JSON.parse(fs.readFileSync(corpusPath!, 'utf8')) as Array<{
      id: string;
      md: string;
      marks: Parameters<typeof insertKnowraMarks>[1];
    }>;
  };

  it.skipIf(!corpusPath)(
    '真实语料：随机标记往返稳定，覆盖不丢',
    async () => {
      const failures: string[] = [];
      for (const [index, note] of (await loadCorpus()).entries())
        failures.push(...(await randomRoundTrip(note.md, 5, index + 1)).map(item => `${note.id} ${item}`));
      expect(failures).toEqual([]);
    },
    300_000
  );

  it.skipIf(!corpusPath)(
    '真实语料：迁移预演的标记打开即落位，覆盖文字不变，再次保存稳定',
    async () => {
      const failures: string[] = [];
      let checked = 0;
      for (const note of await loadCorpus()) {
        if (!note.marks?.inline?.length && !note.marks?.blocks?.length) continue;
        const plain = await createEditor(note.md);
        if (plain.serialize() !== note.md) continue; // 编辑器会改写格式的笔记由迁移阶段处理
        // 预演按源码行插入，可能与强调交叉；编辑器打开后会规范成正确嵌套，因此按覆盖文字比较。
        const marked = insertKnowraMarks(note.md, { ...note.marks, snap: true });
        const problems: KnowraMarkProblem[] = [];
        const opened = await createEditor(marked, problems);
        const first = opened.serialize();
        const reopened = await createEditor(first, problems);
        checked += 1;
        const parsedMarks = parseKnowraMarks(marked);
        const expectedIds = new Set([
          ...parsedMarks.inline.map(item => item.id),
          ...parsedMarks.blocks.filter(item => item.code?.resolved).map(item => item.id)
        ]);
        const covered = markedText(opened.view.state.doc);
        if (problems.length) failures.push(`${note.id} 问题 ${JSON.stringify(problems).slice(0, 200)}`);
        else if (Object.keys(covered).length !== expectedIds.size) failures.push(`${note.id} 行内标记数量变化`);
        else if (JSON.stringify(markedText(reopened.view.state.doc)) !== JSON.stringify(covered))
          failures.push(`${note.id} 覆盖变化`);
        else if (reopened.serialize() !== first) failures.push(`${note.id} 再次保存不稳定`);
      }
      console.info(`迁移预演：验证 ${checked} 篇`);
      expect(checked).toBeGreaterThan(0);
      expect(failures).toEqual([]);
    },
    120_000
  );
});

const SYNTHETIC = [
  '前文 **加粗** *斜体* ~~删除~~ ==高亮== [[内部链接]] [链接](https://example.com) `code` 尾',
  '公式 $x^2$ 与金额 $5 和 $6，还有 \\*转义\\* 和 emoji 😀',
  '第一行\n第二行  \n第三行\\\n第四行',
  '# 标题 **粗** 与 ==亮==\n\n## 二级 `代码`\n\n正文段落',
  '```js\nconst a = 1;\n\nlet b;\n```\n\n后文',
  '* 列表 **一**\n  * 嵌套 ==二==\n\n1. 有序 $y$',
  '> 引用 *内容*\n> 第二行\n\n- [ ] 任务\n- [x] 完成',
  '| 名称 | 说明 |\n| - | - |\n| **卷积** | 提取 `局部` 特征 |\n| 池化 | ==降采样== |',
  '图片 ![图](https://example.com/a.png) 之后 <span>行内html</span> 结尾',
  '* 列表项\n\n    ```\n    缩进代码\n      保留相对缩进\n    ```',
  '问题段落？\n\n```\n答案第一行\n答案第二行\n```\n\n---\n\n$$\na+b\n$$'
];

/** 是否为某一行首个块：段落若是列表项、引用的第一个子节点，则与父块同行，块级标记归父块。 */
function ownsLine(doc: ProseNode, position: number) {
  const resolved = doc.resolve(position);
  for (let depth = resolved.depth; depth > 0; depth -= 1)
    if (['blockquote', 'table'].includes(resolved.node(depth).type.name)) return false;
  const parent = resolved.parent;
  return !(['list_item', 'blockquote'].includes(parent.type.name) && resolved.index() === 0);
}

/** 在文档上随机打标记 → 保存 → 重开 → 再保存：两次保存一致、无问题，原覆盖都还在（行内代码可整体扩展）。 */
async function randomRoundTrip(markdown: string, rounds: number, seed: number) {
  let state = (seed * 2654435761) >>> 0;
  const random = () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 2 ** 32;
  const failures: string[] = [];
  const serializeProblems: KnowraMarkProblem[] = [];
  // 从编辑器规范化的不动点开始（Milkdown 对文末空段落等的写出并非一次就稳定），保证重开前后结构一致、位置可比。
  let canonical = markdown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = (await createEditor(canonical)).serialize();
    if (next === canonical) break;
    canonical = next;
  }
  const base = await createEditor(canonical, serializeProblems);
  const type = base.view.state.schema.marks[KNOWRA_MARK];
  for (let round = 0; round < rounds; round += 1) {
    const tr = base.view.state.tr;
    const textblocks: Array<{ node: ProseNode; position: number }> = [];
    const blockTargets: number[] = [];
    tr.doc.descendants((node, position) => {
      if (node.isTextblock && node.content.size) textblocks.push({ node, position });
      if (
        ['heading', 'paragraph', 'list_item', 'code_block', 'table', 'hr', 'math_block'].includes(node.type.name) &&
        ownsLine(tr.doc, position) &&
        !(node.type.name === 'paragraph' && !node.content.size)
      )
        blockTargets.push(position);
      return node.type.name !== 'math_block';
    });
    let counter = 0;
    for (const { node, position } of textblocks) {
      if (random() < 0.4) continue;
      const inQuote = (() => {
        const resolved = tr.doc.resolve(position + 1);
        for (let depth = resolved.depth; depth > 0; depth -= 1)
          if (resolved.node(depth).type.name === 'blockquote') return true;
        return false;
      })();
      if (node.type.name === 'code_block' && inQuote) continue;
      const from = position + 1 + Math.floor(random() * node.content.size);
      const to = Math.min(position + 1 + node.content.size, from + 1 + Math.floor(random() * node.content.size));
      if (to > from)
        tr.addMark(
          from,
          to,
          type.create({ id: `r${round}i${(counter += 1)}`, data: { t: random() < 0.5 ? 'key' : 'key cloze' } })
        );
    }
    for (const position of blockTargets) {
      if (random() < 0.6) continue;
      const node = tr.doc.nodeAt(position)!;
      const scope = node.type.name === 'heading' ? 'section' : node.type.name === 'list_item' ? 'list' : 'blocks';
      tr.setNodeAttribute(position, KNOWRA_BLOCKS_ATTR, [
        { id: `r${round}b${(counter += 1)}`, attrs: { s: scope, l: 'core' } }
      ]);
    }
    const problems: KnowraMarkProblem[] = [];
    serializeProblems.length = 0;
    const first = base.serialize(tr.doc);
    problems.push(...serializeProblems);
    const reopened = await createEditor(first, problems);
    const second = reopened.serialize();
    const label = `第 ${round} 轮`;
    if (problems.length) {
      failures.push(`${label} 问题 ${JSON.stringify(problems).slice(0, 300)}`);
      continue;
    }
    if (second !== first) {
      let at = 0;
      while (at < first.length && first[at] === second[at]) at += 1;
      failures.push(
        `${label} 两次保存不一致 @${at} ${JSON.stringify(first.slice(Math.max(0, at - 80), at + 60))} ≠ ${JSON.stringify(second.slice(Math.max(0, at - 80), at + 60))}`
      );
      continue;
    }
    const covered = (doc: ProseNode) => {
      const set = new Set<string>();
      const code = new Set<number>();
      doc.descendants((child, at) => {
        if (!child.isText) return;
        for (let index = 0; index < child.nodeSize; index += 1) {
          if (child.marks.some(mark => mark.type.name === 'inlineCode')) code.add(at + index);
          for (const mark of child.marks) if (mark.type.name === KNOWRA_MARK) set.add(`${at + index}:${mark.attrs.id}`);
        }
      });
      return { set, code };
    };
    const before = covered(tr.doc);
    const after = covered(reopened.view.state.doc);
    // 允许的差异：行内代码整体包住；紧邻普通反斜杠的边界为避免 `\\<` 被转义而前移或前收一个反斜杠。
    const charAt = (position: number) => reopened.view.state.doc.textBetween(position, position + 1);
    const isBackslash = (item: string) => {
      const position = Number(item.split(':')[0]);
      return charAt(position) === '\\' || charAt(position - 1) === '\\';
    };
    const lost = [...before.set].filter(item => !after.set.has(item) && !isBackslash(item));
    const extra = [...after.set].filter(
      item => !before.set.has(item) && !after.code.has(Number(item.split(':')[0])) && !isBackslash(item)
    );
    if (lost.length || extra.length) {
      const sample = Number((extra[0] ?? lost[0]).split(':')[0]);
      const $pos = reopened.view.state.doc.resolve(sample);
      failures.push(
        `${label} 覆盖变化 丢失 ${lost.slice(0, 3)} 多出 ${extra.slice(0, 3)} 所在 ${$pos.parent.type.name} ${JSON.stringify($pos.parent.textContent.slice(Math.max(0, $pos.parentOffset - 20), $pos.parentOffset + 20))} 节点 ${reopened.view.state.doc.nodeAt(sample)?.type.name} ${JSON.stringify(reopened.view.state.doc.nodeAt(sample)?.marks.map(m => m.type.name))} 前后 ${JSON.stringify(first.slice(0, 0))}`
      );
    }
    const blockIds = (doc: ProseNode) =>
      blockMarks(doc)
        .map(([name, id]) => `${name}:${id}`)
        .sort();
    if (JSON.stringify(blockIds(tr.doc)) !== JSON.stringify(blockIds(reopened.view.state.doc)))
      failures.push(`${label} 块级标记变化`);
  }
  return failures;
}

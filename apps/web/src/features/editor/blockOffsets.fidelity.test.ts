import { afterEach, describe, expect, it } from 'vitest';
import { Editor, defaultValueCtx, editorViewCtx, rootCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { gfm } from '@milkdown/kit/preset/gfm';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { alignIdentityBlocks, EDITOR_TO_MARKDOWN_BLOCK, identityBlockModels, parseIdentityBlocks, sourceToBlockOffset } from '@study-accelerator/content-anchor';
import { commonmarkPreset } from './editorHardbreakMarks';
import { noteLinkSchema } from './editorNoteLinks';
import { createCodeBlockBehavior } from './editorCodeBlock';
import { mathBlockSchema } from './editorMathBlock';
import { mathInlineSchema } from './editorMathInline';
import { mathInlineGuardRemark, mathRemark } from './editorMathMarkdown';
import { highlightRemark, highlightSchema } from './editorHighlight';
import { internalLinkRemark, internalLinkSchema } from './editorInternalLink';
import { configureImageSize } from './editorImageBehavior';

const globals = globalThis as Record<string, unknown>;
globals.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

const destroyers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const destroy of destroyers.splice(0)) await destroy(); });

/** 与 MilkdownNoteEditor 相同的 schema 与 remark 链（只取影响文档结构的部分）。 */
async function loadDoc(markdown: string): Promise<ProseNode> {
  const root = document.createElement('div');
  document.body.append(root);
  const editor = await Editor.make().config(ctx => {
    configureImageSize(ctx);
    ctx.set(rootCtx, root);
    ctx.set(defaultValueCtx, markdown);
    ctx.update(remarkStringifyOptionsCtx, options => options);
  }).use(commonmarkPreset).use(noteLinkSchema).use(createCodeBlockBehavior(() => {})).use(gfm)
    .use(mathRemark).use(mathInlineGuardRemark).use(mathBlockSchema).use(mathInlineSchema)
    .use(highlightRemark).use(highlightSchema).use(internalLinkRemark).use(internalLinkSchema)
    .create();
  destroyers.push(async () => { await editor.destroy(); root.remove(); });
  return editor.ctx.get(editorViewCtx).state.doc;
}

interface Mismatch { block: number; type: string; reason: string }

/** 返回 [检查的文本块数, 不一致列表]。 */
export function compareModels(doc: ProseNode, markdown: string): [number, Mismatch[]] {
  const entries: Array<{ node: ProseNode; type: string; empty: boolean; id: string }> = [];
  doc.descendants(node => {
    const type = EDITOR_TO_MARKDOWN_BLOCK[node.type.name];
    if (type) entries.push({ node, type, empty: node.type.name === 'paragraph' && node.content.size === 0, id: String(entries.length) });
    return node.type.name !== 'table';
  });
  const alignment = alignIdentityBlocks(parseIdentityBlocks(markdown), entries);
  if (!alignment.aligned) return [0, [{ block: -1, type: 'document', reason: 'alignFailed' }]];
  const models = identityBlockModels(markdown);
  const mismatches: Mismatch[] = [];
  let checked = 0;
  const checkInline = (block: number, type: string, content: ProseNode, model: { size: number; start: Array<number | null>; end: Array<number | null> } | null) => {
    if (!model) return void mismatches.push({ block, type, reason: 'noModel' });
    checked += 1;
    if (content.content.size !== model.size) return void mismatches.push({ block, type, reason: `size ${content.content.size}≠${model.size}` });
    for (const edge of ['start', 'end'] as const) for (let i = 0; i <= model.size; i += 1) {
      const source = model[edge][i];
      if (source != null && sourceToBlockOffset(model, source, edge) !== i) mismatches.push({ block, type, reason: `${edge} roundtrip@${i}` });
    }
    let offset = 0;
    const walk = (node: ProseNode) => {
      node.forEach(child => {
        if (child.isText) {
          for (let i = 0; i < child.text!.length; i += 1) {
            const expected = child.text![i];
            const at = model.start[offset + i];
            const end = model.end[offset + i + 1];
            if (end == null || markdown[end - 1] !== expected) mismatches.push({ block, type, reason: `endChar@${offset + i}` });
            if (at === null || at === undefined || markdown[at] !== expected) mismatches.push({ block, type, reason: `char@${offset + i} 编辑器「${expected}」源码「${at == null ? '∅' : markdown[at]}」` });
          }
          offset += child.text!.length;
        } else if (child.isLeaf) offset += 1;
        else { offset += 1; walk(child); offset += 1; }
      });
    };
    walk(content);
  };
  for (const [editorIndex, markdownIndex] of alignment.pairs) {
    const { node, type } = entries[editorIndex];
    const model = models[markdownIndex];
    if (['paragraph', 'heading', 'code'].includes(type)) checkInline(markdownIndex, type, node, model as never);
    else if (type === 'table') {
      if (!model || !('rows' in model)) { mismatches.push({ block: markdownIndex, type, reason: 'noModel' }); continue; }
      node.forEach((row, _o, r) => row.forEach((cell, _c, c) => checkInline(markdownIndex, `cell${r}.${c}`, cell.firstChild!, model.rows[r]?.[c] ?? null)));
    }
  }
  return [checked, mismatches];
}

const synthetic = [
  '前文 **加粗** *斜体* ~~删除~~ ==高亮== [[内部链接]] [链接](https://example.com) `code` 尾',
  '公式 $x^2$ 与 $$a+b$$ 以及金额 $5 和 $6，还有 \\*转义\\* 和 emoji 😀',
  '第一行\n第二行  \n第三行\\\n第四行',
  '# 标题 **粗** 与 ==亮==\n\n## 二级 `代码`',
  '```js\nconst a = 1;\n\nlet b;\n```',
  '* 列表 **一**\n  * 嵌套 ==二==\n\n1. 有序 $y$',
  '> 引用 *内容*\n> 第二行',
  '| 名称 | 说明 |\n| - | - |\n| **卷积** | 提取 `局部` 特征 |\n| 池化 | ==降采样== |',
  '图片 ![图](https://example.com/a.png) 之后 <span>行内html</span> 结尾',
  '* 列表项\n\n    ```\n    缩进代码\n      保留相对缩进\n    ```',
  '段落里<br />换行',
  'a\\*b 与 **粗**尾和 *斜*尾，emoji 😀',
  '> a\n> b\n> c',
  '> ```\n> a\n> b\n> ```',
  '<div>块级 HTML</div>\n\n之后的段落 <span>行内</span>',
  '| <br /> | 表头 |\n| - | - |\n| 单元格<br />换行 | 值 |'
];

describe('块内偏移模型与编辑器一致', () => {
  it.each(synthetic)('合成：%s', async markdown => {
    const doc = await loadDoc(markdown);
    const [checked, mismatches] = compareModels(doc, markdown);
    expect(checked).toBeGreaterThan(0);
    expect(mismatches).toEqual([]);
  });

  it.each(['正文[^1]\n\n[^1]: 脚注', 'a &amp; b', 'a &#42; b', '&amp;', '&#42;'])('不支持的语法如实报告为无模型：%s', async markdown => {
    const [, mismatches] = compareModels(await loadDoc(markdown), markdown);
    expect(mismatches.some(item => item.reason === 'noModel')).toBe(true);
  });

  // 真实语料：S0_CORPUS 指向隔离目录中的 notes.json（只读副本），不设置时跳过。
  const corpusPath = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.S0_CORPUS;
  it.skipIf(!corpusPath)('真实语料逐字符一致', async () => {
    const fs = await import('node:fs' as string) as { readFileSync(path: string, encoding: string): string };
    const notes = JSON.parse(fs.readFileSync(corpusPath!, 'utf8')) as Array<{ id: string; md: string }>;
    let checked = 0;
    const report: Record<string, number> = {};
    const samples: string[] = [];
    for (const note of notes) {
      const [count, mismatches] = compareModels(await loadDoc(note.md), note.md);
      checked += count;
      for (const item of mismatches) {
        const key = item.reason.replace(/@\d+.*$/, '').replace(/ \d+≠\d+/, '');
        report[key] = (report[key] ?? 0) + 1;
        if (samples.length < 15) samples.push(`${note.id.slice(0, 24)} #${item.block} ${item.type} ${item.reason}`);
      }
    }
    console.log(JSON.stringify({ notes: notes.length, checked, report, samples }, null, 1));
    expect(checked).toBeGreaterThan(0);
    expect(report).toEqual({});
  }, 600_000);
});

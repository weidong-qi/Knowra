import { describe, expect, it } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import type { Annotation } from '@study-accelerator/web-core';
import { buildCreateAnnotationInput, buildUpdateAnnotationAnchorInput } from './annotationPayloads';
import { getAnnotationSelection, resolveAnnotationRange } from './editorAnnotations';
import { anchorForBlock, anchorFromProjectedRange, projectMarkdown } from '@study-accelerator/content-anchor';

const markdown = '# 章节\n\n这是一段重要结论';
const projection = projectMarkdown(markdown);
const start = projection.text.indexOf('这是一段重要结论');
const anchor = anchorFromProjectedRange(projection, start, start + '这是一段重要结论'.length);
const selection = {
  quoteText: '这是一段重要结论',
  fromPosition: 5,
  toPosition: 14,
  prefixText: '前文',
  suffixText: '后文',
  headingPath: ['章节', '结论'],
  scopeType: 'selection' as const,
  anchor
};

describe('editor annotation inputs', () => {
  it('anchors a duplicated code block to its Markdown block and renders only inside that block', () => {
    const duplicatedMarkdown = '测试测试测试\n\n```\n测试\n测试\n测试\n```';
    const schema = new Schema({ nodes: {
      doc: { content: 'block+' },
      paragraph: { content: 'text*', group: 'block' },
      code_block: { content: 'text*', group: 'block', code: true },
      text: { group: 'inline' }
    } });
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('测试测试测试')),
      schema.node('code_block', null, schema.text('测试\n测试\n测试'))
    ]);
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 9) });
    const editor = { ctx: { get: () => ({ state }) } } as unknown as Parameters<typeof getAnnotationSelection>[0];
    const selected = getAnnotationSelection(editor, duplicatedMarkdown, 'blocks');
    const projection = projectMarkdown(duplicatedMarkdown);
    const codeBlock = anchorForBlock(projection, projection.blocks.findIndex(block => block.type === 'code'));
    expect(selected?.anchor).toEqual(codeBlock);
    expect(selected?.anchor.structurePath).toBe('1');

    // 旧版累计字符位置可能落在上方段落末尾，且重复内容恰好能通过文本比较。
    const shiftedAnchor = { ...codeBlock, projectedStart: 4, projectedEnd: 12 };
    const annotation = { scopeType: 'blocks', quoteText: codeBlock.quoteText, anchor: shiftedAnchor } as Annotation;
    expect(doc.textBetween(5, 14, '\n', '\uFFFC')).toBe(codeBlock.quoteText);
    expect(resolveAnnotationRange(doc, annotation)).toEqual({ from: 9, to: 17 });
  });

  it('uses the structural position when identical code blocks repeat and otherwise leaves ambiguity unresolved', () => {
    const code = '测试\n测试\n测试';
    const markdown = `\`\`\`\n${code}\n\`\`\`\n\n\`\`\`\n${code}\n\`\`\``;
    const schema = new Schema({ nodes: {
      doc: { content: 'block+' },
      code_block: { content: 'text*', group: 'block', code: true },
      text: { group: 'inline' }
    } });
    const doc = schema.node('doc', null, [
      schema.node('code_block', null, schema.text(code)),
      schema.node('code_block', null, schema.text(code))
    ]);
    const projection = projectMarkdown(markdown);
    const secondAnchor = anchorForBlock(projection, projection.blocks.findIndex(block => block.type === 'code') + 1);
    const second = { scopeType: 'blocks', quoteText: code, anchor: secondAnchor } as Annotation;
    expect(resolveAnnotationRange(doc, second)).toEqual({ from: 11, to: 19 });
    const ambiguous = {
      ...second,
      anchor: { ...secondAnchor, structurePath: '2', segments: secondAnchor.segments.map(segment => ({ ...segment, path: '2' })) }
    } as Annotation;
    expect(resolveAnnotationRange(doc, ambiguous)).toBeNull();
  });

  it('does not mistake a paragraph block anchor for a code block with the same text', () => {
    const duplicatedMarkdown = '测试\n\n```\n测试\n```';
    const schema = new Schema({ nodes: {
      doc: { content: 'block+' },
      paragraph: { content: 'text*', group: 'block' },
      code_block: { content: 'text*', group: 'block', code: true },
      text: { group: 'inline' }
    } });
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('测试')), schema.node('code_block', null, schema.text('测试'))]);
    const projection = projectMarkdown(duplicatedMarkdown);
    const paragraphAnchor = anchorFromProjectedRange(projection, 0, 2, { scopeType: 'blocks' });
    expect(paragraphAnchor.structurePath).toBe('0.0');
    const paragraph = { scopeType: 'blocks', quoteText: '测试', anchor: paragraphAnchor } as Annotation;
    expect(resolveAnnotationRange(doc, paragraph)).toEqual({ from: 0, to: 4 });
  });

  it('keeps identical code blocks distinct inside a blockquote', () => {
    const nestedMarkdown = '> ```\n> 测试\n> ```\n>\n> ```\n> 测试\n> ```';
    const schema = new Schema({ nodes: {
      doc: { content: 'block+' },
      blockquote: { content: 'block+', group: 'block' },
      code_block: { content: 'text*', group: 'block', code: true },
      text: { group: 'inline' }
    } });
    const doc = schema.node('doc', null, schema.node('blockquote', null, [
      schema.node('code_block', null, schema.text('测试')),
      schema.node('code_block', null, schema.text('测试'))
    ]));
    const projection = projectMarkdown(nestedMarkdown);
    const secondIndex = projection.blocks.findIndex(block => block.type === 'code' && block.path === '0.1');
    const second = { scopeType: 'blocks', quoteText: '测试', anchor: anchorForBlock(projection, secondIndex) } as Annotation;
    expect(resolveAnnotationRange(doc, second)).toEqual({ from: 6, to: 8 });
  });

  it('creates stable content and anchor hashes for the backend contract', async () => {
    const input = await buildCreateAnnotationInput(
      { id: 'note-1', spaceId: 'space-1' },
      markdown,
      selection
    );

    expect(input).toMatchObject({
      noteId: 'note-1', spaceId: 'space-1', quoteText: selection.quoteText,
      kind: 'important', importance: 'normal', sourceMode: 'manual'
    });
    expect(input.noteContentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(input.anchorFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(input.idempotencyKey).toBeTruthy();
  });

  it('rebuilds a complete anchor payload when a selection is relocated', async () => {
    const input = await buildUpdateAnnotationAnchorInput(markdown, selection, 2);
    expect(input).toMatchObject(selection);
    expect(input.noteContentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(input.anchorFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects annotation creation when the note has no workspace id', async () => {
    await expect(buildCreateAnnotationInput({ id: 'note-1' }, '正文', selection))
      .rejects.toThrow('当前笔记缺少空间信息');
  });
});

it('resolves a tracked block after an empty paragraph without inheriting its duplicate', () => {
  const schema = new Schema({ nodes: { doc: { content: 'block+' }, paragraph: { group: 'block', content: 'text*' }, text: {} } });
  const p = (text = '') => schema.node('paragraph', null, text ? [schema.text(text)] : []);
  const doc = schema.node('doc', null, [p(), p('重要文字'), p('重要文字')]);
  const annotation = { scopeType: 'blocks', quoteText: '重要文字', anchor: { structurePath: '1.0', segments: [], tracking: { formatVersion: 1 } } } as unknown as Annotation;
  expect(resolveAnnotationRange(doc, annotation)).toEqual({ from: 3, to: 7 });
});

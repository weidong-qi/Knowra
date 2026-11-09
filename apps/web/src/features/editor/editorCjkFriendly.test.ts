import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Mark, Node as ProseNode } from '@milkdown/kit/prose/model';
import { createHeadlessNoteCodec, type HeadlessNoteCodec } from './headlessNoteCodec';

let codec: HeadlessNoteCodec;
beforeAll(async () => {
  codec = await createHeadlessNoteCodec('');
});
afterAll(async () => {
  await codec.destroy();
});

function paragraph(...children: ProseNode[]) {
  const { schema } = codec.view.state;
  return schema.node('doc', null, [schema.node('paragraph', null, children)]);
}

/** 保存后重开：写出 → 解析 → 再写出，文档与 Markdown 都不应变化。 */
function expectStableRoundTrip(doc: ProseNode) {
  const markdown = codec.serialize(doc);
  expect(markdown).not.toContain('&#x');
  const reopened = codec.parse(markdown);
  expect(reopened.toJSON()).toEqual(doc.toJSON());
  expect(codec.serialize(reopened)).toBe(markdown);
  return markdown;
}

describe('中文标点旁的行内格式', () => {
  const texts = ['小标题：', '（括号）', '“引号”', '《书名》', '结尾。', '！感叹'];
  const marks = (): Record<string, Mark> => {
    const { schema } = codec.view.state;
    return {
      strong: schema.marks.strong.create(),
      emphasis: schema.marks.emphasis.create(),
      strike: schema.marks.strike_through.create(),
      highlight: schema.marks.highlight.create(),
      inlineCode: schema.marks.inlineCode.create(),
      link: schema.marks.link.create({ href: 'https://example.com' }),
      internalLink: schema.marks.internalLink.create()
    };
  };

  it('各类格式以标点开头或结尾、外侧紧挨中文时，保存重开后保留', () => {
    const { schema } = codec.view.state;
    for (const [name, mark] of Object.entries(marks())) {
      for (const text of texts) {
        const label = `${name} ${text}`;
        expect(
          () => expectStableRoundTrip(paragraph(schema.text('前文'), schema.text(text, [mark]), schema.text('后文'))),
          label
        ).not.toThrow();
        expect(
          () => expectStableRoundTrip(paragraph(schema.text(text, [mark]), schema.text('后文'))),
          `${label} 行首`
        ).not.toThrow();
      }
    }
  });

  it('嵌套格式保存重开后保留', () => {
    const { schema } = codec.view.state;
    const { strong, emphasis, inlineCode, link, highlight } = marks();
    for (const doc of [
      paragraph(
        schema.text('前'),
        schema.text('加粗', [strong]),
        schema.text('斜体：', [strong, emphasis]),
        schema.text('正文')
      ),
      paragraph(
        schema.text('前'),
        schema.text('代码', [strong, inlineCode]),
        schema.text('：', [strong]),
        schema.text('正文')
      ),
      paragraph(schema.text('前'), schema.text('链接：', [strong, link]), schema.text('正文')),
      paragraph(schema.text('前'), schema.text('重点：', [highlight, strong]), schema.text('正文'))
    ])
      expectStableRoundTrip(doc);
  });

  it('空段落与空标题照常写出', () => {
    const { schema } = codec.view.state;
    const doc = schema.node('doc', null, [
      schema.node('heading', { level: 2 }),
      schema.node('paragraph'),
      schema.node('paragraph', null, [schema.text('~~删除：~~正文')])
    ]);
    expect(() => codec.serialize(doc)).not.toThrow();
  });

  it('已有正文中的 **小标题：**正文 直接解析为加粗', () => {
    const doc = codec.parse('**介绍数据增强：**数据增强\n');
    expect(doc.child(0).toJSON().content).toEqual([
      { type: 'text', marks: [{ type: 'strong', attrs: { marker: '*' } }], text: '介绍数据增强：' },
      { type: 'text', text: '数据增强' }
    ]);
  });
});

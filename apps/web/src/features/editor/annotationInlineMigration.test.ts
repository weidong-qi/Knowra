import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applySourceEdit,
  anchorForBlock,
  anchorForListItem,
  anchorForSection,
  anchorFromProjectedRange,
  projectMarkdown,
  type ContentAnchor
} from '@study-accelerator/content-anchor';
import { parseKnowraMarks } from '@study-accelerator/shared/knowra-marks';
import type { Annotation } from '@study-accelerator/web-core';
import {
  migrationBaseMarkId,
  migrationSourceEdits,
  planNoteMigration,
  type MigrationCodec
} from './annotationInlineMigration';
import { createMigrationCodec } from './annotationInlineMigration.testing';

let codec: MigrationCodec & { destroy(): Promise<void> };
beforeAll(async () => {
  codec = await createMigrationCodec();
});
afterAll(async () => {
  await codec.destroy();
});

const annotation = (id: string, anchor: ContentAnchor, extra: Partial<Annotation> = {}) =>
  ({
    id,
    schemaVersion: 2,
    scopeType: anchor.scopeType,
    anchor,
    quoteText: anchor.quoteText,
    kind: 'important',
    importance: 'normal',
    lifecycleStatus: 'active',
    anchorStatus: 'resolved',
    status: 'active',
    ...extra
  }) as unknown as Annotation;

const NOTE =
  [
    '## 第一章',
    '',
    '勾股定理指出两边平方和等于斜边平方。',
    '',
    '- 动量守恒',
    '- 能量守恒',
    '',
    '1、如何创建全 0 张量？',
    '',
    '```python',
    'z = torch.zeros_like(y)',
    '```',
    '',
    '### 子节',
    '',
    '子节正文'
  ].join('\n') + '\n';

describe('旧重点迁移为正文标记', () => {
  it('选区、章节、列表、整块与代码块重点都按当前显示位置写成标记，自检无问题', async () => {
    const markdown = codec.serialize(codec.parse(NOTE));
    const projection = projectMarkdown(markdown);
    const start = projection.text.indexOf('两边平方和');
    const codeStart = projection.text.indexOf('如何创建');
    const codeEnd = projection.text.indexOf('zeros_like(y)') + 'zeros_like(y)'.length;
    const listPath = projection.listItems[1].path;
    const codeBlockIndex = projection.blocks.findIndex(block => block.type === 'code');
    const annotations = [
      annotation('sel', anchorFromProjectedRange(projection, start, start + 5), { importance: 'core' }),
      annotation('sec', anchorForSection(projection, 0), { kind: 'pitfall' }),
      annotation('lst', anchorForListItem(projection, listPath)),
      annotation('cross', anchorFromProjectedRange(projection, codeStart, codeEnd)),
      annotation('blk', anchorForBlock(projection, codeBlockIndex)),
      annotation('gone', anchorForSection(projection, 1), { lifecycleStatus: 'deleted' }),
      annotation('review', anchorForSection(projection, 1), { anchorStatus: 'needsReview' })
    ];
    const plan = planNoteMigration({ markdown, annotations }, codec);
    expect(plan.issues).toEqual([]);
    expect(plan.rewritesFormat).toBe(false);
    const byId = Object.fromEntries(plan.outcomes.map(item => [item.annotationId, item]));
    expect(byId.sel).toMatchObject({ status: 'migrated', placedText: '两边平方和' });
    expect(byId.sec).toMatchObject({ status: 'migrated', placedText: '第一章' });
    expect(byId.lst).toMatchObject({ status: 'migrated', placedText: '能量守恒' });
    expect(byId.cross.status).toBe('migrated');
    expect(byId.blk.status).toBe('migrated');
    expect(byId.gone).toMatchObject({ status: 'skipped', reason: '已取消，不迁移' });
    expect(byId.review.status).toBe('unplaced');

    const parsed = parseKnowraMarks(plan.markdown);
    expect(parsed.problems).toEqual([]);
    const selMark = parsed.inline.find(item => item.id === byId.sel.markId)!;
    expect(selMark.attrs).toMatchObject({ t: 'key', l: 'core' });
    const section = parsed.blocks.find(item => item.id === byId.sec.markId)!;
    expect(section.attrs).toMatchObject({ s: 'section', c: 'pitfall' });
    // 跨段落与代码块的选区：段落部分是 <mark>，代码部分是 s=code。
    expect(parsed.inline.some(item => item.id === byId.cross.markId)).toBe(true);
    expect(parsed.blocks.find(item => item.id === byId.cross.markId)?.code?.text).toBe('z = torch.zeros_like(y)');
    expect(parsed.blocks.find(item => item.id === byId.blk.markId)?.attrs.s).toBe('blocks');
  });

  it('同一份输入迁移结果确定；已迁移的正文再跑一次不重复打标记', async () => {
    const markdown = codec.serialize(codec.parse(NOTE));
    const projection = projectMarkdown(markdown);
    const start = projection.text.indexOf('能量');
    const annotations = [annotation('one', anchorFromProjectedRange(projection, start, start + 2))];
    const first = planNoteMigration({ markdown, annotations }, codec);
    expect(planNoteMigration({ markdown, annotations }, codec).markdown).toBe(first.markdown);
    const again = planNoteMigration({ markdown: first.markdown, annotations: [] }, codec);
    expect(again.markdown).toBe(first.markdown);
    expect(again.issues).toEqual([]);
    // 中断后续跑：同一批旧重点再跑一次，正文已有对应标记，视为已迁移且不重复写入。
    const resumed = planNoteMigration({ markdown: first.markdown, annotations }, codec);
    expect(resumed.markdown).toBe(first.markdown);
    expect(resumed.outcomes[0]).toMatchObject({
      status: 'migrated',
      method: 'existing',
      markId: first.outcomes[0].markId
    });
  });

  it('章节的局部排除写成 <!--k- id-->', async () => {
    const markdown = codec.serialize(codec.parse(NOTE));
    const projection = projectMarkdown(markdown);
    const section = annotation('sec', anchorForSection(projection, 0));
    const listIndex = projection.blocks.findIndex(block => block.type === 'list');
    const exclusionAnchor = anchorForBlock(projection, listIndex >= 0 ? listIndex : 2);
    const plan = planNoteMigration(
      {
        markdown,
        annotations: [section],
        exclusions: [{ id: 'ex', parentAnnotationId: 'sec', status: 'active', anchor: exclusionAnchor }]
      },
      codec
    );
    expect(plan.issues).toEqual([]);
    expect(plan.excludedBlocks).toBeGreaterThan(0);
    expect(parseKnowraMarks(plan.markdown).blocks.some(item => item.exclude)).toBe(true);
  });

  it('编辑器会改写格式的笔记如实标出', async () => {
    const plan = planNoteMigration({ markdown: '* 星号列表\n* 第二项', annotations: [] }, codec);
    expect(plan.rewritesFormat).toBe(codec.serialize(codec.parse('* 星号列表\n* 第二项')) !== '* 星号列表\n* 第二项');
  });

  it('编辑器章节定位失败时按同级同名标题的序号兜底；数量对不上就放弃', async () => {
    // 真实笔记里的情况：公式块里单独一行 `=`，旧投影把它当成 Setext 标题，编辑器标题序列与投影不一致，旧链路的章节定位失败。
    const markdown = '### 原理\n\n第一段\n\n$$\na\n=\nb\n$$\n\n### 原理\n\n第二段\n';
    const projection = projectMarkdown(markdown);
    const index = projection.headings
      .map((heading, at) => (heading.title === '原理' && heading.level === 3 ? at : -1))
      .filter(at => at >= 0)
      .at(-1)!;
    expect(projection.headings.length).toBeGreaterThan(2);
    const plan = planNoteMigration(
      { markdown, annotations: [annotation('sec2', anchorForSection(projection, index))] },
      codec
    );
    expect(plan.issues).toEqual([]);
    const [outcome] = plan.outcomes;
    expect(outcome).toMatchObject({ status: 'migrated', method: 'headingTitle' });
    const reopened = codec.parse(plan.markdown);
    const marked: string[] = [];
    reopened.descendants(node => {
      if (node.attrs.knowraBlocks?.length) marked.push(node.textBetween(0, node.content.size));
    });
    expect(marked).toEqual(['原理']);
    expect(parseKnowraMarks(plan.markdown).blocks[0].line).toBe(
      plan.markdown
        .split('\n')
        .findIndex(
          (line, at, lines) =>
            line.startsWith('### 原理') && lines.slice(0, at).some(item => item.startsWith('### 原理'))
        )
    );
  });
  it('标题兜底的章节重点写入标记后可以续跑：标题后的标记注释不影响按标题对应', async () => {
    // 真实笔记里的情况：章节锚点在编辑器里定位失败，首次按标题兜底写入"### 原理 <!--k ...-->"；
    // 续跑时投影标题带上注释前的空格，编辑器节点文字没有，两边需按去空白后的标题和序号对应。
    const markdown = '### 原理\n\n第一段\n\n$$\na\n=\nb\n$$\n\n### 原理\n\n第二段\n';
    const projection = projectMarkdown(markdown);
    const old = annotation('sec2', anchorForSection(projection, projection.headings.length - 1));
    const first = planNoteMigration({ markdown, annotations: [old] }, codec);
    expect(first.issues).toEqual([]);
    expect(first.outcomes[0]).toMatchObject({ status: 'migrated', method: 'headingTitle' });
    const resumed = planNoteMigration({ markdown: first.markdown, annotations: [old] }, codec);
    expect(resumed.issues).toEqual([]);
    expect(resumed.outcomes[0]).toMatchObject({ status: 'migrated', markId: first.outcomes[0].markId });
    expect(resumed.markdown).toBe(first.markdown);
  });

  it('短哈希碰撞后续跑仍使用各自的实际标记 ID，不会把两个重点合并', () => {
    const markdown = 'alpha beta\n';
    const projection = projectMarkdown(markdown);
    const annotations = [
      annotation('annotation-01vl8', anchorFromProjectedRange(projection, 0, 5)),
      annotation('annotation-0ipd6', anchorFromProjectedRange(projection, 6, 10))
    ];
    expect(migrationBaseMarkId(annotations[0].id)).toBe(migrationBaseMarkId(annotations[1].id));
    const first = planNoteMigration({ markdown, annotations }, codec);
    expect(first.issues).toEqual([]);
    expect(new Set(first.outcomes.map(item => item.markId)).size).toBe(2);
    const resumed = planNoteMigration({ markdown: first.markdown, annotations: [...annotations].reverse() }, codec);
    expect(resumed.issues).toEqual([]);
    expect(resumed.markdown).toBe(first.markdown);
    for (const outcome of resumed.outcomes)
      expect(outcome.markId).toBe(first.outcomes.find(item => item.annotationId === outcome.annotationId)!.markId);
  });

  it('已有同名但无来源的标记不能冒充已迁移重点', () => {
    const projection = projectMarkdown('alpha beta\n');
    const old = annotation('old', anchorFromProjectedRange(projection, 6, 10));
    const existingId = migrationBaseMarkId(old.id);
    const markdown = `<mark data-k="${existingId}" data-t="key">alpha</mark> beta\n`;
    const plan = planNoteMigration({ markdown, annotations: [old] }, codec);
    expect(plan.issues).toEqual([]);
    expect(plan.outcomes[0].markId).not.toBe(existingId);
    const marks = parseKnowraMarks(plan.markdown).inline;
    expect(marks).toHaveLength(2);
    expect(marks.find(item => item.id === existingId)!.attrs['legacy-id']).toBeUndefined();
    expect(marks.find(item => item.id === plan.outcomes[0].markId)!.attrs['legacy-id']).toBe('old');
  });

  it('续跑时来源范围或属性已变化会阻止取消，不能只相信来源 ID', () => {
    const markdown = 'alpha beta\n';
    const projection = projectMarkdown(markdown);
    const old = annotation('one', anchorFromProjectedRange(projection, 0, 5));
    const first = planNoteMigration({ markdown, annotations: [old] }, codec);
    for (const changed of [
      { ...old, importance: 'core' } as Annotation,
      annotation('one', anchorFromProjectedRange(projection, 6, 10))
    ]) {
      const resumed = planNoteMigration({ markdown: first.markdown, annotations: [changed] }, codec);
      expect(resumed.issues.some(issue => issue.includes('无法安全续跑'))).toBe(true);
    }
  });

  it('位置待确认的有效排除会阻止迁移，不能静默丢弃排除范围', () => {
    const markdown = codec.serialize(codec.parse(NOTE));
    const projection = projectMarkdown(markdown);
    const old = annotation('sec', anchorForSection(projection, 0));
    const plan = planNoteMigration(
      {
        markdown,
        annotations: [old],
        exclusions: [
          {
            id: 'uncertain',
            parentAnnotationId: old.id,
            status: 'active',
            anchor: { ...anchorForBlock(projection, 1), unresolved: true }
          }
        ]
      },
      codec
    );
    expect(plan.issues).toContain('排除区间 uncertain 位置待确认，无法安全迁移');
  });
  it('公式中的旧选区不能写入标记时明确阻断，不虚报已迁移', () => {
    const markdown = codec.serialize(codec.parse('$$\nx = y\n$$\n'));
    const projection = projectMarkdown(markdown);
    const start = projection.text.indexOf('x = y');
    const plan = planNoteMigration(
      { markdown, annotations: [annotation('math', anchorFromProjectedRange(projection, start, start + 5))] },
      codec
    );
    expect(plan.issues.some(issue => issue.includes('不能保存内联标记'))).toBe(true);
    expect(plan.outcomes[0].status).toBe('skipped');
  });

  it('引用内旧章节若覆盖容器外正文，不能静默缩减成新章节范围', () => {
    const markdown = codec.serialize(codec.parse('> ## inner\n>\n> inside\n\noutside\n'));
    const projection = projectMarkdown(markdown);
    const plan = planNoteMigration(
      { markdown, annotations: [annotation('nested-section', anchorForSection(projection, 0))] },
      codec
    );
    expect(plan.issues.some(issue => issue.includes('有效范围与旧重点不一致'))).toBe(true);
  });

  it('迁移映射准确增删标记，不让标签里的原文同名字符扰乱选区身份', () => {
    const before = '<mark data-k="existing" data-t="key">alpha</mark> beta\n';
    const after =
      '<mark data-k="existing" data-t="key">alpha</mark> <mark data-k="new" data-t="key" data-legacy-id="beta-alpha">beta</mark>\n';
    const edits = migrationSourceEdits(before, after);
    expect(edits.reduce(applySourceEdit, before)).toBe(after);
    const added = migrationSourceEdits('alpha beta\n', after);
    expect(added.every(edit => edit.from === edit.to)).toBe(true);
    expect(added.reduce(applySourceEdit, 'alpha beta\n')).toBe(after);
  });
  it.each(['![outside](https://invalid.test/synthetic.png)', '---'])(
    '旧章节外延仅含非文字正文时同样阻断范围收缩：%s',
    outside => {
      const markdown = codec.serialize(codec.parse(`> ## inner\n>\n> inside\n\n${outside}\n`));
      const projection = projectMarkdown(markdown);
      const plan = planNoteMigration(
        { markdown, annotations: [annotation('leaf-section', anchorForSection(projection, 0))] },
        codec
      );
      expect(plan.issues.some(issue => issue.includes('有效范围与旧重点不一致'))).toBe(true);
    }
  );
});

import assert from 'node:assert/strict';
import { listAnnotatedRanges } from '../src/modules/ai/annotation-read-tool.ts';
import { calculateContentHash } from '../src/modules/knowledge/domain/note-version.ts';
import { knowraCheck, parseKnowraMarks } from '@study-accelerator/shared/knowra-marks';
import { inlineAnnotationSourceRanges } from '../src/modules/knowledge/application/inline-annotation-ranges.ts';
import { planHistoryRetention } from '../src/modules/knowledge/domain/history-retention.ts';
import { createEmptyLocalState } from '../src/infrastructure/local-data-schema.js';
import { pruneTouchedNoteVersions } from '../src/modules/sync/version-retention.ts';

const NOW = Date.parse('2026-10-22T12:00:00.000Z');
const OLD = '2026-10-01T12:00:00.000Z';
const codeCase = (name, body, from, selected, expected = selected, prefix = '') => ({
  name: `内联代码来源映射：${name}`,
  run() {
    const markdown = `${prefix}<!--k code1 s=code r=${from}-${from + selected.length} h=${knowraCheck(selected)}-->\n${body}`;
    assert.deepEqual(parseKnowraMarks(markdown).problems, [], '用合法且校验通过的代码标记验证来源');
    const { ranges } = inlineAnnotationSourceRanges(markdown, 'code1');
    assert.equal(ranges.map(range => markdown.slice(range.start, range.end)).join(''), expected);
  }
});
function deletedState() {
  const state = createEmptyLocalState();
  state.notes = [{ id: 'note-n', rawMarkdown: '正文' }];
  state.contentAnnotations = [
    {
      id: 'annotation-old',
      noteId: 'note-n',
      schemaVersion: 2,
      revision: 2,
      lifecycleStatus: 'deleted',
      deletedAt: OLD,
      updatedAt: OLD
    }
  ];
  state.annotationExclusions = [{ id: 'annotation-exclusion-e', parentAnnotationId: 'annotation-old' }];
  state.annotationRevisions = [
    { id: 'annotation-revision-r', annotationId: 'annotation-old', revision: 2, operation: 'deleted', createdAt: OLD }
  ];
  return state;
}

export const inlineAnnotationStorageRegressionTests = [
  ...[
    ['排除首段后读取真正保留的正文', '\n\n想保留的正文', 1],
    ['全部排除后不回退到旧摘录缓存', '', 0]
  ].map(([name, tail, count]) => ({
    name: `AI 内联重点：${name}`,
    async run() {
      const content = `## 标题 <!--k sec s=section--><!--k- sec-->${tail}`;
      const contentHash = calculateContentHash(content);
      const access = {
        verifyRead: async () => ({
          note: { id: 'note-n', spaceId: 'space-s', title: '来源' },
          version: { id: 'version-v', content },
          contentHash
        })
      };
      const repository = {
        list: () => [
          {
            id: 'annotation-sec',
            schemaVersion: 3,
            lifecycleStatus: 'active',
            anchorStatus: 'resolved',
            anchor: { markId: 'sec' },
            importance: 'core',
            quoteText: '旧缓存不可回退'
          }
        ]
      };
      const result = await listAnnotatedRanges({ access, repository, grantId: 'grant-g', args: { noteId: 'note-n' } });
      assert.equal(result.resultJson.total, count);
      assert.equal(result.resultJson.unavailableCount, 1 - count);
      assert.equal(result.sourceRefs.length, count);
      if (!count) assert.deepEqual(result.resultJson.annotations, []);
      else {
        const [annotation] = result.resultJson.annotations;
        assert.equal(annotation.text.trim(), '想保留的正文');
        assert.equal(annotation.truncated, false);
        const [ref] = result.sourceRefs;
        assert.equal(content.slice(ref.start, ref.end), annotation.text);
        assert.equal(ref.quoteHash, calculateContentHash(annotation.text));
      }
    }
  })),
  codeCase('前导空行不让 x 的偏移滑到 y', '```\n\nxy\n```', 1, 'x'),
  codeCase('多个前导空行仍计入偏移', '```\n\n\nxy\n```', 2, 'x'),
  codeCase('四反引号中的三反引号不是结束', '````\nx\n```\ny\n````', 6, 'y'),
  codeCase('不同字符的围栏是正文', '~~~~\nx\n```\ny\n~~~~', 6, 'y'),
  codeCase('未闭合围栏由语法树确定正文结尾', '```\nx\ny', 2, 'y'),
  codeCase('引用容器前缀不混入源码范围', '> ```\n> abc\n> def\n> ```', 0, 'abc\ndef'),
  codeCase('嵌套引用与列表容器', '> - ```\n>   abc\n>   def\n>   ```', 0, 'abc\ndef'),
  codeCase('列表项内的缩进围栏', '  ```\n  abc\n  def\n  ```', 0, 'abc\ndef', 'abc\ndef', '- 项目\n\n  '),
  codeCase('围栏缩进去掉部分 tab 后仍映射到 x', '  ```\n\txy\n  ```', 2, 'x'),
  codeCase('CRLF 正文保持源码位置', '```\n\r\nxy\r\n```', 2, 'x'),
  {
    name: '内联章节范围使用公式语法树，公式内的 Setext 文字不截断章节',
    run() {
      const markdown = '## Real <!--k sec s=section-->\n\nbefore\n\n$$\nx\n=\ny\n$$\n\nafter\n\n## Next\n\ntail';
      const { ranges } = inlineAnnotationSourceRanges(markdown, 'sec');
      const selected = ranges.map(range => markdown.slice(range.start, range.end)).join('');
      assert.ok(selected.includes('$$\nx\n=\ny\n$$\n\nafter'));
      assert.equal(selected.includes('Next'), false);
    }
  },
  {
    name: '内联整块范围支持公式，引用内章节不越过容器',
    run() {
      const math = '<!--k formula s=blocks-->\n$$\nx\n=\ny\n$$\n\noutside';
      const formula = inlineAnnotationSourceRanges(math, 'formula');
      assert.equal(formula.ranges.map(range => math.slice(range.start, range.end)).join(''), '$$\nx\n=\ny\n$$');
      const quoted = '> ## 引用 <!--k section s=section-->\n>\n> 内容\n\n外部正文';
      const { ranges } = inlineAnnotationSourceRanges(quoted, 'section');
      assert.equal(
        ranges.some(range => quoted.slice(range.start, range.end).includes('外部正文')),
        false
      );
    }
  },
  {
    name: '云端默认保全到期 v2 与可恢复的 v3；显式维护预演也不回收 v3',
    run() {
      const state = deletedState();
      state.contentAnnotations.push({ ...state.contentAnnotations[0], id: 'annotation-inline', schemaVersion: 3 });
      const result = pruneTouchedNoteVersions(
        state,
        [{ collection: 'notes', id: 'note-n', value: state.notes[0] }],
        NOW
      );
      assert.deepEqual(result, state);
      const preview = planHistoryRetention(state, { now: NOW, allowDeletedAnnotationPrune: true });
      assert.deepEqual([...preview.removedAnnotations], ['annotation-old']);
      assert.deepEqual([...preview.removedExclusions], ['annotation-exclusion-e']);
      assert.deepEqual([...preview.removedRevisions], ['annotation-revision-r']);
    }
  },
  ...[
    ['私有任务自由文本提及重点', { externalReferences: ['任务仍需 annotation-old 的原文'] }],
    ['显式保护的修订', { protectedRevisionIds: new Set(['annotation-revision-r']) }],
    ['私有任务只引用排除区间', { externalReferences: [{ exclusionId: 'annotation-exclusion-e' }] }]
  ].map(([name, options]) => ({
    name: `回收引用保护：${name}保留父重点、排除区间和当前修订`,
    run() {
      const state = deletedState();
      const before = structuredClone(state);
      const plan = planHistoryRetention(state, { now: NOW, allowDeletedAnnotationPrune: true, ...options });
      assert.equal(plan.removedAnnotations.size, 0);
      assert.equal(plan.removedExclusions.size, 0);
      assert.equal(plan.removedRevisions.size, 0);
      assert.deepEqual(state, before);
    }
  }))
];

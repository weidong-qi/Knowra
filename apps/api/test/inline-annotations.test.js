import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  anchorForBlock,
  anchorForSection,
  anchorForSourceRange,
  calculateContentHash,
  projectMarkdown
} from '@study-accelerator/content-anchor';
import { createKnowledgeModule } from '../src/modules/knowledge/index.ts';
import { ContentAnnotation } from '../src/modules/knowledge/domain/content-annotation.ts';
import { legacyAnnotationSourceChange } from '../src/modules/knowledge/application/content-annotation-service.ts';
import {
  inlineAnnotationId,
  inlineMarksOf,
  isMarksOnlyChange,
  planInlineAnnotations
} from '../src/modules/knowledge/application/inline-annotations.ts';
import { prepareBatchState } from '../src/modules/sync/batch-domain.ts';
import { listAnnotatedRanges } from '../src/modules/ai/annotation-read-tool.ts';
import { pruneTouchedNoteVersions } from '../src/modules/sync/version-retention.ts';
import { applyPostgresState } from '../src/modules/sync/postgres-batch.ts';
import { createEmptyLocalState } from '../src/infrastructure/local-data-schema.ts';
import { knowraCheck } from '@study-accelerator/shared/knowra-marks';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAppContext } from '../src/app.factory.ts';
import { createFileDataStore } from '../src/infrastructure/file-data-store.ts';

const SPACE = 'space-inline';
const inlineRows = (module, noteId) =>
  module.repositories.contentAnnotationRepository
    .list({ noteId, includeDeleted: true })
    .filter(item => item.schemaVersion === 3);
const revisions = (module, annotationId) =>
  module.repositories.annotationRevisionRepository
    .list()
    .filter(item => item.annotationId === annotationId)
    .map(item => item.operation);

function createNote(module, rawMarkdown) {
  return module.noteService.createNote({
    id: `note-${randomUUID()}`,
    spaceId: SPACE,
    title: `内联 ${randomUUID()}`,
    rawMarkdown
  });
}
function update(module, note, rawMarkdown) {
  return module.noteService.updateNote(note.id, { rawMarkdown, expectedUpdatedAt: note.updatedAt });
}

const BASE = [
  '## 第一章 <!--k sec1 s=section l=core-->',
  '',
  '勾股定理指出 <mark data-k="m1" data-t="key cloze" data-l="important">两边平方和</mark>等于斜边平方。',
  '',
  '- 列表项 <!--k lst1 s=list c=pitfall-->',
  '',
  `<!--k code1 t=key s=code r=0-1 h=${knowraCheck('x')}-->`,
  '```',
  'x',
  '```'
].join('\n');

export const inlineAnnotationTests = [
  {
    name: '取消重点后恢复历史版本时，逐条核对恢复后的摘录与已有证据',
    run() {
      const module = createKnowledgeModule();
      let note = createNote(module, '<mark data-k="restored">原文甲</mark>');
      const original = module.noteVersionService.listVersions({ noteId: note.id })[0].content;
      note = update(module, note, '<mark data-k="restored">改写乙</mark>');
      const { item, evidence } = module.knowledgeItemService.createCandidate({
        spaceId: SPACE,
        title: '改写后的来源',
        canonicalStatement: '改写后的来源',
        knowledgeType: 'concept',
        sourceMode: 'annotation',
        evidence: [{ sourceType: 'annotation', annotationId: inlineAnnotationId(note.id, 'restored') }]
      });
      module.knowledgeItemService.confirmItem(item.id);
      note = update(module, note, '改写乙');
      assert.equal(module.repositories.knowledgeEvidenceRepository.findById(evidence[0].id).status, 'valid');
      note = update(module, note, '<mark data-k="restored">改写乙</mark>');
      assert.equal(module.repositories.knowledgeItemRepository.findById(item.id).reviewStatus, 'confirmed');
      note = update(module, note, '改写乙');
      update(module, note, original);
      assert.equal(module.repositories.knowledgeEvidenceRepository.findById(evidence[0].id).status, 'stale');
      assert.equal(module.repositories.knowledgeItemRepository.findById(item.id).reviewStatus, 'needsRevision');
    }
  },
  {
    name: '跨文字与代码的重点仅代码范围失效时，即使摘录不变也降级证据',
    run() {
      const module = createKnowledgeModule();
      const marker = `<!--k combined s=code r=0-1 h=${knowraCheck(' ')}-->`;
      const original = `<mark data-k="combined">文字重点</mark>\n\n${marker}\n\`\`\`\n \n\`\`\``;
      let note = createNote(module, original);
      const annotationId = inlineAnnotationId(note.id, 'combined');
      const { item, evidence } = module.knowledgeItemService.createCandidate({
        spaceId: SPACE,
        title: '跨段落和代码的来源',
        canonicalStatement: '跨段落和代码的来源',
        knowledgeType: 'concept',
        sourceMode: 'annotation',
        evidence: [{ sourceType: 'annotation', annotationId }]
      });
      module.knowledgeItemService.confirmItem(item.id);
      note = update(module, note, original.replace('\n \n', '\nX\n'));
      const annotation = module.repositories.contentAnnotationRepository.findById(annotationId);
      assert.equal(annotation.quoteText, '文字重点');
      assert.equal(annotation.anchorStatus, 'needsReview');
      assert.equal(annotation.anchorReason, 'partialCodeChanged');
      assert.equal(module.repositories.knowledgeEvidenceRepository.findById(evidence[0].id).status, 'stale');
      assert.equal(module.repositories.knowledgeItemRepository.findById(item.id).reviewStatus, 'needsRevision');
      update(module, note, original);
      assert.equal(module.repositories.knowledgeEvidenceRepository.findById(evidence[0].id).status, 'valid');
      assert.equal(module.repositories.knowledgeItemRepository.findById(item.id).reviewStatus, 'needsRevision');
    }
  },
  {
    name: '历史重点缺少状态字段时按旧状态解释，不恢复已归档或待核对来源',
    run() {
      assert.deepEqual(legacyAnnotationSourceChange({ schemaVersion: 1, status: 'active' }, '原文', '改写'), {
        anchorStatus: 'needsReview',
        anchorReason: 'sourceChanged'
      });
      assert.equal(legacyAnnotationSourceChange({ schemaVersion: 1, status: 'archived' }, '原文', '改写'), null);
      assert.equal(legacyAnnotationSourceChange({ schemaVersion: 1, status: 'stale' }, '原文', '改写'), null);
      assert.deepEqual(legacyAnnotationSourceChange({ schemaVersion: 1, status: 'stale' }, '原文', ''), {
        anchorStatus: 'missing',
        anchorReason: 'sourceDeleted'
      });
    }
  },
  {
    name: '一次保存同时改变多个重点时先更新全部证据，再判断知识是否仍有可用来源',
    run() {
      const module = createKnowledgeModule();
      let note = createNote(module, '<mark data-k="b">乙一</mark> <mark data-k="a">甲一</mark>');
      const { item, evidence } = module.knowledgeItemService.createCandidate({
        spaceId: SPACE,
        title: '多个重点来源',
        canonicalStatement: '多个重点来源',
        knowledgeType: 'concept',
        sourceMode: 'annotation',
        evidence: ['b', 'a'].map(markId => ({
          sourceType: 'annotation',
          annotationId: inlineAnnotationId(note.id, markId)
        }))
      });
      module.knowledgeItemService.confirmItem(item.id);
      note = update(module, note, '<mark data-k="b">乙一</mark> <mark data-k="a">甲二</mark>');
      assert.equal(module.repositories.knowledgeItemRepository.findById(item.id).reviewStatus, 'confirmed');
      note = update(module, note, '<mark data-k="b">乙二</mark> <mark data-k="a">甲一</mark>');
      assert.equal(module.repositories.knowledgeEvidenceRepository.findById(evidence[0].id).status, 'stale');
      assert.equal(module.repositories.knowledgeEvidenceRepository.findById(evidence[1].id).status, 'valid');
      assert.equal(module.repositories.knowledgeItemRepository.findById(item.id).reviewStatus, 'confirmed');
    }
  },
  {
    name: '只调整重点范围时逐条核对标注证据，不让笔记版本证据过期',
    run() {
      const module = createKnowledgeModule();
      let note = createNote(module, '<mark data-k="scope">甲乙</mark>丙');
      const annotationId = inlineAnnotationId(note.id, 'scope');
      const { item, evidence } = module.knowledgeItemService.createCandidate({
        spaceId: SPACE,
        title: '重点来源',
        canonicalStatement: '重点来源',
        knowledgeType: 'concept',
        sourceMode: 'annotation',
        evidence: [{ sourceType: 'annotation', annotationId }]
      });
      module.knowledgeItemService.confirmItem(item.id);
      const version = module.noteVersionService.listVersions({ noteId: note.id })[0];
      const direct = module.knowledgeItemService.createCandidate({
        spaceId: SPACE,
        title: '笔记来源',
        canonicalStatement: '笔记来源',
        knowledgeType: 'concept',
        sourceMode: 'selection',
        evidence: [{ sourceType: 'noteVersion', noteVersionId: version.id }]
      });
      module.knowledgeItemService.confirmItem(direct.item.id);
      note = update(module, note, '甲<mark data-k="scope">乙</mark>丙');
      assert.equal(module.repositories.knowledgeEvidenceRepository.findById(evidence[0].id).status, 'stale');
      assert.equal(module.repositories.knowledgeEvidenceRepository.findById(direct.evidence[0].id).status, 'valid');
      assert.equal(module.repositories.knowledgeItemRepository.findById(item.id).reviewStatus, 'needsRevision');
      assert.equal(module.repositories.knowledgeItemRepository.findById(direct.item.id).reviewStatus, 'confirmed');
      update(module, note, '<mark data-k="scope">甲乙</mark>丙');
      assert.equal(module.repositories.knowledgeEvidenceRepository.findById(evidence[0].id).status, 'valid');
      assert.equal(module.repositories.knowledgeItemRepository.findById(item.id).reviewStatus, 'needsRevision');
    }
  },
  {
    name: '一次保存取消多个重点时逐个比较来源，不能混淆嵌套范围',
    run() {
      const module = createKnowledgeModule();
      const note = createNote(
        module,
        '<mark data-k="a">甲<mark data-k="b">乙</mark>丙</mark> 中 <mark data-k="c">丁</mark>'
      );
      const source = markId =>
        module.knowledgeItemService.createCandidate({
          spaceId: SPACE,
          title: `来源 ${markId}`,
          canonicalStatement: '以重点为依据',
          knowledgeType: 'concept',
          sourceMode: 'annotation',
          evidence: [{ sourceType: 'annotation', annotationId: inlineAnnotationId(note.id, markId) }]
        }).evidence[0];
      const a = source('a');
      const c = source('c');
      update(module, note, '甲新增<mark data-k="b">乙</mark>丙 中 丁');
      assert.equal(module.repositories.knowledgeEvidenceRepository.findById(a.id).status, 'stale');
      assert.equal(module.repositories.knowledgeEvidenceRepository.findById(c.id).status, 'valid');
    }
  },
  {
    name: '取消章节或多段重点并修改无关正文时，不误判来源变化',
    run() {
      const module = createKnowledgeModule();
      const cases = [
        {
          before: '# 标题 <!--k a s=section-->\n这里 **粗体**。\n\n# 其他\n末尾',
          after: '# 标题\n这里 **粗体**。\n\n# 其他\n末尾！',
          status: 'valid',
          anchorStatus: 'resolved'
        },
        {
          before: '<mark data-k="a">甲</mark>中<mark data-k="a">乙</mark>尾',
          after: '甲中乙尾！',
          status: 'valid',
          anchorStatus: 'resolved'
        },
        {
          before: '<mark data-k="a">甲<mark data-k="b">乙</mark>丙</mark>尾',
          after: '甲<mark data-k="b">乙</mark>丙尾！',
          status: 'valid',
          anchorStatus: 'resolved'
        },
        {
          before: '<mark data-k="a">甲<mark data-k="b">乙</mark>丙</mark>尾',
          after: '甲新增<mark data-k="b">乙</mark>丙尾',
          status: 'stale',
          anchorStatus: 'needsReview'
        },
        {
          before: '<mark data-k="a">甲<mark data-k="b"> </mark>乙</mark>尾',
          after: '甲<mark data-k="b"> </mark>新增乙尾',
          status: 'stale',
          anchorStatus: 'needsReview'
        },
        {
          before: '<mark data-k="a">甲</mark> <mark data-k="a">乙</mark>尾',
          after: '甲 范围外修改 乙尾',
          status: 'valid',
          anchorStatus: 'resolved'
        },
        {
          before:
            '# 标题 <!--k a s=section-->\n这里 <mark data-k="b">**粗体**</mark>。\n\n排除内容 <!--k- a-->\n\n# 其他\n末尾',
          after: '# 标题\n这里 **粗体**。\n\n排除内容已修改\n\n# 其他\n末尾！',
          status: 'valid',
          anchorStatus: 'resolved'
        },
        {
          before: '# 标题 <!--k a s=section-->\n这里 **粗体**。\n\n# 其他\n末尾',
          after: '# 标题\n这里 **改写**。\n\n# 其他\n末尾！',
          status: 'stale',
          anchorStatus: 'needsReview'
        },
        {
          before: '<mark data-k="a">甲</mark>中<mark data-k="a">乙</mark>尾',
          after: '',
          status: 'insufficient',
          anchorStatus: 'missing'
        }
      ];
      for (const test of cases) {
        const note = createNote(module, test.before);
        const annotationId = inlineAnnotationId(note.id, 'a');
        const { evidence } = module.knowledgeItemService.createCandidate({
          spaceId: SPACE,
          title: `来源 ${note.id}`,
          canonicalStatement: '以重点为来源的知识',
          knowledgeType: 'concept',
          sourceMode: 'annotation',
          evidence: [{ sourceType: 'annotation', annotationId }]
        });
        update(module, note, test.after);
        assert.equal(module.repositories.knowledgeEvidenceRepository.findById(evidence[0].id).status, test.status);
        const annotation = module.repositories.contentAnnotationRepository.findById(annotationId);
        assert.equal(annotation.lifecycleStatus, 'deleted');
        assert.equal(annotation.anchorStatus, test.anchorStatus);
      }
    }
  },
  {
    name: '只剩空重点标记时原文缺失，相关证据依据不足',
    run() {
      const module = createKnowledgeModule();
      const note = createNote(module, '<mark data-k="a">原文</mark>');
      const id = inlineAnnotationId(note.id, 'a');
      const { item, evidence } = module.knowledgeItemService.createCandidate({
        spaceId: SPACE,
        title: '空标记来源',
        canonicalStatement: '来源知识',
        knowledgeType: 'concept',
        sourceMode: 'annotation',
        evidence: [{ sourceType: 'annotation', annotationId: id }]
      });
      module.knowledgeItemService.confirmItem(item.id);
      update(module, note, '<mark data-k="a">  </mark>');
      const annotation = module.repositories.contentAnnotationRepository.findById(id);
      assert.equal(annotation.anchorStatus, 'missing');
      assert.equal(annotation.anchorReason, 'sourceDeleted');
      assert.equal(module.repositories.knowledgeEvidenceRepository.findById(evidence[0].id).status, 'insufficient');
      assert.equal(module.repositories.knowledgeItemRepository.findById(item.id).reviewStatus, 'needsRevision');
    }
  },
  {
    name: '内联重点来源证据：改写原文转待核对，清空正文转依据不足，只取消重点不影响证据',
    run() {
      const module = createKnowledgeModule();
      const evidenceFor = (note, markId) => {
        const annotationId = inlineAnnotationId(note.id, markId);
        const { evidence } = module.knowledgeItemService.createCandidate({
          spaceId: SPACE,
          title: `来源 ${markId}`,
          canonicalStatement: '以重点为来源的知识',
          knowledgeType: 'concept',
          sourceMode: 'annotation',
          evidence: [{ sourceType: 'annotation', annotationId }]
        });
        return () => module.repositories.knowledgeEvidenceRepository.findById(evidence[0].id).status;
      };
      let note = createNote(
        module,
        '前文 <mark data-k="a">甲乙</mark> 中间 <mark data-k="b">丙丁</mark> 后文 <mark data-k="c">戊己</mark>'
      );
      const [a, b, c] = ['a', 'b', 'c'].map(markId => evidenceFor(note, markId));
      note = update(module, note, '前文 <mark data-k="a">甲乙</mark> 中间 <mark data-k="b">丙丁</mark> 后文 戊己');
      assert.deepEqual([a(), b(), c()], ['valid', 'valid', 'valid'], '只删标记是取消重点');
      note = update(module, note, '前文 <mark data-k="a">甲改</mark> 中间 后文 戊己');
      assert.equal(a(), 'stale', '标记还在、摘录被改');
      assert.equal(b(), 'stale', '标记连同原文被改写：待核对，不等同于删除');
      const row = id => module.repositories.contentAnnotationRepository.findById(inlineAnnotationId(note.id, id));
      assert.equal(row('b').anchorStatus, 'needsReview');
      assert.equal(c(), 'valid');
      note = update(module, note, '');
      assert.equal(a(), 'insufficient', '正文清空：原文缺失');
      assert.equal(row('a').anchorStatus, 'missing');
    }
  },
  {
    name: '公式内未闭合围栏文字不删除公式后已有的真实重点',
    run() {
      const module = createKnowledgeModule();
      let note = createNote(module, '<mark data-k="real">正文</mark>');
      const id = inlineAnnotationId(note.id, 'real');
      note = update(module, note, `$$\n~~~x\n$$\n\n${note.rawMarkdown}`);
      assert.equal(module.repositories.contentAnnotationRepository.findById(id).lifecycleStatus, 'active');
      assert.equal(inlineRows(module, note.id).length, 1);
    }
  },
  ...[
    ['四空格缩进代码', text => `    ${text}\n`],
    ['引用内围栏代码', text => `> \`\`\`html\n> ${text}\n> \`\`\`\n`],
    ['跨行 code span', text => `前文 \`\`开头\n${text}\n结束\`\` 后文\n`],
    ['行内公式', text => `公式 $\\text{${text}}$`]
  ].map(([name, wrap]) => ({
    name: `字面标记正文编辑：${name}不派生伪重点，删除标签让知识证据及直接/间接题源过期`,
    run() {
      const module = createKnowledgeModule();
      let note = createNote(module, wrap('<mark data-k="a">literal</mark>'));
      assert.equal(inlineRows(module, note.id).length, 0);
      const version = module.noteVersionService.listVersions({ noteId: note.id })[0];
      const {
        item,
        evidence: [evidence]
      } = module.knowledgeItemService.createCandidate({
        spaceId: SPACE,
        title: '字面代码',
        canonicalStatement: '代码标签是正文的一部分',
        knowledgeType: 'concept',
        sourceMode: 'selection',
        evidence: [{ sourceType: 'noteVersion', noteVersionId: version.id }]
      });
      module.knowledgeItemService.confirmItem(item.id);
      const objective = module.learningObjectiveService.createCandidate({
        knowledgeItemId: item.id,
        objective: '能够解释代码标签',
        actionVerb: 'explain',
        cognitiveLevel: 'understand'
      });
      module.learningObjectiveService.confirmObjective(objective.id);
      const question = module.questionService.createQuestion({
        stem: '代码标签是什么？',
        referenceAnswer: '正文',
        learningObjectiveIds: [objective.id],
        sources: [
          { sourceType: 'noteVersion', sourceId: version.id },
          { sourceType: 'knowledgeEvidence', sourceId: evidence.id }
        ]
      });
      assert.equal(module.repositories.knowledgeEvidenceRepository.findById(evidence.id).status, 'valid');
      assert.deepEqual(
        question.sources.map(source => source.status),
        ['active', 'active']
      );
      const edited = wrap('literal');
      assert.equal(isMarksOnlyChange(note.rawMarkdown, edited), false);
      note = update(module, note, edited);
      assert.equal(note.rawMarkdown, edited);
      assert.equal(module.repositories.knowledgeEvidenceRepository.findById(evidence.id).status, 'stale');
      assert.deepEqual(
        module.questionService.getQuestion(question.id).sources.map(source => source.status),
        ['stale', 'stale']
      );
    }
  })),
  {
    name: '内联重点：从正文标记派生元数据行，ID 由笔记与标记 ID 确定',
    run() {
      const marks = inlineMarksOf(BASE);
      assert.deepEqual([...marks.keys()].sort(), ['code1', 'lst1', 'm1', 'sec1']);
      assert.equal(marks.get('m1').quoteText, '两边平方和');
      assert.deepEqual(marks.get('m1').headingPath, ['第一章']);
      assert.deepEqual(marks.get('m1').roles, ['key', 'cloze']);
      assert.equal(marks.get('sec1').scopeType, 'section');
      assert.equal(marks.get('sec1').quoteText, '第一章\n勾股定理指出 两边平方和等于斜边平方。\n列表项\nx');
      assert.equal(marks.get('lst1').kind, 'pitfall');
      assert.equal(marks.get('code1').quoteText, 'x');

      const module = createKnowledgeModule();
      const note = createNote(module, BASE);
      const rows = inlineRows(module, note.id);
      assert.equal(rows.length, 4);
      const m1 = rows.find(row => row.anchor.markId === 'm1');
      assert.equal(m1.id, inlineAnnotationId(note.id, 'm1'));
      assert.equal(m1.idempotencyKey, 'knowra-mark:m1');
      assert.equal(m1.importance, 'important');
      assert.equal(m1.scopeType, 'selection');
      assert.equal(m1.anchorStatus, 'resolved');
      assert.equal(m1.originSnapshot.noteVersionId, m1.noteVersionId);
      assert.deepEqual(revisions(module, m1.id), ['created']);
      assert.equal(rows.find(row => row.anchor.markId === 'sec1').importance, 'core');
    }
  },
  {
    name: '内联重点：只有元数据变化才升修订号；上方打字不重写行；删标记→删除，加回→恢复',
    run() {
      const module = createKnowledgeModule();
      let note = createNote(module, BASE);
      const id = inlineAnnotationId(note.id, 'm1');
      const before = module.repositories.contentAnnotationRepository.findById(id);

      note = update(module, note, BASE.replace('勾股定理指出', '著名的勾股定理指出'));
      const typed = module.repositories.contentAnnotationRepository.findById(id);
      assert.equal(typed.revision, before.revision);
      assert.equal(typed.updatedAt, before.updatedAt, '摘录与标题路径都没变时不重写');

      note = update(module, note, note.rawMarkdown.replace('data-l="important"', 'data-l="core"'));
      const promoted = module.repositories.contentAnnotationRepository.findById(id);
      assert.equal(promoted.importance, 'core');
      assert.equal(promoted.revision, before.revision + 1);

      note = update(module, note, note.rawMarkdown.replace('两边平方和', '两边平方之和'));
      const recached = module.repositories.contentAnnotationRepository.findById(id);
      assert.equal(recached.quoteText, '两边平方之和');
      assert.equal(recached.revision, promoted.revision, '摘录是缓存，不升修订号');

      const marked = note.rawMarkdown;
      note = update(module, note, marked.replace(/<mark data-k="m1"[^>]*>/, '').replace('</mark>', ''));
      assert.equal(module.repositories.contentAnnotationRepository.findById(id).lifecycleStatus, 'deleted');
      update(module, note, marked);
      const restored = module.repositories.contentAnnotationRepository.findById(id);
      assert.equal(restored.lifecycleStatus, 'active');
      assert.deepEqual(revisions(module, id), ['created', 'metadataUpdated', 'deleted', 'restored']);
    }
  },
  {
    name: '内联重点：无法核对的旧格式行保守降级，不影响 v3；类型等只能在正文中修改，备注可改',
    run() {
      const module = createKnowledgeModule();
      let note = createNote(module, BASE);
      const legacy = module.repositories.contentAnnotationRepository.save(
        new ContentAnnotation({
          id: `annotation-${randomUUID()}`,
          noteId: note.id,
          spaceId: SPACE,
          schemaVersion: 1,
          quoteText: '等于',
          fromPosition: 0,
          toPosition: 2,
          anchorFingerprint: 'fixture',
          noteContentHash: calculateContentHash(note.rawMarkdown),
          idempotencyKey: randomUUID()
        })
      );
      note = update(module, note, `${note.rawMarkdown}\n\n尾段`);
      for (const row of inlineRows(module, note.id)) assert.equal(row.anchorStatus, 'resolved');
      const unverified = module.repositories.contentAnnotationRepository.findById(legacy.id);
      assert.equal(unverified.revision, 2);
      assert.equal(unverified.anchorStatus, 'needsReview');

      const id = inlineAnnotationId(note.id, 'm1');
      const row = module.repositories.contentAnnotationRepository.findById(id);
      assert.throws(
        () =>
          module.contentAnnotationService.updateAnnotation(id, {
            expectedRevision: row.revision,
            importance: 'normal'
          }),
        { code: 'ANNOTATION_INLINE_TEXT_OWNED' }
      );
      assert.throws(() => module.contentAnnotationService.deleteAnnotation(id, { expectedRevision: row.revision }), {
        code: 'ANNOTATION_INLINE_TEXT_OWNED'
      });
      const commented = module.contentAnnotationService.updateAnnotation(id, {
        expectedRevision: row.revision,
        comment: '考试必考'
      });
      assert.equal(commented.comment, '考试必考');
      update(module, note, note.rawMarkdown.replace('data-l="important"', 'data-l="core"'));
      assert.equal(module.repositories.contentAnnotationRepository.findById(id).comment, '考试必考', '派生不覆盖备注');
    }
  },
  {
    name: '只改标记的保存：旧版本证据和题目来源保持有效；真正改正文仍按原规则过期',
    run() {
      const module = createKnowledgeModule();
      let note = createNote(module, '勾股定理指出两边平方和等于斜边平方。');
      const version = module.noteVersionService.listVersions({ noteId: note.id })[0];
      const {
        evidence: [evidence]
      } = module.knowledgeItemService.createCandidate({
        spaceId: SPACE,
        title: '勾股定理',
        canonicalStatement: '直角三角形两直角边平方和等于斜边平方。',
        knowledgeType: 'concept',
        sourceMode: 'selection',
        evidence: [{ sourceType: 'noteVersion', noteVersionId: version.id }]
      });
      assert.equal(evidence.status, 'valid');
      const marked = '勾股定理指出<mark data-k="m1" data-t="key">两边平方和</mark>等于斜边平方。';
      assert.equal(isMarksOnlyChange(note.rawMarkdown, marked), true);
      note = update(module, note, marked);
      assert.equal(
        module.repositories.knowledgeEvidenceRepository.findById(evidence.id).status,
        'valid',
        '打重点不让证据过期'
      );
      assert.equal(inlineRows(module, note.id).length, 1);
      update(module, note, `${marked}补充。`);
      assert.equal(
        module.repositories.knowledgeEvidenceRepository.findById(evidence.id).status,
        'stale',
        '改正文仍然过期'
      );
    }
  },
  {
    name: '纯文本、摘要与大纲去掉标记：搜索能找到被标记切开的词',
    run() {
      const module = createKnowledgeModule();
      const note = createNote(module, '## 标题 <!--k s1 s=section-->\n\n两<mark data-k="m1">边平方</mark>和');
      assert.equal(note.plainText.includes('<mark'), false);
      assert.equal(note.plainText.includes('两边平方和'), true);
      const [hit] =
        module.searchService.searchNotes({ spaceId: SPACE, query: '两边平方' }).items ??
        module.searchService.searchNotes({ spaceId: SPACE, query: '两边平方' });
      assert.equal(hit?.id, note.id);
    }
  },
  {
    name: '同步：服务端按正文补齐内联重点行；身份与标记不一致的行被拒绝',
    run() {
      const root = mkdtempSync(path.join(tmpdir(), 'knowra-inline-sync-'));
      try {
        const dataStore = createFileDataStore(path.join(root, 'data.json'));
        const module = createAppContext({ dataStore, storageRootDir: root }).modules.knowledge;
        const space = module.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
        const note = module.noteService.createNote({
          id: `note-${randomUUID()}`,
          spaceId: space.id,
          title: '同步',
          rawMarkdown: '甲乙丙'
        });
        const before = dataStore.exportSnapshot().data;
        const rawMarkdown = '甲<mark data-k="m1" data-t="key">乙</mark>丙';
        const [previous] = before.noteVersions.filter(item => item.noteId === note.id);
        const version = {
          ...previous,
          id: `version-${randomUUID()}`,
          content: rawMarkdown,
          contentHash: calculateContentHash(rawMarkdown),
          createdAt: new Date().toISOString()
        };
        const changes = [
          { collection: 'noteVersions', id: version.id, value: version },
          { collection: 'notes', id: note.id, value: { ...note, rawMarkdown, updatedAt: new Date().toISOString() } }
        ];
        const { state } = prepareBatchState(before, changes, 'demo');
        const rows = state.contentAnnotations.filter(item => item.noteId === note.id);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].id, inlineAnnotationId(note.id, 'm1'));
        assert.equal(rows[0].noteVersionId, version.id);
        assert.equal(state.annotationRevisions.filter(item => item.annotationId === rows[0].id).length, 1);

        const forged = { ...rows[0], id: 'annotation-forged' };
        assert.throws(
          () =>
            prepareBatchState(
              before,
              [...changes, { collection: 'contentAnnotations', id: forged.id, value: forged }],
              'demo'
            ),
          { code: 'ANNOTATION_INLINE_IDENTITY_INVALID' }
        );
        const consistent = prepareBatchState(
          before,
          [...changes, { collection: 'contentAnnotations', id: rows[0].id, value: rows[0] }],
          'demo'
        ).state;
        assert.equal(
          consistent.contentAnnotations.filter(item => item.noteId === note.id).length,
          1,
          '客户端已派生的同一行不会重复'
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  },
  {
    name: '内联重点：JSON 文件存储写入 v3 行，重启后通过快照校验并原样读回',
    run() {
      const root = mkdtempSync(path.join(tmpdir(), 'knowra-inline-json-'));
      try {
        const file = path.join(root, 'data.json');
        const module = createAppContext({ dataStore: createFileDataStore(file), storageRootDir: root }).modules
          .knowledge;
        const space = module.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
        const note = module.noteService.createNote({
          id: `note-${randomUUID()}`,
          spaceId: space.id,
          title: 'JSON',
          rawMarkdown: BASE
        });
        const saved = inlineRows(module, note.id);
        const reopened = createAppContext({ dataStore: createFileDataStore(file), storageRootDir: root }).modules
          .knowledge;
        assert.deepEqual(
          inlineRows(reopened, note.id)
            .map(item => [item.id, item.revision, item.quoteText])
            .sort(),
          saved.map(item => [item.id, item.revision, item.quoteText]).sort()
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  },
  {
    name: '内联重点：取消超过 7 天后 JSON 仍保留确定性行和修订，可从旧正文恢复',
    run() {
      const root = mkdtempSync(path.join(tmpdir(), 'knowra-inline-prune-'));
      try {
        const file = path.join(root, 'data.json');
        let module = createAppContext({ dataStore: createFileDataStore(file), storageRootDir: root }).modules.knowledge;
        const space = module.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
        let note = module.noteService.createNote({
          id: `note-${randomUUID()}`,
          spaceId: space.id,
          title: '回收',
          rawMarkdown: '甲<mark data-k="m1" data-t="key">乙</mark>丙'
        });
        note = module.noteService.updateNote(note.id, { rawMarkdown: '甲乙丙', expectedUpdatedAt: note.updatedAt });
        const id = inlineAnnotationId(note.id, 'm1');
        assert.equal(module.repositories.contentAnnotationRepository.findById(id).lifecycleStatus, 'deleted');
        // 模拟取消发生在 8 天前。
        const data = JSON.parse(readFileSync(file, 'utf8'));
        const old = new Date(Date.now() - 8 * 86400000).toISOString();
        for (const item of data.contentAnnotations)
          if (item.id === id) Object.assign(item, { deletedAt: old, updatedAt: old });
        writeFileSync(file, JSON.stringify(data));
        module = createAppContext({ dataStore: createFileDataStore(file), storageRootDir: root }).modules.knowledge;
        const current = module.noteService.getNote(note.id);
        module.noteService.updateNote(note.id, { rawMarkdown: '甲乙丙丁', expectedUpdatedAt: current.updatedAt });
        const reopened = createAppContext({ dataStore: createFileDataStore(file), storageRootDir: root }).modules
          .knowledge;
        assert.equal(reopened.repositories.contentAnnotationRepository.findById(id).lifecycleStatus, 'deleted');
        assert.ok(reopened.repositories.annotationRevisionRepository.list().some(item => item.annotationId === id));
        const latest = reopened.noteService.getNote(note.id);
        reopened.noteService.updateNote(note.id, {
          rawMarkdown: '甲<mark data-k="m1" data-t="key">乙</mark>丙',
          expectedUpdatedAt: latest.updatedAt
        });
        assert.equal(reopened.repositories.contentAnnotationRepository.findById(id).lifecycleStatus, 'active');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  },
  {
    name: '分析范围：v3 重点按正文标记切出片段，片段不含标签，章节排除生效，标记删除后列为未纳入',
    run() {
      const module = createKnowledgeModule();
      const markdown = [
        '## 第一章 <!--k sec1 s=section-->',
        '',
        '正文<mark data-k="m1" data-l="core">两边平方</mark>和',
        '',
        '### 子节 <!--k- sec1-->',
        '',
        '子节正文',
        '',
        '## 第二章',
        '',
        '尾段'
      ].join('\n');
      let note = createNote(module, markdown);
      const ids = ['sec1', 'm1'].map(markId => inlineAnnotationId(note.id, markId));
      const preview = module.annotationScopeService.previewAnalysisScope({
        spaceId: SPACE,
        mode: 'marked',
        annotationIds: ids
      });
      const text = preview.segments.map(segment => segment.markdown).join('|');
      assert.ok(!/<mark|<!--k/.test(text), text);
      assert.ok(text.includes('## 第一章') && text.includes('两边平方'));
      assert.ok(
        !text.includes('第二章') && !text.includes('### 子节'),
        '章节在下一个同级标题处结束，排除的子节标题不纳入'
      );
      for (const segment of preview.segments)
        assert.equal(note.rawMarkdown.slice(segment.start, segment.end), segment.markdown, '偏移可直接用于来源校验');
      assert.deepEqual(preview.omittedItems, []);

      note = update(module, note, note.rawMarkdown.replace(/<mark data-k="m1"[^>]*>/, '').replace('</mark>', ''));
      const after = module.annotationScopeService.previewAnalysisScope({
        spaceId: SPACE,
        mode: 'marked',
        annotationIds: [ids[0]]
      });
      assert.ok(after.segments.length > 0);
      const deleted = module.repositories.contentAnnotationRepository.findById(ids[1]);
      assert.equal(deleted.lifecycleStatus, 'deleted');
    }
  },
  {
    name: 'AI 重点读取：v3 重点从当前版本正文现算位置，返回不含标签的原文与可校验的来源',
    async run() {
      const module = createKnowledgeModule();
      const note = createNote(
        module,
        '甲段落\n\n乙<mark data-k="m1" data-l="core">核心内容</mark>丙\n\n丁段落 <!--k b1 s=blocks-->'
      );
      const [version] = module.noteVersionService.listVersions({ noteId: note.id });
      const access = { verifyRead: async () => ({ note, version, contentHash: version.contentHash }) };
      const result = await listAnnotatedRanges({
        access,
        repository: module.repositories.contentAnnotationRepository,
        grantId: 'g',
        args: { noteId: note.id }
      });
      assert.equal(result.resultJson.total, 2);
      assert.equal(result.resultJson.unavailableCount, 0);
      const [core, block] = result.resultJson.annotations;
      assert.equal(core.text, '核心内容');
      assert.equal(core.importance, 'core');
      assert.equal(block.text, '丁段落');
      for (const ref of result.sourceRefs) assert.ok(!/<mark|<!--k/.test(version.content.slice(ref.start, ref.end)));
    }
  },
  {
    name: '派生计划：没有标记也没有活跃 v3 行时不做任何事',
    run() {
      assert.deepEqual(
        planInlineAnnotations({ id: 'n', spaceId: SPACE, rawMarkdown: '普通正文 <mark>高亮</mark>' }, null, []),
        []
      );
    }
  }
];

export const inlineAnnotationPostgresTests = process.env.KNOWRA_SYNC_TEST_DATABASE_URL
  ? [
      {
        name: '真实 PostgreSQL：旧保存基线、嵌套重点、空标记及残留旧来源均保持安全',
        async run() {
          const { createPostgresTestDatabase } =
            await import('../../../scripts/test-support/postgres-test-database.mjs');
          const { createPostgresAppContext } = await import('../src/postgres-app.factory.js');
          const root = mkdtempSync(path.join(tmpdir(), 'knowra-review-fix-pg-'));
          let database, app;
          try {
            database = await createPostgresTestDatabase();
            app = await createPostgresAppContext({ databaseUrl: database.databaseUrl, storageRootDir: root });
            const k = app.modules.knowledge;
            const space = await k.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
            const makeNote = rawMarkdown =>
              k.noteService.createNote({ id: randomUUID(), spaceId: space.id, title: randomUUID(), rawMarkdown });
            const makeEvidence = async (note, annotationId) => {
              const { item, evidence } = await k.knowledgeItemService.createCandidate({
                spaceId: space.id,
                title: randomUUID(),
                canonicalStatement: '以正文为依据',
                knowledgeType: 'concept',
                sourceMode: 'annotation',
                evidence: [{ sourceType: 'annotation', annotationId }]
              });
              await k.knowledgeItemService.confirmItem(item.id);
              return evidence[0];
            };
            let race = await makeNote('原文');
            const oldHash = calculateContentHash(race.rawMarkdown);
            race = await k.noteService.updateNote(race.id, {
              rawMarkdown: '其他设备的新正文',
              expectedUpdatedAt: race.updatedAt
            });
            await assert.rejects(
              k.noteService.updateNote(race.id, {
                rawMarkdown: '过期草稿',
                annotationMapping: { baseContentHash: oldHash }
              }),
              { code: 'NOTE_UPDATE_CONFLICT' }
            );
            assert.equal((await k.noteService.getNote(race.id)).rawMarkdown, '其他设备的新正文');

            let nested = await makeNote('<mark data-k="outer">甲<mark data-k="inner">乙</mark>丙</mark>尾');
            const nestedId = inlineAnnotationId(nested.id, 'outer');
            const nestedEvidence = await makeEvidence(nested, nestedId);
            nested = await k.noteService.updateNote(nested.id, {
              rawMarkdown: '甲新增<mark data-k="inner">乙</mark>丙尾',
              expectedUpdatedAt: nested.updatedAt
            });
            assert.equal(
              (await k.repositories.knowledgeEvidenceRepository.findById(nestedEvidence.id)).status,
              'stale'
            );
            assert.equal((await k.contentAnnotationService.getAnnotation(nestedId)).anchorStatus, 'needsReview');

            let empty = await makeNote('<mark data-k="empty">原文</mark>');
            const emptyId = inlineAnnotationId(empty.id, 'empty');
            const emptyEvidence = await makeEvidence(empty, emptyId);
            empty = await k.noteService.updateNote(empty.id, {
              rawMarkdown: '<mark data-k="empty"></mark>',
              expectedUpdatedAt: empty.updatedAt
            });
            assert.equal(
              (await k.repositories.knowledgeEvidenceRepository.findById(emptyEvidence.id)).status,
              'insufficient'
            );
            assert.equal((await k.contentAnnotationService.getAnnotation(emptyId)).anchorStatus, 'missing');

            let restored = await makeNote('<mark data-k="restore">原文</mark>');
            const restoredId = inlineAnnotationId(restored.id, 'restore');
            const candidate = title =>
              k.knowledgeItemService.createCandidate({
                spaceId: space.id,
                title,
                canonicalStatement: title,
                knowledgeType: 'concept',
                sourceMode: 'annotation',
                evidence: [{ sourceType: 'annotation', annotationId: restoredId }]
              });
            const original = await candidate('原文来源');
            await k.knowledgeItemService.confirmItem(original.item.id);
            const withdrawn = await candidate('已撤回来源');
            await k.knowledgeItemService.retireEvidence(withdrawn.item.id, withdrawn.evidence[0].id);
            const question = await k.questionService.createQuestion({
              stem: '检查来源',
              referenceAnswer: '原文',
              sources: [{ sourceType: 'knowledgeEvidence', sourceId: original.evidence[0].id }]
            });
            restored = await k.noteService.updateNote(restored.id, {
              rawMarkdown: '<mark data-k="restore">改写</mark>',
              expectedUpdatedAt: restored.updatedAt
            });
            const changed = await candidate('改写来源');
            await k.knowledgeItemService.confirmItem(changed.item.id);
            restored = await k.noteService.updateNote(restored.id, {
              rawMarkdown: '<mark data-k="restore">原文</mark>',
              expectedUpdatedAt: restored.updatedAt
            });
            assert.equal(
              (await k.repositories.knowledgeEvidenceRepository.findById(original.evidence[0].id)).status,
              'valid'
            );
            assert.equal(
              (await k.repositories.knowledgeEvidenceRepository.findById(changed.evidence[0].id)).status,
              'stale'
            );
            assert.equal(
              (await k.repositories.knowledgeEvidenceRepository.findById(withdrawn.evidence[0].id)).applicabilityStatus,
              'withdrawn'
            );
            assert.equal(
              (await k.repositories.knowledgeItemRepository.findById(original.item.id)).reviewStatus,
              'needsRevision'
            );
            assert.equal(
              (await k.repositories.knowledgeItemRepository.findById(changed.item.id)).reviewStatus,
              'needsRevision'
            );
            assert.equal(
              (await k.repositories.questionSourceRepository.list({ questionId: question.id }))[0].status,
              'active'
            );

            let multi = await makeNote('<mark data-k="b">乙一</mark> <mark data-k="a">甲一</mark>');
            const multiCandidate = await k.knowledgeItemService.createCandidate({
              spaceId: space.id,
              title: '多个重点来源',
              canonicalStatement: '多个重点来源',
              knowledgeType: 'concept',
              sourceMode: 'annotation',
              evidence: ['b', 'a'].map(markId => ({
                sourceType: 'annotation',
                annotationId: inlineAnnotationId(multi.id, markId)
              }))
            });
            await k.knowledgeItemService.confirmItem(multiCandidate.item.id);
            multi = await k.noteService.updateNote(multi.id, {
              rawMarkdown: '<mark data-k="b">乙一</mark> <mark data-k="a">甲二</mark>',
              expectedUpdatedAt: multi.updatedAt
            });
            multi = await k.noteService.updateNote(multi.id, {
              rawMarkdown: '<mark data-k="b">乙二</mark> <mark data-k="a">甲一</mark>',
              expectedUpdatedAt: multi.updatedAt
            });
            assert.equal(
              (await k.repositories.knowledgeEvidenceRepository.findById(multiCandidate.evidence[0].id)).status,
              'stale'
            );
            assert.equal(
              (await k.repositories.knowledgeEvidenceRepository.findById(multiCandidate.evidence[1].id)).status,
              'valid'
            );
            assert.equal(
              (await k.repositories.knowledgeItemRepository.findById(multiCandidate.item.id)).reviewStatus,
              'confirmed'
            );

            let history = await makeNote('<mark data-k="history">原文甲</mark>');
            const historicalText = (await k.noteVersionService.listVersions({ noteId: history.id }))[0].content;
            history = await k.noteService.updateNote(history.id, {
              rawMarkdown: '<mark data-k="history">改写乙</mark>',
              expectedUpdatedAt: history.updatedAt
            });
            const historyEvidence = await makeEvidence(history, inlineAnnotationId(history.id, 'history'));
            history = await k.noteService.updateNote(history.id, {
              rawMarkdown: '改写乙',
              expectedUpdatedAt: history.updatedAt
            });
            await k.noteService.updateNote(history.id, {
              rawMarkdown: historicalText,
              expectedUpdatedAt: history.updatedAt
            });
            assert.equal(
              (await k.repositories.knowledgeEvidenceRepository.findById(historyEvidence.id)).status,
              'stale'
            );
            assert.equal(
              (await k.repositories.knowledgeItemRepository.findById(historyEvidence.knowledgeItemId)).reviewStatus,
              'needsRevision'
            );

            const codeMarker = `<!--k combined s=code r=0-1 h=${knowraCheck(' ')}-->`;
            const originalCode = `<mark data-k="combined">文字重点</mark>\n\n${codeMarker}\n\`\`\`\n \n\`\`\``;
            let combined = await makeNote(originalCode);
            const combinedId = inlineAnnotationId(combined.id, 'combined');
            const combinedEvidence = await makeEvidence(combined, combinedId);
            combined = await k.noteService.updateNote(combined.id, {
              rawMarkdown: originalCode.replace('\n \n', '\nX\n'),
              expectedUpdatedAt: combined.updatedAt
            });
            assert.equal((await k.contentAnnotationService.getAnnotation(combinedId)).anchorStatus, 'needsReview');
            assert.equal(
              (await k.repositories.knowledgeEvidenceRepository.findById(combinedEvidence.id)).status,
              'stale'
            );
            assert.equal(
              (await k.repositories.knowledgeItemRepository.findById(combinedEvidence.knowledgeItemId)).reviewStatus,
              'needsRevision'
            );

            let old = await makeNote('前言\n\n旧来源正文\n\n结尾');
            const [oldVersion] = await k.noteVersionService.listVersions({ noteId: old.id });
            const anchor = anchorForBlock(projectMarkdown(old.rawMarkdown), 1);
            const legacy = new ContentAnnotation({
              id: `legacy-${randomUUID()}`,
              spaceId: space.id,
              noteId: old.id,
              noteVersionId: oldVersion.id,
              schemaVersion: 2,
              scopeType: 'blocks',
              anchor: { ...anchor, noteVersionId: oldVersion.id },
              originSnapshot: {
                noteVersionId: oldVersion.id,
                contentHash: oldVersion.contentHash,
                scopeType: 'blocks',
                segments: anchor.segments,
                quoteText: anchor.quoteText,
                headingPath: []
              },
              quoteText: anchor.quoteText,
              fromPosition: anchor.sourceStart,
              toPosition: anchor.sourceEnd,
              anchorFingerprint: 'legacy',
              noteContentHash: oldVersion.contentHash,
              idempotencyKey: randomUUID()
            });
            await k.repositories.contentAnnotationRepository.save(legacy);
            const legacyEvidence = await makeEvidence(old, legacy.id);
            old = await k.noteService.updateNote(old.id, {
              rawMarkdown: '<mark data-k="lead">前言</mark>\n\n旧来源<mark data-k="inner">正文</mark>\n\n结尾',
              expectedUpdatedAt: old.updatedAt
            });
            assert.equal((await k.annotationScopeService.previewAnnotation(legacy.id)).resolution.status, 'resolved');
            old = await k.noteService.updateNote(old.id, {
              rawMarkdown: `${old.rawMarkdown}修改`,
              expectedUpdatedAt: old.updatedAt
            });
            const oldScope = await k.annotationScopeService.previewAnalysisScope({
              spaceId: space.id,
              mode: 'marked',
              annotationIds: [legacy.id]
            });
            assert.equal(oldScope.segments.map(segment => segment.markdown).join(''), '旧来源正文');
            assert.equal(
              (await k.repositories.knowledgeEvidenceRepository.findById(legacyEvidence.id)).status,
              'valid'
            );
            assert.equal(
              (await k.repositories.knowledgeItemRepository.findById(legacyEvidence.knowledgeItemId)).reviewStatus,
              'confirmed'
            );
            old = await k.noteService.updateNote(old.id, { rawMarkdown: '完全改写', expectedUpdatedAt: old.updatedAt });
            assert.equal(
              (await k.repositories.knowledgeEvidenceRepository.findById(legacyEvidence.id)).status,
              'stale'
            );
            old = await k.noteService.updateNote(old.id, { rawMarkdown: '', expectedUpdatedAt: old.updatedAt });
            assert.equal(
              (await k.repositories.knowledgeEvidenceRepository.findById(legacyEvidence.id)).status,
              'insufficient'
            );

            const sectionText =
              '前言\n\n# 标题 <!--k section-existing s=section-->\n\n保留<mark data-k="existing">内容</mark>\n\n秘密内容\n\n# 下一节\n\n结尾';
            let sectionNote = await makeNote(sectionText);
            const [sectionVersion] = await k.noteVersionService.listVersions({ noteId: sectionNote.id });
            const sectionAnchor = anchorForSection(projectMarkdown(sectionText), 0);
            const sectionRow = new ContentAnnotation({
              id: `section-${randomUUID()}`,
              spaceId: space.id,
              noteId: sectionNote.id,
              noteVersionId: sectionVersion.id,
              schemaVersion: 2,
              scopeType: 'section',
              anchor: sectionAnchor,
              originSnapshot: {
                noteVersionId: sectionVersion.id,
                contentHash: sectionVersion.contentHash,
                scopeType: 'section',
                segments: sectionAnchor.segments,
                quoteText: sectionAnchor.quoteText,
                headingPath: []
              },
              quoteText: sectionAnchor.quoteText,
              fromPosition: sectionAnchor.sourceStart,
              toPosition: sectionAnchor.sourceEnd,
              anchorFingerprint: randomUUID(),
              noteContentHash: sectionVersion.contentHash,
              idempotencyKey: randomUUID()
            });
            await k.repositories.contentAnnotationRepository.save(sectionRow);
            const sectionEvidence = await makeEvidence(sectionNote, sectionRow.id);
            const secretStart = sectionText.indexOf('秘密内容');
            await k.repositories.annotationExclusionRepository.save({
              id: randomUUID(),
              parentAnnotationId: sectionRow.id,
              noteVersionId: sectionVersion.id,
              anchor: anchorForSourceRange(projectMarkdown(sectionText), secretStart, secretStart + '秘密内容'.length),
              status: 'active',
              revision: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            });
            const sectionMarked = sectionText
              .replace('前言', '<mark data-k="lead">前言</mark>')
              .replace('秘密内容', '秘密<mark data-k="inner">内容</mark>');
            sectionNote = await k.noteService.updateNote(sectionNote.id, {
              rawMarkdown: sectionMarked,
              expectedUpdatedAt: sectionNote.updatedAt
            });
            sectionNote = await k.noteService.updateNote(sectionNote.id, {
              rawMarkdown: `${sectionNote.rawMarkdown}修改`,
              expectedUpdatedAt: sectionNote.updatedAt
            });
            assert.equal(
              (await k.repositories.knowledgeEvidenceRepository.findById(sectionEvidence.id)).status,
              'valid',
              '旧章节来源含块标记时，无关编辑不降级证据'
            );
            assert.equal(
              (await k.repositories.knowledgeItemRepository.findById(sectionEvidence.knowledgeItemId)).reviewStatus,
              'confirmed'
            );
            const sectionScope = await k.annotationScopeService.previewAnalysisScope({
              spaceId: space.id,
              mode: 'marked',
              annotationIds: [sectionRow.id]
            });
            const sectionResult = sectionScope.segments.map(segment => segment.markdown).join('');
            assert.match(sectionResult, /保留内容/);
            assert.doesNotMatch(sectionResult, /秘密|<mark/);
          } finally {
            await app?.close?.();
            await database?.close();
            rmSync(root, { recursive: true, force: true });
          }
        }
      },
      {
        name: '真实 PostgreSQL：保存时派生内联重点，只改标记不让证据过期，元数据变化升修订号',
        async run() {
          const { createPostgresTestDatabase } =
            await import('../../../scripts/test-support/postgres-test-database.mjs');
          const { createPostgresAppContext } = await import('../src/postgres-app.factory.js');
          const root = mkdtempSync(path.join(tmpdir(), 'knowra-inline-pg-'));
          let database, app;
          try {
            database = await createPostgresTestDatabase();
            app = await createPostgresAppContext({ databaseUrl: database.databaseUrl, storageRootDir: root });
            const k = app.modules.knowledge;
            const space = await k.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
            let note = await k.noteService.createNote({
              id: randomUUID(),
              spaceId: space.id,
              title: randomUUID(),
              rawMarkdown: '勾股定理指出两边平方和等于斜边平方。'
            });
            const [version] = await k.noteVersionService.listVersions({ noteId: note.id });
            const {
              evidence: [evidence]
            } = await k.knowledgeItemService.createCandidate({
              spaceId: space.id,
              title: '勾股定理',
              canonicalStatement: '直角三角形两直角边平方和等于斜边平方。',
              knowledgeType: 'concept',
              sourceMode: 'selection',
              evidence: [{ sourceType: 'noteVersion', noteVersionId: version.id }]
            });
            const marked = '勾股定理指出<mark data-k="m1" data-t="key">两边平方和</mark>等于斜边平方。';
            note = await k.noteService.updateNote(note.id, { rawMarkdown: marked, expectedUpdatedAt: note.updatedAt });
            const id = inlineAnnotationId(note.id, 'm1');
            const row = await k.contentAnnotationService.getAnnotation(id);
            assert.equal(row.schemaVersion, 3);
            assert.equal(row.quoteText, '两边平方和');
            assert.equal((await k.repositories.knowledgeEvidenceRepository.findById(evidence.id)).status, 'valid');
            note = await k.noteService.updateNote(note.id, {
              rawMarkdown: marked.replace('data-t="key"', 'data-t="key" data-l="core"'),
              expectedUpdatedAt: note.updatedAt
            });
            const promoted = await k.contentAnnotationService.getAnnotation(id);
            assert.equal(promoted.importance, 'core');
            assert.equal(promoted.revision, row.revision + 1);
            note = await k.noteService.updateNote(note.id, {
              rawMarkdown: `${note.rawMarkdown}补充。`,
              expectedUpdatedAt: note.updatedAt
            });
            assert.equal((await k.repositories.knowledgeEvidenceRepository.findById(evidence.id)).status, 'stale');
            assert.equal((await k.contentAnnotationService.getAnnotation(id)).anchorStatus, 'resolved');
          } finally {
            await app?.close?.();
            await database?.close();
            rmSync(root, { recursive: true, force: true });
          }
        }
      },
      {
        name: '真实 PostgreSQL：云端批次回收取消超过 7 天的重点，连同排除区间与修订写入删除',
        async run() {
          const { createPostgresTestDatabase } =
            await import('../../../scripts/test-support/postgres-test-database.mjs');
          const { createPostgresAppContext } = await import('../src/postgres-app.factory.js');
          const root = mkdtempSync(path.join(tmpdir(), 'knowra-inline-prune-pg-'));
          let database, app;
          try {
            database = await createPostgresTestDatabase();
            app = await createPostgresAppContext({ databaseUrl: database.databaseUrl, storageRootDir: root });
            const k = app.modules.knowledge;
            const space = await k.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
            let note = await k.noteService.createNote({
              id: randomUUID(),
              spaceId: space.id,
              title: randomUUID(),
              rawMarkdown: '甲<mark data-k="m1" data-t="key">乙</mark>丙'
            });
            note = await k.noteService.updateNote(note.id, {
              rawMarkdown: '甲乙丙',
              expectedUpdatedAt: note.updatedAt
            });
            const id = inlineAnnotationId(note.id, 'm1');
            const row = await k.contentAnnotationService.getAnnotation(id);
            assert.equal(row.lifecycleStatus, 'deleted');
            const old = new Date(Date.now() - 8 * 86400000).toISOString();
            await app.prisma.contentAnnotation.update({
              where: { id },
              data: { deletedAt: new Date(old), updatedAt: new Date(old) }
            });
            const state = {
              ...createEmptyLocalState(),
              notes: [await k.noteService.getNote(note.id)],
              noteVersions: await k.noteVersionService.listVersions({ noteId: note.id }),
              contentAnnotations: await k.repositories.contentAnnotationRepository.list({
                noteId: note.id,
                includeDeleted: true
              }),
              annotationRevisions: (await k.repositories.annotationRevisionRepository.list()).filter(
                item => item.annotationId === id
              )
            };
            const after = pruneTouchedNoteVersions(state, [
              { collection: 'notes', id: note.id, value: state.notes.find(item => item.id === note.id) }
            ]);
            assert.equal(
              after.contentAnnotations.some(item => item.id === id),
              true,
              '确定性派生行保留供旧版本恢复'
            );
            await app.prisma.$transaction(tx => applyPostgresState(tx, state, after));
            assert.equal((await app.prisma.contentAnnotation.findUnique({ where: { id } })).lifecycleStatus, 'deleted');
            assert.ok(await app.prisma.annotationRevision.count({ where: { annotationId: id } }));
            note = await k.noteService.updateNote(note.id, {
              rawMarkdown: '甲<mark data-k="m1" data-t="key">乙</mark>丙',
              expectedUpdatedAt: note.updatedAt
            });
            assert.equal((await k.contentAnnotationService.getAnnotation(id)).lifecycleStatus, 'active');
          } finally {
            await app?.close?.();
            await database?.close();
            rmSync(root, { recursive: true, force: true });
          }
        }
      }
    ]
  : [];

inlineAnnotationTests.push({
  name: '内联重点摘要：列表含完整子树，代码含空行，章节不溢出引用且排除生效',
  run() {
    assert.equal(inlineMarksOf('- 父项 <!--k list s=list-->\n  - 子项\n- 相邻').get('list').quoteText, '父项\n子项');
    assert.equal(inlineMarksOf('<!--k code s=blocks-->\n```\n\n合成内容\n\n```').get('code').quoteText, '\n合成内容\n');
    assert.equal(
      inlineMarksOf('> ## Nested <!--k sec s=section-->\n>\n> Inside\n\nOutside').get('sec').quoteText,
      'Nested\nInside'
    );
    const excluded = inlineMarksOf('## Chapter <!--k sec s=section-->\n\n保留\n\n忽略 <!--k- sec-->\n\n## Next');
    assert.equal(excluded.get('sec').quoteText, 'Chapter\n保留');
  }
});

inlineAnnotationTests.push(
  ...[
    ['公式等号', 'x\n=\ny'],
    ['公式中的标题和围栏字面量', '# 不是标题\n```\nx\n~~~'],
    ['公式中的 Markdown 格式字面量', '**x** &amp; [y][ref]']
  ].map(([name, value]) => ({
    name: `内联完整摘要：${name}按公式正文保留`,
    run() {
      const markdown = `## 真标题\n\n<!--k formula s=blocks-->\n$$\n${value}\n$$\n\n<mark data-k="after">后文</mark>`;
      const marks = inlineMarksOf(markdown);
      assert.equal(marks.get('formula').quoteText, value);
      assert.deepEqual(marks.get('after').headingPath, ['真标题'], '公式字面标题不污染后续重点路径');
    }
  })),
  {
    name: '内联完整摘要：整篇解析引用链接、格式与行内公式，并按真实块排除',
    run() {
      const markdown =
        '## 章节 <!--k section s=section-->\n\nA **bold** [link][ref] with $x=y$ and &amp;.\n\n<!--k- section-->\n$$\n秘密\n=\n不要\n$$\n\n## 末章\n\n[ref]: https://example.com';
      assert.equal(inlineMarksOf(markdown).get('section').quoteText, '章节\nA bold link with x=y and &.');
    }
  },
  {
    name: '内联完整摘要：引用内整块代码和代码选区都保留前后空行与字面语法',
    run() {
      const value = '\n# 不是标题\n```\n\n';
      const range = `<!--k selected s=code r=0-${value.length} h=${knowraCheck(value)}-->`;
      const markdown = `<!--k whole s=blocks-->\n${range}\n> ~~~~\n> \n> # 不是标题\n> \`\`\`\n> \n> \n> ~~~~`;
      const marks = inlineMarksOf(markdown);
      assert.equal(marks.get('selected').quoteText, value);
      assert.equal(marks.get('whole').quoteText, value);
    }
  }
);

import assert from 'node:assert/strict';
import {
  anchorQuote,
  KNOWLEDGE_EXTRACTION_LIMITS as LIMITS,
  prepareKnowledgeExtraction,
  validateKnowledgeExtractionResult
} from '../src/modules/knowledge/application/knowledge-extraction-contract.ts';
import { createKnowledgeExtractionFixture } from './fixtures/knowledge-extraction.fixture.js';

const code = expected => error => error.code === expected;
const validate = (fixture, result = fixture.result) =>
  validateKnowledgeExtractionResult({ request: fixture.request, result });

export const knowledgeExtractionContractTests = [
  {
    name: 'AI 准备只使用保存的选区快照，不发送排除或上下文片段，提炼入口仍未开放',
    run() {
      const fixture = createKnowledgeExtractionFixture();
      assert.equal(fixture.preview.ai.available, false);
      assert.equal(fixture.request.sources.length, 2);
      assert(!JSON.stringify(fixture.request).includes(fixture.excluded));
      fixture.scope.contextSegments = [{ markdown: '仅供阅读的上下文' }];
      const same = prepareKnowledgeExtraction({ ...fixture, idempotencyKey: 'extraction-request' });
      assert.deepEqual(same, fixture.request);
      assert(!JSON.stringify(same).includes('仅供阅读的上下文'));
    }
  },
  {
    name: 'AI 合法结果只生成候选计划，候选与来源 ID 稳定且兼容人工审核领域服务',
    run() {
      const fixture = createKnowledgeExtractionFixture();
      const plan = validate(fixture);
      assert.deepEqual(validate(fixture, JSON.stringify(fixture.result)), plan);
      assert.equal(fixture.knowledge.knowledgeItemService.listItems().length, 0);
      assert.equal(plan.candidates[0].reviewStatus, 'candidate');
      const input = plan.candidates[0].candidateInput;
      assert.equal(input.sourceMode, 'ai');
      const saved = fixture.knowledge.knowledgeItemService.createCandidate(input);
      assert.equal(saved.item.reviewStatus, 'candidate');
      assert.equal(saved.evidence[0].sourceType, 'noteVersion');
      assert.equal(saved.evidence[0].noteVersionId, fixture.noteVersions[0].id);
      assert.deepEqual(fixture.knowledge.knowledgeItemService.createCandidate(input), saved);
      assert.equal(plan.candidates[0].provenance[0].start, fixture.result.candidates[0].citations[0].start);
    }
  },
  {
    name: 'AI 拒绝自动确认、直接指定资产 ID 和自造来源字段，不进行部分采纳',
    run() {
      const fixture = createKnowledgeExtractionFixture();
      for (const key of ['reviewStatus', 'id', 'sourceMode', 'evidence', 'userExplanation']) {
        const result = structuredClone(fixture.result);
        result.candidates.push({ ...result.candidates[0], [key]: 'confirmed' });
        assert.throws(() => validate(fixture, result), code('KNOWLEDGE_EXTRACTION_RESULT_INVALID'));
      }
      assert.equal(fixture.knowledge.knowledgeItemService.listItems().length, 0);
    }
  },
  {
    name: 'AI 拒绝伪造、排除范围外、改写、非整数偏移和重复引文',
    run() {
      const fixture = createKnowledgeExtractionFixture();
      for (const patch of [
        { sourceId: 'unknown-source' },
        { quote: fixture.excluded },
        { quote: '生成的非原文陈述' },
        { end: 1.5 },
        { start: '0' }
      ]) {
        const result = structuredClone(fixture.result);
        Object.assign(result.candidates[0].citations[0], patch);
        assert.throws(() => validate(fixture, result), code('KNOWLEDGE_EXTRACTION_CITATION_INVALID'));
      }
      const duplicated = structuredClone(fixture.result);
      duplicated.candidates[0].citations.push(duplicated.candidates[0].citations[0]);
      assert.throws(() => validate(fixture, duplicated), code('KNOWLEDGE_EXTRACTION_CITATION_INVALID'));
    }
  },
  {
    name: 'AI 偏移数错但 quote 逐字唯一时按 quote 重新定位；出现多次且偏移不吻合时拒绝',
    run() {
      const fixture = createKnowledgeExtractionFixture();
      const citation = fixture.result.candidates[0].citations[0];
      const source = fixture.request.sources.find(entry => entry.sourceId === citation.sourceId);
      const expected = source.start + source.markdown.indexOf(citation.quote);
      for (const patch of [
        { start: -1 },
        { end: 1_000_000 },
        { start: 0 },
        { start: citation.start + 3, end: citation.end + 3 }
      ]) {
        const result = structuredClone(fixture.result);
        Object.assign(result.candidates[0].citations[0], patch);
        const provenance = validate(fixture, result).candidates[0].provenance[0];
        assert.equal(provenance.start, expected);
        assert.equal(provenance.end, expected + citation.quote.length);
        assert.equal(provenance.quoteText, citation.quote);
      }
      const markdown = '梯度是向量。梯度是向量。另一句。';
      assert.deepEqual(anchorQuote(markdown, { start: 6, end: 12, quote: '梯度是向量。' }), { start: 6, end: 12 });
      assert.deepEqual(anchorQuote(markdown, { start: 3, end: 9, quote: '另一句。' }), { start: 12, end: 16 });
      assert.throws(
        () => anchorQuote(markdown, { start: 3, end: 9, quote: '梯度是向量。' }),
        code('KNOWLEDGE_EXTRACTION_CITATION_INVALID')
      );
      assert.throws(
        () => anchorQuote(markdown, { start: 0, end: 3, quote: '不存在' }),
        code('KNOWLEDGE_EXTRACTION_CITATION_INVALID')
      );
    }
  },
  {
    name: 'AI 引用偏移使用 UTF-16 且禁止截断 emoji 代理对',
    run() {
      const fixture = createKnowledgeExtractionFixture();
      const source = fixture.request.sources[0];
      const start = source.markdown.indexOf('😀');
      fixture.result.candidates[0].citations = [{ sourceId: source.sourceId, start, end: start + 2, quote: '😀' }];
      assert.equal(validate(fixture).candidates[0].provenance[0].quoteText, '😀');
      fixture.result.candidates[0].citations[0].end = start + 1;
      fixture.result.candidates[0].citations[0].quote = '😀'.slice(0, 1);
      assert.throws(() => validate(fixture), code('KNOWLEDGE_EXTRACTION_CITATION_INVALID'));
    }
  },
  {
    name: 'AI 请求绑定快照与幂等键，拒绝其他请求或契约版本的结果',
    run() {
      const fixture = createKnowledgeExtractionFixture();
      const other = prepareKnowledgeExtraction({ ...fixture, idempotencyKey: 'another-request' });
      assert.notEqual(other.requestId, fixture.request.requestId);
      for (const patch of [{ requestId: other.requestId }, { contractVersion: 2 }]) {
        assert.throws(
          () => validate(fixture, { ...fixture.result, ...patch }),
          code('KNOWLEDGE_EXTRACTION_REQUEST_MISMATCH')
        );
      }
      assert.throws(
        () => prepareKnowledgeExtraction({ ...fixture, scope: fixture.preview, idempotencyKey: 'preview' }),
        code('KNOWLEDGE_EXTRACTION_SCOPE_INVALID')
      );
    }
  },
  {
    name: 'AI 请求拒绝版本不存在、内容哈希不符和超出版本的选区',
    run() {
      const fixture = createKnowledgeExtractionFixture();
      const prepare = patch =>
        prepareKnowledgeExtraction({ ...fixture, idempotencyKey: 'extraction-request', ...patch });
      assert.throws(() => prepare({ noteVersions: [] }), code('KNOWLEDGE_EXTRACTION_SOURCE_MISMATCH'));
      assert.throws(
        () => prepare({ noteVersions: [{ ...fixture.noteVersions[0], content: '篡改' }] }),
        code('KNOWLEDGE_EXTRACTION_SOURCE_MISMATCH')
      );
      for (const patch of [{ noteId: 'other-note' }, { markdown: '伪造片段' }, { end: 1_000_000 }]) {
        const scope = structuredClone(fixture.scope);
        Object.assign(scope.segments[0], patch);
        assert.throws(() => prepare({ scope }), code('KNOWLEDGE_EXTRACTION_SOURCE_MISMATCH'));
      }
    }
  },
  {
    name: 'AI 使用旧快照不冒充当前来源，原文改变后入库证据待核对',
    run() {
      const fixture = createKnowledgeExtractionFixture();
      fixture.knowledge.noteService.updateNote(fixture.note.id, { rawMarkdown: '已更新为新内容' });
      const plan = validate(fixture);
      const saved = fixture.knowledge.knowledgeItemService.createCandidate(plan.candidates[0].candidateInput);
      assert.equal(saved.item.reviewStatus, 'candidate');
      assert.equal(saved.evidence[0].status, 'stale');
      assert.equal(saved.evidence[0].noteVersionId, fixture.noteVersions[0].id);
      assert.throws(
        () => fixture.knowledge.knowledgeItemService.confirmItem(saved.item.id),
        code('KNOWLEDGE_ITEM_SOURCE_REQUIRED')
      );
    }
  },
  {
    name: 'AI 无结果可以正常返回，畸形 JSON、缺字段和超限结果必须拒绝',
    run() {
      const fixture = createKnowledgeExtractionFixture();
      assert.deepEqual(validate(fixture, { ...fixture.result, candidates: [] }).candidates, []);
      for (const result of [
        '```json\n{}\n```',
        '{',
        null,
        {},
        { ...fixture.result, candidates: Array(LIMITS.candidates + 1).fill(fixture.result.candidates[0]) }
      ]) {
        assert.throws(() => validate(fixture, result), code('KNOWLEDGE_EXTRACTION_RESULT_INVALID'));
      }
      const oversized = structuredClone(fixture.result);
      oversized.candidates[0].title = '标题'.repeat(LIMITS.titleCharacters);
      assert.throws(() => validate(fixture, oversized), code('KNOWLEDGE_EXTRACTION_RESULT_INVALID'));
      assert.throws(
        () => validate(fixture, ' '.repeat(LIMITS.resultBytes + 1)),
        code('KNOWLEDGE_EXTRACTION_RESULT_TOO_LARGE')
      );
    }
  }
];

import assert from 'node:assert/strict';
import { calculateContentHash } from '@study-accelerator/content-anchor';
import { createAiGateway } from '../src/modules/ai/gateway.js';
import { createMockAiAdapter } from '../src/modules/ai/infrastructure/providers/mock-adapter.ts';
import {
  KNOWLEDGE_EXTRACTION_PROMPT_VERSION,
  prepareKnowledgeExtractionGateway,
  validateKnowledgeExtractionGatewayResult
} from '../src/modules/ai/knowledge-extraction-gateway.js';
import { createKnowledgeExtractionFixture } from './fixtures/knowledge-extraction.fixture.js';

const prepare = (fixture, extra = {}) =>
  prepareKnowledgeExtractionGateway({
    scope: fixture.scope,
    noteVersions: fixture.noteVersions,
    idempotencyKey: 'extraction-request',
    ...extra
  });
const response = (value, finishReason = 'stop', extra = {}) => ({
  id: 'synthetic-extraction-response',
  model: 'synthetic-model',
  choices: [
    {
      finish_reason: finishReason,
      message: {
        content: typeof value === 'string' ? value : JSON.stringify(value),
        ...extra
      }
    }
  ],
  usage: { prompt_tokens: 30, completion_tokens: 20 }
});
async function complete(fixture, value = fixture.result, finishReason = 'stop', extra = {}) {
  const prepared = prepare(fixture);
  const adapter = createMockAiAdapter({ steps: [{ response: response(value, finishReason, extra) }] });
  const result = await createAiGateway({ adapter }).complete(prepared.gatewayRequest);
  return { prepared, adapter, result };
}
const validate = ({ prepared, result }) =>
  validateKnowledgeExtractionGatewayResult({
    extractionRequest: prepared.extractionRequest,
    result
  });

export const aiKnowledgeExtractionGatewayTests = [
  {
    name: 'P3 提炼 Gateway：真实范围服务→Mock Gateway→v1 候选计划保留来源与契约边界',
    async run() {
      const fixture = createKnowledgeExtractionFixture();
      fixture.scope.contextSegments = [{ markdown: '仅供理解的上下文，不得发送。' }];
      const { prepared, adapter, result } = await complete(fixture);
      const outbound = JSON.parse(adapter.calls[0].messages[1].content);
      assert.equal(prepared.promptVersion, KNOWLEDGE_EXTRACTION_PROMPT_VERSION);
      assert.deepEqual(prepared.extractionRequest, fixture.request);
      assert.deepEqual(Object.keys(outbound).sort(), ['contractVersion', 'requestId', 'sources']);
      assert.deepEqual(
        outbound.sources,
        fixture.request.sources.map(({ sourceId, markdown }) => ({ sourceId, markdown }))
      );
      assert.equal(JSON.stringify(adapter.calls).includes(fixture.excluded), false);
      assert.equal(JSON.stringify(adapter.calls).includes('仅供理解的上下文'), false);
      assert.equal(JSON.stringify(adapter.calls).includes(fixture.scope.id), false);
      assert.equal(adapter.calls[0].format, 'json');
      assert.deepEqual(adapter.calls[0].tools, []);
      assert.equal(result.usage.unknown, false);
      const plan = validate({ prepared, result });
      assert.equal(plan.candidates[0].reviewStatus, 'candidate');
      assert.equal(plan.candidates[0].candidateInput.sourceMode, 'ai');
      assert.equal(plan.candidates[0].provenance[0].quoteText, fixture.result.candidates[0].citations[0].quote);
      assert.equal(plan.candidates[0].provenance[0].noteVersionId, fixture.request.sources[0].noteVersionId);
      assert.equal(fixture.knowledge.knowledgeItemService.listItems().length, 0);
      const saved = fixture.knowledge.knowledgeItemService.createCandidate(plan.candidates[0].candidateInput);
      assert.equal(saved.item.reviewStatus, 'candidate');
      assert.equal(saved.evidence[0].sourceType, 'noteVersion');
      assert.equal(fixture.knowledge.knowledgeItemService.listItems({ reviewStatus: 'confirmed' }).length, 0);
    }
  },
  {
    name: 'P3 提炼 Gateway：工具响应、拒答、截断与非完整终态整体拒绝',
    async run() {
      for (const [reason, extra, code] of [
        ['length', {}, 'KNOWLEDGE_EXTRACTION_TRUNCATED'],
        ['content_filter', {}, 'KNOWLEDGE_EXTRACTION_REFUSED'],
        ['stop', { refusal: '无法处理' }, 'KNOWLEDGE_EXTRACTION_REFUSED'],
        ['aborted', {}, 'KNOWLEDGE_EXTRACTION_RESPONSE_INCOMPLETE'],
        ['insufficient_system_resource', {}, 'KNOWLEDGE_EXTRACTION_RESPONSE_INCOMPLETE']
      ]) {
        const fixture = createKnowledgeExtractionFixture();
        const outcome = await complete(fixture, fixture.result, reason, extra);
        assert.throws(
          () => validate(outcome),
          error => error.code === code
        );
        assert.equal(fixture.knowledge.knowledgeItemService.listItems().length, 0);
      }
      const fixture = createKnowledgeExtractionFixture();
      await assert.rejects(
        complete(fixture, null, 'tool_calls', {
          tool_calls: [
            {
              id: 'synthetic-tool',
              type: 'function',
              function: { name: 'notes_create', arguments: '{}' }
            }
          ]
        }),
        error => error.code === 'AI_TOOL_INVALID'
      );
    }
  },
  {
    name: 'P3 提炼 Gateway：完整 JSON 仍须绑定原请求且全部引文通过，模型不得确认',
    async run() {
      const fixture = createKnowledgeExtractionFixture();
      const forged = structuredClone(fixture.result);
      forged.candidates.push({
        ...structuredClone(forged.candidates[0]),
        citations: [
          {
            sourceId: 'forged-source',
            start: 0,
            end: 1,
            quote: '伪'
          }
        ]
      });
      const awaited = await complete(fixture, forged);
      assert.throws(
        () => validate(awaited),
        error => error.code === 'KNOWLEDGE_EXTRACTION_CITATION_INVALID'
      );
      const wrongRequest = await complete(fixture, { ...fixture.result, requestId: 'another-request' });
      assert.throws(
        () => validate(wrongRequest),
        error => error.code === 'KNOWLEDGE_EXTRACTION_REQUEST_MISMATCH'
      );
      const forbidden = structuredClone(fixture.result);
      forbidden.candidates[0].reviewStatus = 'confirmed';
      const forbiddenOutcome = await complete(fixture, forbidden);
      assert.throws(
        () => validate(forbiddenOutcome),
        error => error.code === 'KNOWLEDGE_EXTRACTION_RESULT_INVALID'
      );
      assert.equal(fixture.knowledge.knowledgeItemService.listItems().length, 0);
    }
  },
  {
    name: 'P3 提炼 Gateway：畸形 JSON 由 Gateway 阻断，空候选是有效结果',
    async run() {
      const fixture = createKnowledgeExtractionFixture();
      await assert.rejects(complete(fixture, '{"candidates":'), error => error.code === 'AI_JSON_INVALID');
      const outcome = await complete(fixture, { ...fixture.result, candidates: [] });
      assert.deepEqual(validate(outcome).candidates, []);
      assert.equal(fixture.knowledge.knowledgeItemService.listItems().length, 0);
    }
  },
  {
    name: 'P3 提炼 Gateway：原文上限和封装限制分别校验，不能静默截断或绕过 token 上限',
    run() {
      const fixture = createKnowledgeExtractionFixture();
      const scope = structuredClone(fixture.scope);
      const version = structuredClone(fixture.noteVersions[0]);
      version.content = '"\\\n'.repeat(40_000);
      version.contentHash = calculateContentHash(version.content);
      scope.noteVersions = [{ noteId: version.noteId, noteVersionId: version.id, contentHash: version.contentHash }];
      scope.segments = [
        {
          noteId: version.noteId,
          noteVersionId: version.id,
          start: 0,
          end: version.content.length,
          markdown: version.content,
          annotationIds: []
        }
      ];
      assert.equal(version.content.length, 120_000);
      assert.throws(
        () => prepareKnowledgeExtractionGateway({ scope, noteVersions: [version], idempotencyKey: 'large-range' }),
        error => error.code === 'KNOWLEDGE_EXTRACTION_GATEWAY_INPUT_TOO_LARGE'
      );
      assert.throws(
        () => prepare(fixture, { maxTokens: 20_001 }),
        error => error.code === 'AI_REQUEST_INVALID'
      );
      assert.equal(prepare(fixture, { maxTokens: 500 }).gatewayRequest.maxTokens, 500);
    }
  },
  {
    name: 'P3 提炼 Gateway：取消不调用 Mock，旧版本响应仍绑定旧证据并标记待核对',
    async run() {
      const fixture = createKnowledgeExtractionFixture();
      const adapter = createMockAiAdapter({ steps: [{ response: response(fixture.result) }] });
      const gateway = createAiGateway({ adapter });
      const prepared = prepare(fixture);
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        gateway.complete({ ...prepared.gatewayRequest, signal: controller.signal }),
        error => error.code === 'AI_CANCELLED'
      );
      assert.equal(adapter.calls.length, 0);
      const result = await gateway.complete(prepared.gatewayRequest);
      fixture.knowledge.noteService.updateNote(fixture.note.id, { rawMarkdown: '资料已更新，不能替换保存的引文。' });
      const plan = validate({ prepared, result });
      assert.equal(plan.candidates[0].provenance[0].noteVersionId, prepared.extractionRequest.sources[0].noteVersionId);
      const saved = fixture.knowledge.knowledgeItemService.createCandidate(plan.candidates[0].candidateInput);
      assert.equal(saved.evidence[0].status, 'stale');
      assert.equal(saved.item.reviewStatus, 'candidate');
    }
  }
];

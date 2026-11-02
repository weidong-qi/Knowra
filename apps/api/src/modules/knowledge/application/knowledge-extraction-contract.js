import { calculateContentHash } from '@study-accelerator/content-anchor';
import { createAppError } from '../../../errors/app-error.js';

export const KNOWLEDGE_EXTRACTION_CONTRACT_VERSION = 1;
export const KNOWLEDGE_EXTRACTION_LIMITS = Object.freeze({
  sources: 128,
  inputCharacters: 120_000,
  resultBytes: 256_000,
  candidates: 40,
  citations: 8,
  titleCharacters: 200,
  statementCharacters: 8_000,
  quoteCharacters: 8_000
});
const TYPES = ['concept', 'fact', 'principle', 'process', 'algorithm', 'formula', 'comparison', 'application'];
const LIMITS = KNOWLEDGE_EXTRACTION_LIMITS;
const fail = (code, message) => {
  throw createAppError(code, message, 422);
};
const hash = value => calculateContentHash(JSON.stringify(value));
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 500) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

/** 提供商适配器可使用此 Schema；应用层仍须调用 validateKnowledgeExtractionResult。 */
export const KNOWLEDGE_EXTRACTION_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['contractVersion', 'requestId', 'candidates'],
  properties: {
    contractVersion: { type: 'integer', const: KNOWLEDGE_EXTRACTION_CONTRACT_VERSION },
    requestId: { type: 'string' },
    candidates: {
      type: 'array',
      maxItems: LIMITS.candidates,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'canonicalStatement', 'knowledgeType', 'citations'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: LIMITS.titleCharacters },
          canonicalStatement: { type: 'string', minLength: 1, maxLength: LIMITS.statementCharacters },
          knowledgeType: { type: 'string', enum: TYPES },
          citations: {
            type: 'array',
            minItems: 1,
            maxItems: LIMITS.citations,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['sourceId', 'start', 'end', 'quote'],
              properties: {
                sourceId: { type: 'string' },
                start: { type: 'integer', minimum: 0 },
                end: { type: 'integer', minimum: 1 },
                quote: { type: 'string', minLength: 1, maxLength: LIMITS.quoteCharacters }
              }
            }
          }
        }
      }
    }
  }
};

/**
 * 纯函数：scope 必须由服务端按权限读取已保存的 AnalysisScope；noteVersions 来自不可变版本库。
 * 只提供明确选中的片段；contextSegments、排除内容、遗漏内容不会作为可引用来源发送。
 * 不调用模型、不写数据库，也不代表当前提炼服务已经开放。
 */
/** @param {import('./knowledge-extraction-types.ts').PrepareExtractionInput} input */
export function prepareKnowledgeExtraction({ scope, noteVersions, idempotencyKey } = {}) {
  if (
    !isObject(scope) ||
    !text(scope.id) ||
    !text(scope.spaceId) ||
    !text(scope.inputHash) ||
    !text(idempotencyKey, 200) ||
    !Array.isArray(noteVersions) ||
    !Array.isArray(scope.noteVersions) ||
    !Array.isArray(scope.segments) ||
    !noteVersions.every(version => isObject(version) && text(version.id)) ||
    !scope.noteVersions.every(version => isObject(version) && text(version.noteVersionId)) ||
    !Array.isArray(scope.annotationRevisions) ||
    !scope.annotationRevisions.every(isObject) ||
    scope.segments.length === 0 ||
    scope.segments.length > LIMITS.sources
  ) {
    fail('KNOWLEDGE_EXTRACTION_SCOPE_INVALID', '提炼需要已保存且有效的分析范围和幂等键。');
  }
  const versions = new Map(noteVersions.map(version => [version.id, version]));
  const bindings = new Map(scope.noteVersions.map(version => [version.noteVersionId, version]));
  const revisions = new Map((scope.annotationRevisions ?? []).map(entry => [entry.annotationId, entry.revision]));
  const used = new Set();
  let characters = 0;
  const sources = scope.segments.map(segment => {
    if (!isObject(segment)) fail('KNOWLEDGE_EXTRACTION_SCOPE_INVALID', '分析片段无效。');
    const version = versions.get(segment.noteVersionId);
    const binding = bindings.get(segment.noteVersionId);
    if (
      !version ||
      !binding ||
      version.noteId !== segment.noteId ||
      binding.noteId !== segment.noteId ||
      typeof version.content !== 'string' ||
      calculateContentHash(version.content) !== version.contentHash ||
      binding.contentHash !== version.contentHash ||
      !validRange(segment.start, segment.end, version.content) ||
      segment.markdown !== version.content.slice(segment.start, segment.end)
    ) {
      fail('KNOWLEDGE_EXTRACTION_SOURCE_MISMATCH', '分析片段与保存的笔记版本不一致，请重新选择范围。');
    }
    if (
      !Array.isArray(segment.annotationIds) ||
      segment.annotationIds.some(id => !text(id) || !Number.isInteger(revisions.get(id)) || revisions.get(id) < 1)
    ) {
      fail('KNOWLEDGE_EXTRACTION_SCOPE_INVALID', '分析范围缺少标注修订记录。');
    }
    characters += segment.markdown.length;
    if (characters > LIMITS.inputCharacters)
      fail('KNOWLEDGE_EXTRACTION_INPUT_TOO_LARGE', '分析范围过大，请缩小选择范围。');
    const sourceId = `source-${hash([segment.noteVersionId, segment.start, segment.end])}`;
    if (used.has(sourceId)) fail('KNOWLEDGE_EXTRACTION_SCOPE_INVALID', '分析范围包含重复片段。');
    used.add(sourceId);
    return {
      sourceId,
      noteId: segment.noteId,
      noteVersionId: version.id,
      contentHash: version.contentHash,
      start: segment.start,
      end: segment.end,
      markdown: segment.markdown,
      annotationRevisions: [...new Set(segment.annotationIds)]
        .sort()
        .map(annotationId => ({ annotationId, revision: revisions.get(annotationId) }))
    };
  });
  const inputHash = hash([KNOWLEDGE_EXTRACTION_CONTRACT_VERSION, scope.id, scope.spaceId, scope.inputHash, sources]);
  return {
    contractVersion: KNOWLEDGE_EXTRACTION_CONTRACT_VERSION,
    requestId: `extraction-${hash([inputHash, idempotencyKey])}`,
    scopeId: scope.id,
    spaceId: scope.spaceId,
    inputHash,
    sources
  };
}

/**
 * 校验不可信结果并生成候选创建计划。request 只接受服务端保留的原始请求，不能采用模型回传的来源表。
 * 返回内容仍需用户审核；引文匹配不代表生成陈述在语义上正确。
 */
/** @param {import('./knowledge-extraction-types.ts').ValidateExtractionInput} input */
export function validateKnowledgeExtractionResult({ request, result } = {}) {
  if (
    !isObject(request) ||
    request.contractVersion !== KNOWLEDGE_EXTRACTION_CONTRACT_VERSION ||
    !text(request.requestId) ||
    !Array.isArray(request.sources)
  ) {
    fail('KNOWLEDGE_EXTRACTION_REQUEST_MISMATCH', '缺少服务端保留的原始提炼请求。');
  }
  if (typeof result === 'string') {
    if (Buffer.byteLength(result, 'utf8') > LIMITS.resultBytes)
      fail('KNOWLEDGE_EXTRACTION_RESULT_TOO_LARGE', '提炼结果超出大小限制。');
    try {
      result = JSON.parse(result);
    } catch {
      fail('KNOWLEDGE_EXTRACTION_RESULT_INVALID', '提炼结果必须是完整 JSON 对象。');
    }
  }
  assertKeys(result, ['contractVersion', 'requestId', 'candidates']);
  const output = /** @type {import('./knowledge-extraction-types.ts').ExtractionOutput} */ (result);
  if (output.contractVersion !== KNOWLEDGE_EXTRACTION_CONTRACT_VERSION || output.requestId !== request?.requestId) {
    fail('KNOWLEDGE_EXTRACTION_REQUEST_MISMATCH', '提炼结果不属于当前请求。');
  }
  if (!Array.isArray(output.candidates) || output.candidates.length > LIMITS.candidates) {
    fail('KNOWLEDGE_EXTRACTION_RESULT_INVALID', '提炼候选数量无效。');
  }
  const byId = new Map(request.sources.map(source => [source.sourceId, source]));
  const candidates = Array.from(output.candidates, (candidate, index) => {
    assertKeys(candidate, ['title', 'canonicalStatement', 'knowledgeType', 'citations']);
    if (
      !text(candidate.title, LIMITS.titleCharacters) ||
      !text(candidate.canonicalStatement, LIMITS.statementCharacters) ||
      !TYPES.includes(candidate.knowledgeType) ||
      !Array.isArray(candidate.citations) ||
      candidate.citations.length === 0 ||
      candidate.citations.length > LIMITS.citations
    ) {
      fail('KNOWLEDGE_EXTRACTION_RESULT_INVALID', '提炼候选的标题、陈述、类型或引文无效。');
    }
    const used = new Set();
    const provenance = Array.from(candidate.citations, citation => {
      assertKeys(citation, ['sourceId', 'start', 'end', 'quote']);
      const source = byId.get(citation.sourceId);
      if (
        !source ||
        !Number.isSafeInteger(citation.start) ||
        !Number.isSafeInteger(citation.end) ||
        !text(citation.quote, LIMITS.quoteCharacters)
      ) {
        fail('KNOWLEDGE_EXTRACTION_CITATION_INVALID', '提炼引文必须逐字对应所选范围，不能引用范围之外的内容。');
      }
      const { start, end } = anchorQuote(source.markdown, citation);
      const identity = `${source.sourceId}:${start}:${end}`;
      if (used.has(identity)) fail('KNOWLEDGE_EXTRACTION_CITATION_INVALID', '同一候选不能重复引用同一片段。');
      used.add(identity);
      return {
        sourceId: source.sourceId,
        noteId: source.noteId,
        noteVersionId: source.noteVersionId,
        contentHash: source.contentHash,
        start: source.start + start,
        end: source.start + end,
        quoteText: citation.quote,
        annotationRevisions: structuredClone(source.annotationRevisions)
      };
    });
    const id = `knowledge-${hash([request.requestId, index])}`;
    return {
      reviewStatus: 'candidate',
      provenance,
      candidateInput: {
        id,
        title: candidate.title.trim(),
        canonicalStatement: candidate.canonicalStatement.trim(),
        knowledgeType: candidate.knowledgeType,
        sourceMode: 'ai',
        userExplanation: '',
        evidence: provenance.map((source, sourceIndex) => ({
          id: `evidence-${hash([id, sourceIndex])}`,
          sourceType: 'noteVersion',
          noteId: source.noteId,
          noteVersionId: source.noteVersionId,
          quoteText: source.quoteText,
          headingPath: []
        }))
      }
    };
  });
  // 对已解析对象也执行整体大小限制。所有字段先经上面的白名单和长度校验。
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > LIMITS.resultBytes)
    fail('KNOWLEDGE_EXTRACTION_RESULT_TOO_LARGE', '提炼结果超出大小限制。');
  return {
    requestId: request.requestId,
    scopeId: request.scopeId,
    inputHash: request.inputHash,
    outputHash: hash(result),
    candidates
  };
}

/**
 * 模型能逐字复制原文，却常把 UTF-16 偏移数错。偏移只作提示：与 quote 逐字吻合时直接采用；
 * 否则在本片段中按 quote 定位，必须恰好出现一次（与 Agent 知识提议的定位规则一致），
 * 找不到或出现多次仍然拒绝，“引文逐字来自所选范围”的约束不放松。
 */
export function anchorQuote(markdown, { start, end, quote }) {
  if (validRange(start, end, markdown) && markdown.slice(start, end) === quote) return { start, end };
  const first = markdown.indexOf(quote);
  if (first === -1)
    fail('KNOWLEDGE_EXTRACTION_CITATION_INVALID', '提炼引文必须逐字对应所选范围，不能引用范围之外的内容。');
  if (markdown.indexOf(quote, first + 1) !== -1)
    fail('KNOWLEDGE_EXTRACTION_CITATION_INVALID', '提炼引文在所选范围中出现多次，偏移又不吻合，无法唯一定位。');
  if (!validRange(first, first + quote.length, markdown))
    fail('KNOWLEDGE_EXTRACTION_CITATION_INVALID', '提炼引文不能切断 emoji 代理对。');
  return { start: first, end: first + quote.length };
}

function assertKeys(value, keys) {
  if (!isObject(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    fail('KNOWLEDGE_EXTRACTION_RESULT_INVALID', '提炼结果字段不符合契约，不能指定审核状态或来源记录。');
  }
}

function validRange(start, end, value) {
  return (
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start >= 0 &&
    start < end &&
    end <= value.length &&
    !splitsSurrogate(value, start) &&
    !splitsSurrogate(value, end)
  );
}

function splitsSurrogate(value, index) {
  const previous = value.charCodeAt(index - 1);
  const current = value.charCodeAt(index);
  return previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff;
}

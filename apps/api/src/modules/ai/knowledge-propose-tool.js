import { calculateContentHash } from '@study-accelerator/content-anchor';
import {
  KNOWLEDGE_EXTRACTION_CONTRACT_VERSION,
  validateKnowledgeExtractionResult
} from '../knowledge/application/knowledge-extraction-contract.ts';

const MAX_CANDIDATES = 20;
const MAX_CITATIONS = 8;
const TYPES = ['concept', 'fact', 'principle', 'process', 'algorithm', 'formula', 'comparison', 'application'];
const hash = value => calculateContentHash(JSON.stringify(value));
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) =>
  isObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export const KNOWLEDGE_PROPOSE_TOOL = Object.freeze({
  name: 'knowledge_propose',
  description:
    '把从用户笔记中提炼出的知识点作为待审核候选提交。只能引用本次对话中已经通过 notes_read、notes_search 或 annotations_list 读到的原文；每个候选至少一条引文：给出 noteId 与逐字摘自原文的 quote 即可，服务端会在已读原文中定位（quote 须在已读原文里唯一；出现多次时再补充该笔记内的绝对 start/end 偏移），无需自己计算偏移。陈述只能依据所引原文，不添加背景知识；没有可提炼内容时不要调用。提交只是提议，不会直接成为正式知识。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['candidates'],
    properties: {
      candidates: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_CANDIDATES,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'canonicalStatement', 'knowledgeType', 'citations'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            canonicalStatement: { type: 'string', minLength: 1, maxLength: 8000 },
            knowledgeType: { type: 'string', enum: TYPES },
            citations: {
              type: 'array',
              minItems: 1,
              maxItems: MAX_CITATIONS,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['noteId', 'quote'],
                properties: {
                  noteId: { type: 'string' },
                  start: { type: 'integer', minimum: 0 },
                  end: { type: 'integer', minimum: 1 },
                  quote: { type: 'string', minLength: 1, maxLength: 8000 }
                }
              }
            }
          }
        }
      }
    }
  }
});

function toolError(code, message) {
  /** @type {Error & Partial<Pick<import('../../errors/app-error.ts').AppError, 'code'>>} */
  const error = new Error(message);
  error.code = code;
  return error;
}
const invalidArguments = () => toolError('AI_TOOL_ARGUMENTS_INVALID', '知识提议参数无效。');

function parseArguments(args) {
  if (
    !exactKeys(args, ['candidates']) ||
    !Array.isArray(args.candidates) ||
    !args.candidates.length ||
    args.candidates.length > MAX_CANDIDATES
  )
    throw invalidArguments();
  for (const candidate of args.candidates) {
    if (
      !exactKeys(candidate, ['title', 'canonicalStatement', 'knowledgeType', 'citations']) ||
      typeof candidate.title !== 'string' ||
      typeof candidate.canonicalStatement !== 'string' ||
      !TYPES.includes(candidate.knowledgeType) ||
      !Array.isArray(candidate.citations) ||
      !candidate.citations.length ||
      candidate.citations.length > MAX_CITATIONS
    )
      throw invalidArguments();
    for (const citation of candidate.citations) {
      // start/end 可同时省略（由服务端按 quote 定位），但不得只给其一。
      const located = exactKeys(citation, ['noteId', 'start', 'end', 'quote']),
        unlocated = exactKeys(citation, ['noteId', 'quote']);
      if (
        !(located || unlocated) ||
        typeof citation.noteId !== 'string' ||
        !citation.noteId ||
        citation.noteId.length > 128 ||
        typeof citation.quote !== 'string' ||
        (located && (!Number.isSafeInteger(citation.start) || !Number.isSafeInteger(citation.end)))
      )
        throw invalidArguments();
    }
  }
  return args.candidates;
}

/**
 * 不可信的模型提议 → 已校验的候选计划（纯校验，不写入）。
 * 来源只取本回合已读过的原文片段（sourceRefs），并与当前笔记版本逐一核对；引文必须整体落在某个已读片段内，
 * 再交给提炼 v1 契约校验字段白名单、逐字引文、UTF-16 边界与数量/大小限制。
 * 引文匹配只证明引用存在，不证明陈述在语义上受支持；候选仍须用户审核。
 */
/** @param {import('./boundary-types.ts').ProposalInput} options */
export async function buildKnowledgeProposalPlan({ access, grantId, args, sourceRefs, turnId, callId }) {
  const proposals = parseArguments(args);
  const refs = [
    ...new Map(
      (sourceRefs ?? []).map(ref => [`${ref.noteId}:${ref.noteVersionId}:${ref.start}:${ref.end}`, ref])
    ).values()
  ];
  if (!refs.length) throw toolError('AI_PROPOSAL_NOT_READ', '请先读取笔记原文，再提交知识候选。');
  const versions = new Map(),
    spaces = new Set();
  const sources = [];
  for (const ref of refs) {
    if (!versions.has(ref.noteId)) versions.set(ref.noteId, await access.verifyRead({ grantId, noteId: ref.noteId }));
    const { note, version, contentHash } = versions.get(ref.noteId);
    const markdown = version.content.slice(ref.start, ref.end);
    if (
      version.id !== ref.noteVersionId ||
      contentHash !== ref.contentHash ||
      calculateContentHash(markdown) !== ref.quoteHash
    ) {
      throw toolError('AI_PROPOSAL_SOURCE_STALE', '已读原文已经变化，请重新读取后再提交。');
    }
    spaces.add(note.spaceId);
    sources.push({
      sourceId: `source-${hash([ref.noteVersionId, ref.start, ref.end])}`,
      noteId: ref.noteId,
      noteVersionId: ref.noteVersionId,
      contentHash: ref.contentHash,
      start: ref.start,
      end: ref.end,
      markdown,
      annotationRevisions: []
    });
  }
  if (spaces.size !== 1) throw toolError('AI_PROPOSAL_INVALID', '知识提议只能引用同一个知识空间的笔记。');
  const inputHash = hash([KNOWLEDGE_EXTRACTION_CONTRACT_VERSION, sources]);
  const request = {
    contractVersion: KNOWLEDGE_EXTRACTION_CONTRACT_VERSION,
    requestId: `agent-proposal-${hash([turnId, callId])}`,
    scopeId: null,
    spaceId: [...spaces][0],
    inputHash,
    sources
  };
  // 省略偏移时按 quote 在本次已读原文里定位：同一笔记内按绝对位置去重（重叠的来源片段不算多处），必须恰好一处。
  const locate = citation => {
    if (Number.isSafeInteger(citation.start)) return citation;
    const positions = new Set();
    if (citation.quote) {
      for (const source of sources.filter(item => item.noteId === citation.noteId)) {
        for (
          let at = source.markdown.indexOf(citation.quote);
          at !== -1;
          at = source.markdown.indexOf(citation.quote, at + 1)
        )
          positions.add(source.start + at);
      }
    }
    if (positions.size === 0) {
      throw Object.assign(toolError('AI_PROPOSAL_CITATION_INVALID', '引文不在本次已读的原文范围内。'), {
        hint: '有引文无法在已读原文中找到：quote 必须逐字摘自已读原文（含标点），或先读取相关片段。'
      });
    }
    if (positions.size > 1) {
      throw Object.assign(toolError('AI_PROPOSAL_CITATION_INVALID', '引文在已读原文中出现多次，无法唯一定位。'), {
        hint: '有引文在原文中出现多次：请加长 quote 使其唯一，或补充该笔记内的绝对 start/end。'
      });
    }
    const [start] = positions;
    return { ...citation, start, end: start + citation.quote.length };
  };
  const candidates = proposals.map(candidate => ({
    ...candidate,
    citations: candidate.citations.map(raw => {
      const citation = locate(raw);
      const source = sources.find(
        item => item.noteId === citation.noteId && item.start <= citation.start && citation.end <= item.end
      );
      if (!source) throw toolError('AI_PROPOSAL_CITATION_INVALID', '引文不在本次已读的原文范围内。');
      return {
        sourceId: source.sourceId,
        start: citation.start - source.start,
        end: citation.end - source.start,
        quote: citation.quote
      };
    })
  }));
  try {
    const plan = validateKnowledgeExtractionResult({
      request,
      result: { contractVersion: KNOWLEDGE_EXTRACTION_CONTRACT_VERSION, requestId: request.requestId, candidates }
    });
    return { ...plan, spaceId: request.spaceId };
  } catch (error) {
    if (error?.code === 'KNOWLEDGE_EXTRACTION_CITATION_INVALID')
      throw toolError('AI_PROPOSAL_CITATION_INVALID', '引文必须与已读原文逐字一致，且不能重复引用同一片段。');
    throw toolError('AI_PROPOSAL_INVALID', '知识候选的标题、陈述、类型或引文不符合要求。');
  }
}

// 已保存候选实际引用的原文范围（笔记内绝对位置）。进度说明据此判断哪些重点已被覆盖，而不是把“保存成功”当作“全部已读重点已提交”。
const rangesOf = sources => {
  const seen = new Map();
  for (const source of sources)
    seen.set(`${source.noteId}:${source.start}:${source.end}`, {
      noteId: source.noteId,
      start: source.start,
      end: source.end
    });
  return [...seen.values()];
};
function savedOutcome(requestId, outputHash, candidates, citedRanges) {
  return {
    resultJson: { status: 'saved', saved: true, requestId, outputHash, candidates, citedRanges },
    sourceRefs: []
  };
}

/**
 * Agent 工具入口。传入 commit 时把候选原子保存为 candidate；未传入则只返回校验摘要（saved: false）。
 * 无论哪种，提议都不会成为正式知识，仍须用户在知识候选区审核。
 */
/** @param {import('./boundary-types.ts').KnowledgeProposalOptions} options */
export async function proposeKnowledge({ commit = null, ...input }) {
  // 同一调用已经提交（响应丢失、租约恢复后重试）：直接按回执报告，不重新校验也不重复保存。
  const committed = commit ? await commit.find() : null;
  if (committed) return savedOutcome(committed.requestId, null, committed.candidates, committed.citedRanges ?? []);
  const plan = await buildKnowledgeProposalPlan(input);
  if (commit) {
    try {
      await commit.save(plan);
    } catch (error) {
      // 提交可能已成功但响应丢失：以回执为准，确实没有提交才报告失败。
      const landed = await commit.find().catch(() => null);
      if (!landed) throw error;
      return savedOutcome(
        landed.requestId,
        plan.outputHash,
        landed.candidates,
        landed.citedRanges ?? rangesOf(plan.candidates.flatMap(item => item.provenance))
      );
    }
  }
  return {
    resultJson: {
      status: commit ? 'saved' : 'validated',
      saved: Boolean(commit),
      requestId: plan.requestId,
      outputHash: plan.outputHash,
      candidates: plan.candidates.map(({ candidateInput, provenance }) => ({
        candidateId: candidateInput.id,
        title: candidateInput.title,
        knowledgeType: candidateInput.knowledgeType,
        citationCount: provenance.length
      })),
      citedRanges: rangesOf(plan.candidates.flatMap(item => item.provenance))
    },
    sourceRefs: []
  };
}

import { createAuthorizedKeywordSearch } from '../../../api/src/modules/ai/keyword-search.ts';
import { listAnnotatedRanges } from '../../../api/src/modules/ai/annotation-read-tool.ts';
import { calculateContentHash } from '@study-accelerator/content-anchor';
import {
  KNOWLEDGE_PROPOSE_TOOL,
  buildKnowledgeProposalPlan
} from '../../../api/src/modules/ai/knowledge-propose-tool.ts';
import { mcpError } from './mcp-error.mjs';

const MAX_READ_UNITS = 1000;
const invalid = message => Object.assign(new Error(message), { code: 'AI_TOOL_ARGUMENTS_INVALID' });
const boundary = (text, position) =>
  position <= 0 ||
  position >= text.length ||
  !(
    text.charCodeAt(position - 1) >= 0xd800 &&
    text.charCodeAt(position - 1) <= 0xdbff &&
    text.charCodeAt(position) >= 0xdc00 &&
    text.charCodeAt(position) <= 0xdfff
  );
const onlyKeys = (value, keys) =>
  value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
const noteId = value => typeof value === 'string' && value.length > 0 && value.length <= 128;

/**
 * 外部客户端的工具：授权读取工具，加上需要在配对时单独开启的 knowledge_propose。它们复用内置助手的检索、读取与重点列表实现，
 * 但返回值一律改成带偏移的正文片段，由统一外发出口逐字复核后才离开运行端。
 * getAnnotations 每次调用时读取，资料库恢复后自动使用新的实例。
 */
export function createMcpTools({ getAnnotations, getAi = () => null }) {
  // 结果未知（提交可能已成功，但回执暂时读不出来）的预留：保留到同一幂等键下一次对账；进程重启后丢失，偏保守地继续计入。
  const unsettled = new Map();
  const searches = new WeakMap();
  const searchFor = access => {
    if (!searches.has(access)) searches.set(access, createAuthorizedKeywordSearch({ access }));
    return searches.get(access);
  };
  return {
    knowledge_search: {
      knowledgeRead: true,
      description:
        '检索本配对单独获准读取的知识内容；先过滤所有已知私密/越权/断裂来源，再匹配关键词。默认仅正式知识 confirmed，可用 reviewStatus 查看候选等状态；返回知识与来源版本，不代表原文或完整派生依赖追踪。用 nextCursor 翻页。',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 300 },
          reviewStatus: { type: 'string', enum: ['candidate', 'confirmed', 'needsRevision', 'archived', 'all'] },
          limit: { type: 'integer', minimum: 1, maximum: 10 },
          cursor: { type: 'string', minLength: 1, maxLength: 2048 }
        },
        required: ['query'],
        additionalProperties: false
      },
      async run() {
        return { fragments: [], meta: {}, entity: true };
      }
    },
    knowledge_read: {
      knowledgeRead: true,
      description:
        '读取单条知识的当前标题、陈述、解释、审核状态和可验证的已知来源版本。须先独立开启本配对的知识读取授权；不确认或修改知识。无来源的手写/旧记录依靠该独立授权，不声称有完整生成来源。',
      inputSchema: {
        type: 'object',
        properties: { knowledgeId: { type: 'string', minLength: 1, maxLength: 128 } },
        required: ['knowledgeId'],
        additionalProperties: false
      },
      async run() {
        return { fragments: [], meta: {}, entity: true };
      }
    },
    workspace_describe: {
      description: '描述本配对可见的笔记范围和能力边界；数量只统计当前授权笔记，不代表整个资料库。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      async run() {
        return { fragments: [], meta: {}, entity: true };
      }
    },
    notes_list: {
      description:
        '按稳定 ID 顺序列出当前授权笔记标题与版本，不含正文。用 nextCursor 翻页；授权或笔记快照变化后须从首页重试。',
      inputSchema: {
        type: 'object',
        properties: {
          titleQuery: { type: 'string', minLength: 1, maxLength: 100 },
          limit: { type: 'integer', minimum: 1, maximum: 20 },
          cursor: { type: 'string', minLength: 1, maxLength: 2048 }
        },
        additionalProperties: false
      },
      async run() {
        return { fragments: [], meta: {}, entity: true };
      }
    },
    proposals_get: {
      description:
        '按 knowledge_propose 返回的 requestId 查看本配对提交的候选当前状态；只读回执，不确认、不修改知识。其他配对或来源不再可读时不返回记录。',
      inputSchema: {
        type: 'object',
        properties: { requestId: { type: 'string', minLength: 1, maxLength: 128 } },
        required: ['requestId'],
        additionalProperties: false
      },
      async run() {
        return { fragments: [], meta: {}, entity: true };
      }
    },
    notes_search: {
      description:
        '在已授权的笔记范围内按关键词检索，返回匹配的原文片段（带笔记 ID 与字符偏移）。没有结果时可换关键词再试。',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 300 },
          limit: { type: 'integer', minimum: 1, maximum: 5 }
        },
        required: ['query'],
        additionalProperties: false
      },
      metaKeys: ['inspected', 'truncated'],
      async run({ input, grantId, access }) {
        if (
          !onlyKeys(input, ['query', 'limit']) ||
          typeof input.query !== 'string' ||
          !input.query.trim() ||
          input.query.length > 300 ||
          (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 5))
        )
          throw invalid('检索参数无效。');
        const found = await searchFor(access).search({ grantId, query: input.query, limit: input.limit ?? 5 });
        return {
          fragments: found.hits.map(hit => ({
            noteId: hit.noteId,
            title: hit.title,
            start: hit.ref.start,
            end: hit.ref.end,
            text: hit.text
          })),
          meta: { inspected: found.inspected, truncated: Boolean(found.truncated) }
        };
      }
    },
    notes_read: {
      description: `读取已授权笔记的一个原文片段，单次最多 ${MAX_READ_UNITS} 个 UTF-16 单位；noteId 须来自检索结果或用户明确提供。用 start/end 翻页。`,
      inputSchema: {
        type: 'object',
        properties: {
          noteId: { type: 'string', maxLength: 128 },
          start: { type: 'integer', minimum: 0 },
          end: { type: 'integer', minimum: 1 }
        },
        required: ['noteId'],
        additionalProperties: false
      },
      metaKeys: ['length', 'hasMore'],
      async run({ input, grantId, access }) {
        if (!onlyKeys(input, ['noteId', 'start', 'end']) || !noteId(input.noteId)) throw invalid('阅读参数无效。');
        const { note, version } = await access.verifyRead({ grantId, noteId: input.noteId, tool: 'notes_read' });
        const content = version.content,
          start = input.start ?? 0,
          requestedEnd = input.end ?? start + MAX_READ_UNITS;
        // 读到末尾（含空笔记从 0 开始）是正常结果：返回空片段，不是参数错误。
        if (start === content.length && requestedEnd > start)
          return { fragments: [], meta: { length: content.length, hasMore: false } };
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(requestedEnd) ||
          start < 0 ||
          requestedEnd <= start ||
          start > content.length ||
          !boundary(content, start)
        )
          throw invalid('阅读范围无效。');
        let end = Math.min(requestedEnd, start + MAX_READ_UNITS, content.length);
        while (!boundary(content, end)) end--;
        if (end <= start) throw invalid('阅读范围无效。');
        return {
          fragments: [{ noteId: note.id, title: note.title, start, end, text: content.slice(start, end) }],
          meta: { length: content.length, hasMore: end < content.length }
        };
      }
    },
    annotations_list: {
      description:
        '列出一篇已授权笔记中用户标记的重点（普通/重点/核心），返回每处重点的原文与位置。数量多时用 offset 翻页，用 minImportance 只看更重要的。',
      inputSchema: {
        type: 'object',
        properties: {
          noteId: { type: 'string', maxLength: 128 },
          minImportance: { type: 'string', enum: ['normal', 'important', 'core'] },
          limit: { type: 'integer', minimum: 1, maximum: 8 },
          offset: { type: 'integer', minimum: 0 }
        },
        required: ['noteId'],
        additionalProperties: false
      },
      metaKeys: ['total', 'offset', 'hasMore', 'unavailableCount'],
      fragmentAttrs: {
        importance: { enum: ['normal', 'important', 'core', 'unrated'] },
        truncated: { boolean: true },
        annotationId: { pattern: '^[A-Za-z0-9_-]{1,64}$' }
      },
      async run({ input, grantId, access }) {
        const repository = getAnnotations();
        if (!repository) throw mcpError('MCP_TOOL_UNAVAILABLE', '重点服务当前不可用。', { status: 503 });
        const { resultJson } = await listAnnotatedRanges({ access, repository, grantId, args: input });
        return {
          fragments: resultJson.annotations.map(item => ({
            noteId: resultJson.noteId,
            title: resultJson.title,
            start: item.start,
            end: item.end,
            text: item.text,
            attrs: { importance: item.importance, truncated: item.truncated, annotationId: item.annotationId }
          })),
          meta: {
            total: resultJson.total,
            offset: resultJson.offset,
            hasMore: resultJson.hasMore,
            unavailableCount: resultJson.unavailableCount
          }
        };
      }
    },
    knowledge_propose: {
      write: true,
      description:
        '把从用户笔记中提炼出的知识点作为待审核候选提交。只能引用本配对已经通过 notes_read、notes_search 或 annotations_list 读到的原文；每个候选至少一条引文：给出 noteId 与逐字摘自原文的 quote 即可，服务端会在已读原文中定位（quote 须在已读原文里唯一；出现多次时再补充该笔记内的绝对 start/end 偏移）。陈述只能依据所引原文，不添加背景知识；没有可提炼内容时不要调用。提交只是提议，不会成为正式知识，必须由用户在知境里逐条审核；重复提交相同内容或使用相同的 idempotencyKey 会返回同一结果，不会重复创建。',
      inputSchema: {
        ...KNOWLEDGE_PROPOSE_TOOL.parameters,
        properties: {
          ...KNOWLEDGE_PROPOSE_TOOL.parameters.properties,
          idempotencyKey: { type: 'string', minLength: 8, maxLength: 128 }
        }
      },
      metaKeys: ['saved', 'candidates', 'reused'],
      async run({ input, grantId, access, pairing, readRanges, guard, quota, serialize }) {
        guard(); // 开始就复核一次：已超时、开关已关、配对已撤销都不再往下做。
        const ai = getAi();
        if (!ai?.knowledgeCommit || !ai.accessStore)
          throw mcpError('MCP_TOOL_UNAVAILABLE', '知识候选保存服务当前不可用。', { status: 503 });
        const key =
          input.idempotencyKey ?? `auto-${calculateContentHash(JSON.stringify(input.candidates)).slice(0, 32)}`;
        const origin = { pairingId: pairing.pairingId, callId: key };
        const slot = `${pairing.pairingId}:${key}`;
        // 同一幂等键的并发重试依次执行，只预留、结算一次。
        return serialize(key, async () => {
          const identity = await ai.accessStore.identity();
          const receipt = result => ({
            fragments: [],
            meta: { saved: true, candidates: result.candidates.length, reused: true },
            entity: true
          });
          // 同一幂等键已提交：按回执返回，不重新校验也不重复创建（响应丢失后重试安全）。
          const existing = await ai.knowledgeCommit.findCommitted({ origin, identity, mode: 'mcp' });
          if (existing) {
            unsettled.delete(slot);
            return receipt(existing);
          }
          // 上一次尝试结果未知，现在确认它没有提交：归还当时的预留，再按新的尝试重新预留。
          if (unsettled.has(slot)) {
            quota.release(unsettled.get(slot));
            unsettled.delete(slot);
          }
          // 已读记录里可能留有笔记旧版本的片段：只保留仍是当前版本且仍可读的；一个都不剩时按原因报错（变了、或已不可读）。
          const versions = new Map(),
            current = [];
          let firstFailure = null;
          for (const ref of readRanges()) {
            if (!versions.has(ref.noteId))
              versions.set(
                ref.noteId,
                await access.verifyRead({ grantId, noteId: ref.noteId }).catch(error => {
                  firstFailure ??= error;
                  return null;
                })
              );
            const live = versions.get(ref.noteId);
            if (live && live.version.id === ref.noteVersionId && live.contentHash === ref.contentHash)
              current.push(ref);
          }
          if (!current.length && readRanges().length)
            throw firstFailure ?? Object.assign(new Error('已读原文已经变化'), { code: 'AI_PROPOSAL_SOURCE_STALE' });
          const plan = await buildKnowledgeProposalPlan({
            access,
            grantId,
            args: { candidates: input.candidates },
            sourceRefs: current,
            turnId: `mcp-${pairing.pairingId}`,
            callId: key
          });
          // 先预留配额（同步检查并扣减，并发不会同时通过；凭据带日期），再提交；只有确认没有提交才归还。
          const handle = quota.reserve(plan.candidates.length);
          try {
            await ai.knowledgeCommit.commit({ plan, origin, identity, grantId, mode: 'mcp', guard });
          } catch (error) {
            // 提交可能已成功但响应丢失：以回执为准，预留的配额保持（只计一次）。“读不到回执”与“没有回执”不同：前者结果未知，不能归还。
            let landed = null,
              lookupFailed = false;
            try {
              landed = await ai.knowledgeCommit.findCommitted({ origin, identity, mode: 'mcp' });
            } catch {
              lookupFailed = true;
            }
            if (landed) return receipt(landed);
            if (lookupFailed) {
              unsettled.set(slot, handle);
              throw mcpError(
                'MCP_COMMIT_UNKNOWN',
                '提交结果暂时无法确认，请稍后用同一个 idempotencyKey 重试，不会重复创建。',
                { status: 503 }
              );
            }
            quota.release(handle);
            throw error;
          }
          return {
            fragments: [],
            meta: { saved: true, candidates: plan.candidates.length, reused: false },
            entity: true
          };
        });
      }
    }
  };
}

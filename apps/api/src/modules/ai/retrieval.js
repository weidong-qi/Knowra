import { calculateContentHash } from '../knowledge/domain/note-version.ts';
import { createAuthorizedKeywordSearch } from './keyword-search.js';

const MAX_INDEX_CANDIDATES = 32;
const validBoundary = (text, offset) =>
  offset <= 0 ||
  offset >= text.length ||
  !(
    text.charCodeAt(offset - 1) >= 0xd800 &&
    text.charCodeAt(offset - 1) <= 0xdbff &&
    text.charCodeAt(offset) >= 0xdc00 &&
    text.charCodeAt(offset) <= 0xdfff
  );
const validSearch = ({ grantId, query, limit }) =>
  typeof grantId === 'string' &&
  !!grantId &&
  typeof query === 'string' &&
  !!query.trim() &&
  query.length <= 300 &&
  Number.isSafeInteger(limit) &&
  limit >= 1 &&
  limit <= 8;
const invalid = () => {
  /** @type {Error & Partial<Pick<import('../../errors/app-error.ts').AppError, 'code'>>} */
  const error = new Error('检索参数无效。');
  error.code = 'AI_SEARCH_INVALID';
  throw error;
};

/**
 * 候选源只负责排序和定位，不提供可外发的正文、标题或引用。
 * 当前授权版本由 R02 读取服务重新取得；候选源异常、陈旧或无结果时回退关键词。
 */
/** @param {import('./boundary-types.ts').RetrievalOptions} [options] */
export function createAuthorizedRetrieval({ access, candidateSource = null, candidateTimeoutMs = 1500 } = {}) {
  if (
    !access?.listAuthorizedNotes ||
    !access?.verifyRead ||
    (candidateSource !== null && typeof candidateSource.searchCandidates !== 'function') ||
    !Number.isSafeInteger(candidateTimeoutMs) ||
    candidateTimeoutMs < 1 ||
    candidateTimeoutMs > 10_000
  ) {
    throw new TypeError('Authorized retrieval needs R02 access and a candidate source');
  }
  const baseline = createAuthorizedKeywordSearch({ access });

  async function fallback(input, reason) {
    const result = await baseline.search(input);
    return { ...result, mode: reason ? 'keyword_fallback' : 'keyword', ...(reason ? { fallbackReason: reason } : {}) };
  }

  return {
    async search(input) {
      if (!input || !validSearch({ grantId: input.grantId, query: input.query, limit: input.limit ?? 5 })) invalid();
      const { grantId, query, limit = 5 } = input;
      if (!candidateSource) return fallback({ grantId, query, limit });

      // 空命中和索引故障也先验证 grant；索引不能决定授权是否有效。
      const authorized = await access.listAuthorizedNotes({ grantId });
      const byId = new Map(authorized.map(row => [row.noteId, row]));
      let found;
      const controller = new AbortController();
      let timeout;
      try {
        found = await Promise.race([
          Promise.resolve().then(() =>
            candidateSource.searchCandidates({
              query,
              limit: MAX_INDEX_CANDIDATES,
              authorized: authorized.map(({ noteId, noteVersionId, contentHash }) => ({
                noteId,
                noteVersionId,
                contentHash
              })),
              signal: controller.signal
            })
          ),
          new Promise((_, reject) => {
            timeout = setTimeout(() => {
              controller.abort();
              reject(new Error('candidate source timeout'));
            }, candidateTimeoutMs);
          })
        ]);
      } catch {
        return fallback({ grantId, query, limit }, 'unavailable');
      } finally {
        clearTimeout(timeout);
      }
      if (
        !found ||
        !Array.isArray(found.candidates) ||
        typeof found.truncated !== 'boolean' ||
        found.candidates.length > MAX_INDEX_CANDIDATES
      ) {
        return fallback({ grantId, query, limit }, 'invalid');
      }
      if (!found.candidates.length) return fallback({ grantId, query, limit }, 'empty');

      const hits = [],
        seen = new Set();
      for (const candidate of found.candidates) {
        const allowed = typeof candidate?.noteId === 'string' ? byId.get(candidate.noteId) : null;
        if (
          !allowed ||
          candidate.noteVersionId !== allowed.noteVersionId ||
          candidate.contentHash !== allowed.contentHash ||
          !Number.isSafeInteger(candidate.start) ||
          !Number.isSafeInteger(candidate.end) ||
          candidate.start < 0 ||
          candidate.end <= candidate.start ||
          candidate.end - candidate.start > 320 ||
          typeof candidate.score !== 'number' ||
          !Number.isFinite(candidate.score)
        ) {
          return fallback({ grantId, query, limit }, 'stale');
        }
        const candidateKey = JSON.stringify([candidate.noteId, candidate.start, candidate.end]);
        if (seen.has(candidateKey)) return fallback({ grantId, query, limit }, 'stale');
        seen.add(candidateKey);
        let current;
        try {
          current = await access.verifyRead({ grantId, noteId: candidate.noteId, tool: 'notes_search' });
        } catch (error) {
          // 授权本身失效必须传播；单篇移出范围或变更版本由回退重新检索。
          if (error?.code !== 'AI_SCOPE_FORBIDDEN' && error?.code !== 'AI_SOURCE_STALE') throw error;
          return fallback({ grantId, query, limit }, 'stale');
        }
        const { note, version, contentHash } = current;
        if (
          version.id !== candidate.noteVersionId ||
          contentHash !== candidate.contentHash ||
          candidate.end > version.content.length ||
          !validBoundary(version.content, candidate.start) ||
          !validBoundary(version.content, candidate.end)
        ) {
          return fallback({ grantId, query, limit }, 'stale');
        }
        const text = version.content.slice(candidate.start, candidate.end);
        hits.push({
          noteId: note.id,
          title: note.title,
          score: candidate.score,
          ref: {
            noteId: note.id,
            noteVersionId: version.id,
            contentHash,
            start: candidate.start,
            end: candidate.end,
            quoteHash: calculateContentHash(text)
          },
          text
        });
      }
      for (const hit of hits) {
        const { note, version, contentHash } = await access.verifyRead({
          grantId,
          noteId: hit.noteId,
          tool: 'notes_search'
        });
        if (
          note.title !== hit.title ||
          version.id !== hit.ref.noteVersionId ||
          contentHash !== hit.ref.contentHash ||
          version.content.slice(hit.ref.start, hit.ref.end) !== hit.text
        ) {
          return fallback({ grantId, query, limit }, 'stale');
        }
      }
      await access.assertSearchGrant({ grantId });
      await access.assertSearchSources({ grantId, sourceRefs: hits.map(hit => hit.ref) });
      return {
        hits: hits.slice(0, limit),
        inspected: found.candidates.length,
        truncated: found.truncated || found.candidates.length > limit,
        mode: 'index'
      };
    }
  };
}

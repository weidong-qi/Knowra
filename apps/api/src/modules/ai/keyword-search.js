import { calculateContentHash } from '../knowledge/domain/note-version.js';

const fail = (code, message) => {
  /** @type {Error & Partial<Pick<import('../../errors/app-error.ts').AppError, 'code'>>} */
  const error = new Error(message);
  error.code = code;
  throw error;
};
const normalize = value => value.normalize('NFKC').toLocaleLowerCase();
const normalizeContent = value => {
  let text = '';
  for (const character of value) text += normalize(character);
  return text;
};
const normalizeWithOffsets = value => {
  let text = '';
  const offsets = [];
  for (let index = 0; index < value.length;) {
    const character = String.fromCodePoint(value.codePointAt(index));
    const folded = normalize(character);
    for (let unit = 0; unit < folded.length; unit++) offsets.push(index);
    text += folded;
    index += character.length;
  }
  offsets.push(value.length);
  return { text, offsets };
};
const tokens = query => {
  const text = normalize(query);
  const words = text.match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  const grams = [...text.matchAll(/[\p{Script=Han}]{2,}/gu)].flatMap(([chunk]) =>
    Array.from({ length: Math.max(0, chunk.length - 1) }, (_, i) => chunk.slice(i, i + 2))
  );
  return [...new Set([...words, ...grams])].filter(value => value.length >= 2).slice(0, 48);
};
const boundary = (text, index) =>
  index <= 0 ||
  index >= text.length ||
  !(
    text.charCodeAt(index - 1) >= 0xd800 &&
    text.charCodeAt(index - 1) <= 0xdbff &&
    text.charCodeAt(index) >= 0xdc00 &&
    text.charCodeAt(index) <= 0xdfff
  );

/** 扫描预算约束查询预选，300 上限只约束匹配后当前版本评分；外发仍走 R02 逐请求复核。 */
/** @param {import('./boundary-types.ts').KeywordSearchOptions} [options] */
export function createAuthorizedKeywordSearch({
  access,
  maxCandidates = 300,
  maxNoteChars = 200_000,
  maxScanNotes = 5000,
  maxScanChars = 4_000_000
} = {}) {
  if (
    !access?.findAuthorizedSearchCandidates ||
    !access?.assertSearchGrant ||
    !access?.verifyRead ||
    [maxCandidates, maxNoteChars, maxScanNotes, maxScanChars].some(value => !Number.isSafeInteger(value) || value < 1)
  ) {
    throw new TypeError('Authorized search needs R02 access service and positive work limits');
  }
  return {
    async search({ grantId, query, limit = 5 }) {
      if (
        typeof query !== 'string' ||
        !query.trim() ||
        query.length > 300 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 8
      )
        fail('AI_SEARCH_INVALID', '检索参数无效。');
      const terms = tokens(query);
      if (!terms.length) {
        await access.assertSearchGrant({ grantId });
        return { hits: [], inspected: 0, truncated: false };
      }
      const selected = await access.findAuthorizedSearchCandidates({
        grantId,
        maxCandidates,
        maxScanNotes,
        maxScanChars,
        maxNoteChars,
        scoreNote({ title, rawMarkdown }) {
          if (!rawMarkdown.length) return 0;
          const text = normalizeContent(rawMarkdown),
            foldedTitle = normalize(title);
          return terms.reduce(
            (score, term) => score + (foldedTitle.includes(term) ? 5 : 0) + (text.includes(term) ? 2 : 0),
            0
          );
        }
      });
      const { candidates } = selected;
      const scored = [];
      for (const candidate of candidates) {
        const { note, version, contentHash } = await access.verifyRead({
          grantId,
          noteId: candidate.noteId,
          tool: 'notes_search',
          maxContentChars: maxNoteChars
        });
        if (
          note.id !== candidate.noteId ||
          version.noteId !== note.id ||
          note.title !== candidate.title ||
          version.id !== candidate.noteVersionId ||
          contentHash !== candidate.contentHash ||
          version.content.length > maxNoteChars
        )
          fail('AI_SOURCE_STALE', '检索期间来源已变化。');
        const content = version.content,
          indexed = normalizeWithOffsets(content),
          title = normalize(note.title);
        let score = 0,
          best = -1;
        for (const term of terms) {
          if (title.includes(term)) score += 5;
          const index = indexed.text.indexOf(term);
          if (index >= 0) {
            score += 2;
            if (best < 0 || indexed.offsets[index] < best) best = indexed.offsets[index];
          }
        }
        if (!score) continue;
        let start = Math.max(0, best - 80),
          end = Math.min(content.length, start + 320);
        while (!boundary(content, start)) start--;
        while (!boundary(content, end)) end++;
        const text = content.slice(start, end);
        if (!text) continue;
        scored.push({
          noteId: note.id,
          title: note.title,
          score,
          ref: {
            noteId: note.id,
            noteVersionId: version.id,
            contentHash,
            start,
            end,
            quoteHash: calculateContentHash(text)
          },
          text
        });
      }
      scored.sort((a, b) => b.score - a.score || a.noteId.localeCompare(b.noteId));
      const hits = scored.slice(0, limit);
      for (const hit of hits) {
        const { note, version, contentHash } = await access.verifyRead({
          grantId,
          noteId: hit.noteId,
          tool: 'notes_search',
          maxContentChars: maxNoteChars
        });
        const { ref } = hit;
        if (
          note.id !== hit.noteId ||
          ref.noteId !== note.id ||
          version.noteId !== note.id ||
          note.title !== hit.title ||
          version.id !== ref.noteVersionId ||
          contentHash !== ref.contentHash ||
          !Number.isSafeInteger(ref.start) ||
          !Number.isSafeInteger(ref.end) ||
          ref.start < 0 ||
          ref.end <= ref.start ||
          ref.end > version.content.length ||
          !boundary(version.content, ref.start) ||
          !boundary(version.content, ref.end) ||
          version.content.slice(ref.start, ref.end) !== hit.text ||
          calculateContentHash(hit.text) !== ref.quoteHash
        )
          fail('AI_SOURCE_STALE', '检索期间来源已变化。');
      }
      await access.assertSearchGrant({ grantId });
      if (hits.length) await access.assertSearchSources({ grantId, sourceRefs: hits.map(hit => hit.ref) });
      return { hits, inspected: candidates.length, truncated: selected.truncated, coverage: selected.coverage };
    }
  };
}

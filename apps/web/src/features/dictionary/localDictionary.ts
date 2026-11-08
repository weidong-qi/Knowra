import manifest from './ecdictManifest';

type DictionaryRow = [phonetic: string, translation: string, definition: string, lemma: string];
export type DictionaryShard = Record<string, DictionaryRow>;
export interface DictionaryEntry {
  query: string;
  word: string;
  phonetic: string;
  meanings: string[];
  language: 'zh' | 'en';
}

/** 只接受词语；句段翻译使用独立服务，不把整段正文发送到词典。 */
export function normalizeDictionaryWord(text: string): string | null {
  const word = text
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑–−]/g, '-')
    .replace(/-\s*\r?\n\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'([{]+|["')\]},.;:!?]+$/g, '')
    .toLowerCase();
  return /^[a-z][a-z' -]{0,79}$/.test(word) && word.split(' ').length <= 6 ? word : null;
}

function shardKey(word: string) {
  return word.replace(/[^a-z]/g, '').slice(0, 2);
}

async function loadShard(prefix: string): Promise<DictionaryShard> {
  const response = await fetch(`/dictionaries/${manifest.version}/${prefix}.json.gz`, { credentials: 'same-origin' });
  if (!response.ok || !response.body) throw new Error('本地词库读取失败，请重试。');
  try {
    return await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
  } catch {
    throw new Error('本地词库文件无法读取，请重新加载或更新应用。');
  }
}

/** 每次只读所需词首分片，最多保留 12 个；失败不缓存，允许重新查询。 */
export function createDictionaryLookup(readShard = loadShard) {
  const cache = new Map<string, Promise<DictionaryShard>>();
  async function read(word: string): Promise<DictionaryRow | null> {
    const prefix = shardKey(word);
    if (!Object.hasOwn(manifest.shards, prefix)) return null;
    let request = cache.get(prefix);
    if (!request) {
      request = readShard(prefix);
      cache.set(prefix, request);
      if (cache.size > 12) cache.delete(cache.keys().next().value!);
    } else {
      cache.delete(prefix);
      cache.set(prefix, request);
    }
    try {
      const shard = await request;
      if (!shard || typeof shard !== 'object' || Array.isArray(shard))
        throw new Error('本地词库分片无效，请更新应用。');
      if (!Object.hasOwn(shard, word)) return null;
      const row = shard[word];
      if (!Array.isArray(row) || row.length !== 4 || !row.every(value => typeof value === 'string'))
        throw new Error('本地词库条目无效，请更新应用。');
      return row;
    } catch (error) {
      if (cache.get(prefix) === request) cache.delete(prefix);
      throw error;
    }
  }
  return async (text: string): Promise<DictionaryEntry | null> => {
    const query = normalizeDictionaryWord(text);
    if (!query) return null;
    let row = await read(query);
    if (!row) return null;
    let word = query;
    // 按词库的真实词形映射还原，不凭词尾猜测不规则变化。
    const lemma = normalizeDictionaryWord(row[3]);
    if (lemma && lemma !== query) {
      const original = await read(lemma);
      if (original) {
        row = original;
        word = lemma;
      }
    }
    const meanings = (row[1] || row[2])
      .split('\n')
      .map(value => value.trim())
      .filter(Boolean);
    return meanings.length ? { query, word, phonetic: row[0], meanings, language: row[1] ? 'zh' : 'en' } : null;
  };
}

export const lookupDictionary = createDictionaryLookup();

/** 将本次看见的释义冻结进普通批注，后续查看无需重新查询词库。 */
export function dictionaryComment(entry: DictionaryEntry, meaning: string) {
  return [`词典 · ECDICT`, entry.word + (entry.phonetic ? ` /${entry.phonetic}/` : ''), meaning].join('\n');
}

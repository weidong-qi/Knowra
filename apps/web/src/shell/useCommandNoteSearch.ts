import { useEffect, useMemo, useState } from 'react';
import { COMMAND_SEARCH_QUERY_LIMIT, type CommandNoteSearcher, type CommandNoteSearchHit } from '@study-accelerator/web-core';

interface SearchScope {
  isOpen: boolean;
  isComposing: boolean;
  query: string;
  spaceId: string | null;
  search?: CommandNoteSearcher;
  scopeKey?: unknown;
}

interface Completion {
  scope: SearchScope;
  hits: CommandNoteSearchHit[];
  error: string | null;
}

const EMPTY_HITS: CommandNoteSearchHit[] = [];

/** 返回值在 render 时绑定完整 scope；effect 尚未运行时也不会展示/选择旧结果。 */
export function useCommandNoteSearch({ isOpen, isComposing, query, spaceId, search, scopeKey }: SearchScope) {
  const scope = useMemo(() => ({ isOpen, isComposing, query, spaceId, search, scopeKey }), [isOpen, isComposing, query, spaceId, search, scopeKey]);
  const [completion, setCompletion] = useState<Completion | null>(null);
  const normalizedQuery = query.trim();
  const inputError = query.length > COMMAND_SEARCH_QUERY_LIMIT ? '搜索关键字最多 200 字符。'
    : !spaceId ? '请选择当前空间后搜索正文。' : null;
  const requested = isOpen && Boolean(search) && Boolean(normalizedQuery) && !isComposing;

  useEffect(() => {
    if (!requested || inputError || !search || !spaceId) return;
    let obsolete = false;
    const timer = window.setTimeout(() => {
      void Promise.resolve().then(() => search({ query: normalizedQuery, spaceId })).then(hits => {
        if (!obsolete) setCompletion({ scope, hits, error: null });
      }).catch(error => {
        if (!obsolete) setCompletion({ scope, hits: [], error: error instanceof Error ? error.message : '正文搜索失败，请重试。' });
      });
    }, 180);
    return () => { obsolete = true; window.clearTimeout(timer); };
  }, [scope, requested, inputError, normalizedQuery, search, spaceId]);

  if (!requested) return { state: 'idle' as const, hits: EMPTY_HITS, error: null };
  if (inputError) return { state: 'error' as const, hits: EMPTY_HITS, error: inputError };
  if (completion?.scope !== scope) return { state: 'loading' as const, hits: EMPTY_HITS, error: null };
  return { state: completion.error ? 'error' as const : 'ready' as const, hits: completion.hits, error: completion.error };
}

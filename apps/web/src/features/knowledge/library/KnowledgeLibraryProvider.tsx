import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useAppStore } from '../../../store/AppStoreProvider';
import { useLocation } from '../../../app/router';
import { sharedConceptStore } from '../concepts/conceptStore';
import { createKnowledgeLibraryCache } from './knowledgeLibraryCache';
const LibraryContext = createContext<ReturnType<typeof createKnowledgeLibraryCache> | null>(null);
/** 侧栏与页面共享列表请求；每个资料空间持有独立缓存。 */
export function KnowledgeLibraryProvider({ children }: { children: ReactNode }) {
  const list = useAppStore(state => state.listKnowledgeItems);
  const generation = useAppStore(state => state.knowledgeGeneration);
  const space = useAppStore(state => state.serverData.currentSpaceId);
  const mode = useAppStore(state => state.dataMode);
  const active = useLocation().pathname.startsWith('/knowledge');
  const cache = useMemo(
    () => ({ ...createKnowledgeLibraryCache(() => list({ includeDeleted: true })), space }),
    [list, space]
  );
  const previous = useRef({ cache, generation, mode });
  useEffect(() => {
    if (
      previous.current.cache === cache &&
      (previous.current.generation !== generation || previous.current.mode !== mode)
    )
      cache.invalidate();
    previous.current = { cache, generation, mode };
    if (active && mode === 'api') {
      void cache.list().catch(() => {});
      void sharedConceptStore().load();
    }
  }, [active, mode, cache, generation]);
  return <LibraryContext.Provider value={cache}>{children}</LibraryContext.Provider>;
}
export function useKnowledgeLibraryCache() {
  return useContext(LibraryContext);
}

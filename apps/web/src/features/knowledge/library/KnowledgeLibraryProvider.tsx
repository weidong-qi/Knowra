import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { useAppStore, useAppStoreApi } from '../../../store/AppStoreProvider';
import { useLocation } from '../../../app/router';
import { sharedConceptStore } from '../concepts/conceptStore';
import { createKnowledgeLibraryCache } from './knowledgeLibraryCache';
export const KnowledgeLibraryContext = createContext<ReturnType<typeof createKnowledgeLibraryCache> | null>(null);
/** 侧栏与页面共享列表请求；每个资料空间持有独立缓存。 */
export function KnowledgeLibraryProvider({ children }: { children: ReactNode }) {
  const store = useAppStoreApi();
  const list = useAppStore(state => state.listKnowledgeItems);
  const generation = useAppStore(state => state.knowledgeGeneration);
  const space = useAppStore(state => state.serverData.currentSpaceId);
  const mode = useAppStore(state => state.dataMode);
  const active = useLocation().pathname.startsWith('/knowledge');
  const cache = useMemo(
    () => ({
      ...createKnowledgeLibraryCache(
        () => list({ includeDeleted: true }),
        () => store.getState().knowledgeGeneration
      ),
      space
    }),
    [list, space, store]
  );
  const previous = useRef({ cache, generation, mode });
  useEffect(() => {
    if (
      previous.current.cache === cache &&
      (previous.current.generation !== generation || (previous.current.mode === 'api' && mode !== 'api'))
    )
      cache.invalidate();
    previous.current = { cache, generation, mode };
    if (active && mode === 'api') {
      void cache.list().catch(() => {});
      void sharedConceptStore().load();
    }
  }, [active, mode, cache, generation]);
  return <KnowledgeLibraryContext.Provider value={cache}>{children}</KnowledgeLibraryContext.Provider>;
}
export function useKnowledgeLibraryCache() {
  return useContext(KnowledgeLibraryContext);
}

const emptyLibrary = {
  items: [] as import('@study-accelerator/web-core').KnowledgeItem[],
  status: 'idle' as const,
  error: ''
};
const emptySnapshot = () => emptyLibrary;
const emptySubscribe = () => () => {};
export function useKnowledgeLibraryData() {
  const cache = useKnowledgeLibraryCache();
  const data = useSyncExternalStore(cache?.subscribe ?? emptySubscribe, cache?.getState ?? emptySnapshot);
  return { cache, ...data };
}

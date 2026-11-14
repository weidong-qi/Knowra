import type { KnowledgeItem } from '@study-accelerator/web-core';
export function createKnowledgeLibraryCache(
  loader: () => Promise<KnowledgeItem[]>,
  sourceGeneration: () => unknown = () => undefined
) {
  let state = { items: [] as KnowledgeItem[], status: 'idle' as 'idle' | 'loading' | 'ready' | 'error', error: '' };
  const listeners = new Set<() => void>();
  let generation = 0;
  let sourceVersion = sourceGeneration();
  let loading: Promise<KnowledgeItem[]> | null = null;
  const set = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch };
    listeners.forEach(fn => fn());
  };
  const list = (): Promise<KnowledgeItem[]> => {
    if (sourceVersion !== sourceGeneration()) {
      sourceVersion = sourceGeneration();
      generation += 1;
      set({ status: 'idle' });
    }
    if (loading) return loading;
    if (state.status === 'ready') return Promise.resolve(state.items);
    set({ status: 'loading', error: '' });
    loading = (async () => {
      for (;;) {
        const version = generation;
        const source = sourceGeneration();
        try {
          const items = await loader();
          if (version !== generation || source !== sourceGeneration()) continue;
          sourceVersion = source;
          set({ items, status: 'ready' });
          return items;
        } catch (error) {
          if (version !== generation || source !== sourceGeneration()) continue;
          set({ status: 'error', error: error instanceof Error ? error.message : '知识列表加载失败' });
          throw error;
        }
      }
    })().finally(() => {
      loading = null;
    });
    return loading;
  };
  return {
    getState: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    list,
    invalidate() {
      generation += 1;
      set({ status: 'idle' });
    },
    accept(item: KnowledgeItem) {
      generation += 1;
      set({
        items: state.items.some(row => row.id === item.id)
          ? state.items.map(row => (row.id === item.id ? item : row))
          : [item, ...state.items]
      });
    },
    remove(id: string) {
      generation += 1;
      set({ items: state.items.filter(row => row.id !== id) });
    }
  };
}
export type KnowledgeLibraryCache = ReturnType<typeof createKnowledgeLibraryCache>;

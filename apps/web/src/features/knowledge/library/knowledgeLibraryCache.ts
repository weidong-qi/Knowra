import type { KnowledgeItem } from '@study-accelerator/web-core';
export function createKnowledgeLibraryCache(loader: () => Promise<KnowledgeItem[]>) {
  let state = { items: [] as KnowledgeItem[], status: 'idle' as 'idle' | 'loading' | 'ready' | 'error', error: '' };
  const listeners = new Set<() => void>();
  let generation = 0;
  let loading: Promise<KnowledgeItem[]> | null = null;
  const set = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch };
    listeners.forEach(fn => fn());
  };
  const list = (): Promise<KnowledgeItem[]> => {
    if (loading) return loading;
    if (state.status === 'ready') return Promise.resolve(state.items);
    set({ status: 'loading', error: '' });
    loading = (async () => {
      for (;;) {
        const version = generation;
        try {
          const items = await loader();
          if (version !== generation) continue;
          set({ items, status: 'ready' });
          return items;
        } catch (error) {
          if (version !== generation) continue;
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

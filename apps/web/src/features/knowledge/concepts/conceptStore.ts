import { useSyncExternalStore } from 'react';
import {
  ApiRequestError,
  createApiClient,
  emptyConceptState,
  mergeConceptChanges,
  type ConceptCommand,
  type ConceptState
} from '@study-accelerator/web-core';
export interface ConceptStoreState extends ConceptState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  unavailable: boolean;
  error: string | null;
  pending: boolean;
  undo: { id: string; revision: number } | null;
}
export function createConceptStore(requestJson = createApiClient().requestJson) {
  let state: ConceptStoreState = {
    ...emptyConceptState(),
    status: 'idle',
    unavailable: false,
    error: null,
    pending: false,
    undo: null
  };
  const listeners = new Set<() => void>();
  let generation = 0;
  let loading: Promise<void> | null = null;
  const set = (patch: Partial<ConceptStoreState>) => {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  };
  const load = (): Promise<void> => {
    if (loading) return loading;
    set({ status: state.status === 'ready' ? 'ready' : 'loading', error: null });
    loading = (async () => {
      try {
        for (;;) {
          const version = generation;
          const { data } = await requestJson<{ data: ConceptState }>('/api/knowledge/concepts');
          if (version !== generation) continue;
          set({ ...data, status: 'ready', unavailable: false });
          return;
        }
      } catch (error) {
        set({
          status: 'error',
          unavailable: error instanceof ApiRequestError && error.code === 'KNOWLEDGE_CONCEPTS_UNAVAILABLE',
          error: error instanceof Error ? error.message : '概念加载失败'
        });
      }
    })().finally(() => {
      loading = null;
    });
    return loading;
  };
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    async execute(command: ConceptCommand) {
      if (state.pending || state.status !== 'ready' || state.unavailable)
        throw new Error('请等待概念加载或当前操作完成');
      set({ pending: true, error: null });
      try {
        const { data } = await requestJson<{ data: { changed: ConceptState } }>('/api/knowledge/concepts/commands', {
          method: 'POST',
          body: JSON.stringify({ command })
        });
        generation += 1;
        set({
          ...mergeConceptChanges(state, data.changed),
          undo:
            command.type === 'deleteConcept'
              ? { id: command.id, revision: data.changed.concepts.find(row => row.id === command.id)!.revision }
              : state.undo,
          pending: false
        });
        return data.changed;
      } catch (error) {
        set({ pending: false, error: error instanceof Error ? error.message : '概念操作失败' });
        if (
          error instanceof ApiRequestError &&
          [
            'CONCEPT_REVISION_CONFLICT',
            'CONCEPT_MERGED',
            'CONCEPT_NOT_FOUND',
            'CONCEPT_RELATION_BASIS_INVALID'
          ].includes(error.code ?? '')
        )
          void load();
        throw error;
      }
    },
    dismissUndo() {
      set({ undo: null });
    }
  };
}
export type ConceptStore = ReturnType<typeof createConceptStore>;
let shared: ConceptStore | null = null;
export function sharedConceptStore() {
  return (shared ??= createConceptStore());
}
export function useConceptState(store = sharedConceptStore()) {
  return useSyncExternalStore(store.subscribe, store.getState);
}
export function setSharedConceptStore(store: ConceptStore | null) {
  shared = store;
}

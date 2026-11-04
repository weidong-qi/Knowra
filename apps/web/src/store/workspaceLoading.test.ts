import { createEmptyWorkspaceSnapshot, type WorkspaceApi, type KeyValueStorage } from '@study-accelerator/web-core';
import { createAppStore } from './createAppStore';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const spaces = [{ id: 'a' }, { id: 'b' }];
function resources(id: string) {
  return { folderTree: [], tags: [], notes: [{ id, title: id, spaceId: 'a', rawMarkdown: '', contentLoaded: false, deleted: false, favorite: false, folderId: null, tagIds: [], internalLinks: [] }] };
}
function setup(persistenceMode: 'remote' | 'desktop-local' = 'remote') {
  const values = new Map<string, string>();
  const storage: KeyValueStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
  const api = { listKnowledgeSpaces: vi.fn().mockResolvedValue(spaces), loadWorkspaceResources: vi.fn().mockResolvedValue(resources('initial')) } as unknown as WorkspaceApi;
  const store = createAppStore({ api, storage, persistenceMode, cacheKey: 'loading', mockSnapshot: createEmptyWorkspaceSnapshot() });
  return { api, store, storage };
}

describe('workspace loading request ownership', () => {
  it.each(['success', 'failure'] as const)('ignores stale %s after a newer retry commits', async outcome => {
    const { api, store, storage } = setup();
    await store.getState().loadWorkspace();
    const old = deferred<ReturnType<typeof resources>>();
    vi.mocked(api.loadWorkspaceResources).mockReturnValueOnce(old.promise).mockResolvedValueOnce(resources('new'));
    const first = store.getState().loadWorkspace();
    await vi.waitFor(() => expect(api.loadWorkspaceResources).toHaveBeenCalledTimes(2));
    await store.getState().retryWorkspace();
    const snapshot = store.getState().serverData;
    const cache = storage.getItem('loading');
    if (outcome === 'success') old.resolve(resources('old'));
    else old.reject(new Error('old failure'));
    await first;
    expect(store.getState().serverData).toBe(snapshot);
    expect(store.getState().dataMode).toBe('api');
    expect(store.getState().workspaceError).toBeNull();
    expect(storage.getItem('loading')).toBe(cache);
  });

  it('keeps the newer request active when the obsolete request finishes', async () => {
    const { api, store } = setup();
    const old = deferred<ReturnType<typeof resources>>();
    const newer = deferred<ReturnType<typeof resources>>();
    vi.mocked(api.loadWorkspaceResources).mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise);
    const first = store.getState().loadWorkspace();
    await vi.waitFor(() => expect(api.loadWorkspaceResources).toHaveBeenCalledTimes(1));
    const retry = store.getState().retryWorkspace();
    await vi.waitFor(() => expect(api.loadWorkspaceResources).toHaveBeenCalledTimes(2));
    old.resolve(resources('old')); await first;
    const joined = store.getState().loadWorkspace();
    expect(api.listKnowledgeSpaces).toHaveBeenCalledTimes(2);
    newer.resolve(resources('new')); await Promise.all([retry, joined]);
    expect(store.getState().serverData.notes[0]?.id).toBe('new');
  });

  it('uses request identity for repeated A → B → A selections', async () => {
    const { api, store, storage } = setup();
    await store.getState().loadWorkspace();
    const firstA = deferred<ReturnType<typeof resources>>();
    const middleB = deferred<ReturnType<typeof resources>>();
    vi.mocked(api.loadWorkspaceResources).mockReturnValueOnce(firstA.promise).mockReturnValueOnce(middleB.promise)
      .mockResolvedValueOnce(resources('latest-a')).mockResolvedValueOnce(resources('latest-a'));
    const first = store.getState().selectKnowledgeSpace('a');
    const middle = store.getState().selectKnowledgeSpace('b');
    await store.getState().selectKnowledgeSpace('a');
    const snapshot = store.getState().serverData;
    const cache = storage.getItem('loading');
    middleB.resolve(resources('old-b')); firstA.resolve(resources('old-a'));
    await Promise.all([first, middle]);
    expect(store.getState().serverData).toBe(snapshot);
    expect(snapshot.currentSpaceId).toBe('a');
    expect(snapshot.notes[0]?.id).toBe('latest-a');
    expect(storage.getItem('loading')).toBe(cache);
    expect(api.loadWorkspaceResources).toHaveBeenCalledTimes(5);
  });

  it('preserves target preflight rejection and leaves the current workspace available', async () => {
    const { api, store } = setup();
    await store.getState().loadWorkspace();
    const before = store.getState().serverData;
    vi.mocked(api.loadWorkspaceResources).mockRejectedValueOnce(new Error('target unavailable'));
    await expect(store.getState().selectKnowledgeSpace('b')).rejects.toThrow('target unavailable');
    expect(store.getState().serverData).toBe(before);
    expect(store.getState().dataMode).toBe('api');
    await store.getState().loadWorkspace();
    expect(api.listKnowledgeSpaces).toHaveBeenCalledTimes(2);
  });

  it('does not create a default space or request resources after an obsolete spaces response', async () => {
    const { api, store } = setup();
    api.createDefaultKnowledgeSpace = vi.fn();
    const old = deferred<typeof spaces>();
    vi.mocked(api.listKnowledgeSpaces).mockReturnValueOnce(old.promise);
    const first = store.getState().loadWorkspace();
    await store.getState().retryWorkspace();
    old.resolve([]); await first;
    expect(api.createDefaultKnowledgeSpace).not.toHaveBeenCalled();
    expect(api.loadWorkspaceResources).toHaveBeenCalledTimes(1);
  });

  it('does not publish a cache write when a store subscriber starts a newer request', async () => {
    const { api, store, storage } = setup();
    const next = deferred<ReturnType<typeof resources>>();
    vi.mocked(api.loadWorkspaceResources).mockReturnValueOnce(Promise.resolve(resources('first'))).mockReturnValueOnce(next.promise);
    let retry: Promise<void> | undefined;
    const unsubscribe = store.subscribe(state => {
      if (state.dataMode === 'api' && !retry) retry = store.getState().retryWorkspace();
    });
    await store.getState().loadWorkspace();
    expect(storage.getItem('loading')).toBeNull();
    unsubscribe(); next.resolve(resources('next')); await retry;
    expect(JSON.parse(storage.getItem('loading')!).allNotes[0].id).toBe('next');
  });

  it('rejects in-flight desktop refresh after a load starts and permits a later refresh', async () => {
    const { api, store } = setup('desktop-local');
    await store.getState().loadWorkspace();
    const background = deferred<ReturnType<typeof resources>>();
    const foreground = deferred<ReturnType<typeof resources>>();
    vi.mocked(api.loadWorkspaceResources).mockReturnValueOnce(background.promise).mockReturnValueOnce(foreground.promise);
    const refresh = store.getState().refreshLocalWorkspace();
    await vi.waitFor(() => expect(api.loadWorkspaceResources).toHaveBeenCalledTimes(2));
    const retry = store.getState().retryWorkspace();
    await vi.waitFor(() => expect(api.loadWorkspaceResources).toHaveBeenCalledTimes(3));
    await expect(store.getState().refreshLocalWorkspace()).resolves.toBe(false);
    background.resolve(resources('background'));
    await expect(refresh).resolves.toBe(false);
    expect(store.getState().knowledgeGeneration).toBe(0);
    foreground.resolve(resources('foreground')); await retry;
    await expect(store.getState().refreshLocalWorkspace()).resolves.toBe(true);
    expect(store.getState().knowledgeGeneration).toBe(1);
    store.getState().setEditorHasLocalChanges(true);
    await expect(store.getState().refreshLocalWorkspace()).resolves.toBe(false);
  });


  it.each(['success', 'failure'] as const)('finishes interrupted loading when target preflight fails and recovery is %s', async outcome => {
    const { api, store } = setup();
    await store.getState().loadWorkspace();
    const old = deferred<ReturnType<typeof resources>>();
    vi.mocked(api.loadWorkspaceResources).mockReturnValueOnce(old.promise)
      .mockRejectedValueOnce(new Error('target unavailable'));
    if (outcome === 'success') vi.mocked(api.loadWorkspaceResources).mockResolvedValueOnce(resources('recovered'));
    else vi.mocked(api.loadWorkspaceResources).mockRejectedValueOnce(new Error('recovery offline'));
    const retry = store.getState().retryWorkspace();
    await vi.waitFor(() => expect(api.loadWorkspaceResources).toHaveBeenCalledTimes(2));
    await expect(store.getState().selectKnowledgeSpace('b')).rejects.toThrow('target unavailable');
    const final = store.getState().serverData;
    expect(store.getState().workspaceLoadState).toBe(outcome === 'success' ? 'ready' : 'error');
    expect(store.getState().dataMode).toBe(outcome === 'success' ? 'api' : 'cache');
    expect(store.getState().canWriteWorkspace()).toBe(outcome === 'success');
    expect(final.currentSpaceId).toBe('a');
    old.resolve(resources('old')); await retry;
    expect(store.getState().serverData).toBe(final);
  });

  it('does not publish a failed selection after another request takes over its recovery', async () => {
    const { api, store } = setup();
    await store.getState().loadWorkspace();
    const old = deferred<ReturnType<typeof resources>>();
    const recovery = deferred<ReturnType<typeof resources>>();
    vi.mocked(api.loadWorkspaceResources).mockReturnValueOnce(old.promise)
      .mockRejectedValueOnce(new Error('target unavailable')).mockReturnValueOnce(recovery.promise);
    const retry = store.getState().retryWorkspace();
    await vi.waitFor(() => expect(api.loadWorkspaceResources).toHaveBeenCalledTimes(2));
    const selection = store.getState().selectKnowledgeSpace('b');
    await vi.waitFor(() => expect(api.loadWorkspaceResources).toHaveBeenCalledTimes(4));
    await store.getState().retryWorkspace();
    const final = store.getState().serverData;
    recovery.reject(new Error('obsolete recovery')); old.resolve(resources('old'));
    await expect(selection).resolves.toBeUndefined(); await retry;
    expect(store.getState().serverData).toBe(final);
    expect(store.getState().workspaceLoadState).toBe('ready');
    expect(store.getState().workspaceError).toBeNull();
  });


  it('joins the request from a synchronous subscriber to its initial loading state', async () => {
    const { api, store } = setup();
    let joined: Promise<void> | undefined;
    let observed = false;
    const unsubscribe = store.subscribe(state => {
      if (!observed && state.workspaceLoadState === 'loading') {
        observed = true;
        joined = store.getState().loadWorkspace();
      }
    });
    const loading = store.getState().loadWorkspace();
    expect(joined).toBe(loading);
    await Promise.all([loading, joined]);
    unsubscribe();
    expect(api.listKnowledgeSpaces).toHaveBeenCalledTimes(1);
    expect(store.getState().workspaceLoadState).toBe('ready');
  });

});

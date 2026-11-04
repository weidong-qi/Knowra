import { createEmptyWorkspaceSnapshot, normalizeNotes, type Note, type WorkspaceApi } from '@study-accelerator/web-core';
import { createAppStore } from './createAppStore';

function deferred() {
  let resolve!: (note: Note) => void, reject!: (error: Error) => void;
  const promise = new Promise<Note>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const detail = () => normalizeNotes([{ id: 'unseen', spaceId: 'space-a', title: '完整详情标题', folderId: null,
  rawMarkdown: '# 正式详情\n\n真实完整正文与搜索片段不同。', deleted: false, tagIds: ['tag-a'] }])[0];

function setup() {
  const getNote = vi.fn().mockResolvedValue(detail());
  const api = { getNote } as unknown as WorkspaceApi;
  const cache = new Map<string, string>();
  const storage = { getItem: (key: string) => cache.get(key) ?? null, setItem: (key: string, value: string) => { cache.set(key, value); } };
  const store = createAppStore({ api, storage, cacheKey: 'synthetic-command-detail', mockSnapshot: createEmptyWorkspaceSnapshot() });
  store.setState(state => ({ dataMode: 'api', workspaceLoadState: 'ready', serverData: { ...state.serverData,
    currentSpaceId: 'space-a', spaces: [{ id: 'space-a' }, { id: 'space-b' }] } }));
  const load = (isCurrent = () => true) => store.getState().loadCommandNote({ noteId: 'unseen', spaceId: 'space-a', isCurrent });
  return { store, getNote, cache, load };
}

describe('正文命中详情载入', () => {
  it('未知 ID 插入完整归一化详情与缓存，保留已载笔记和草稿/保存状态', async () => {
    const { store, getNote, cache, load } = setup();
    const existing = normalizeNotes([{ id: 'edited', spaceId: 'space-a', title: '当前草稿', rawMarkdown: '保留已载正文' }])[0];
    store.setState(state => ({ editorHasLocalChanges: true, saveState: 'saving',
      serverData: { ...state.serverData, notes: [existing] } }));
    const loaded = await load();
    expect(loaded?.note).toEqual(expect.objectContaining({ ...detail(), contentLoaded: true }));
    expect(loaded?.snapshot).toBe(store.getState().serverData);
    expect(getNote).toHaveBeenCalledExactlyOnceWith('unseen');
    expect(store.getState().serverData.notes).toEqual([existing, detail()]);
    expect(store.getState().serverData.notes[0]).toBe(existing);
    expect(store.getState().editorHasLocalChanges).toBe(true);
    expect(store.getState().saveState).toBe('saving');
    expect(store.getState().navigation.selectedNoteId).toBeNull();
    expect(JSON.parse(cache.get('synthetic-command-detail')!).allNotes).toEqual(expect.arrayContaining([expect.objectContaining(detail())]));
  });

  it('已有笔记沿用原正文加载路径，不覆盖已载正文或重复详情请求', async () => {
    const { store, getNote, load } = setup();
    const existing = { ...detail(), contentLoaded: false, rawMarkdown: '' };
    store.setState(state => ({ serverData: { ...state.serverData, notes: [existing] } }));
    expect((await load())?.note).toBe(existing);
    expect(getNote).not.toHaveBeenCalled();
  });

  it.each([
    ['错误 ID', { id: 'another' }, '与搜索命中不一致'],
    ['其他空间', { spaceId: 'space-b' }, '不属于当前空间'],
    ['回收站', { deleted: true }, '已被删除'],
    ['缺少 deleted 标记', { deleted: undefined }, '不完整'],
    ['摘要代替正文', { rawMarkdown: undefined, snippet: '不能当正文' }, '不完整']
  ])('拒绝%s详情，不插入笔记或污染保存状态', async (_, override, message) => {
    const { store, getNote, cache, load } = setup();
    getNote.mockResolvedValue({ ...detail(), ...override });
    const before = store.getState();
    await expect(load()).rejects.toThrow(String(message));
    expect(store.getState().serverData).toBe(before.serverData);
    expect(store.getState().saveError).toBe(before.saveError);
    expect(cache.size).toBe(0);
  });

  it.each(['笔记不存在（404）', '详情服务不可用'])('保留真实获取错误：%s', async message => {
    const { store, getNote, load } = setup();
    const error = new Error(message);
    getNote.mockRejectedValue(error);
    await expect(load()).rejects.toBe(error);
    expect(store.getState().serverData.notes).toEqual([]);
  });

  it.each(['space-roundtrip', 'dataset', 'generation', 'mode', 'cancel'])('迟到详情不能写入变化后的范围：%s', async change => {
    const { store, getNote, cache, load } = setup();
    const pending = deferred();
    getNote.mockReturnValue(pending.promise);
    let current = true;
    const result = load(() => current);
    if (change === 'space-roundtrip') {
      store.setState(state => ({ serverData: { ...state.serverData, currentSpaceId: 'space-b' } }));
      store.setState(state => ({ serverData: { ...state.serverData, currentSpaceId: 'space-a' } }));
    } else if (change === 'dataset') {
      store.setState(state => ({ serverData: { ...state.serverData, notes: normalizeNotes([{ id: 'new-dataset-note', rawMarkdown: '新快照' }]) } }));
    } else if (change === 'generation') store.setState(state => ({ knowledgeGeneration: state.knowledgeGeneration + 1 }));
    else if (change === 'mode') store.setState({ dataMode: 'cache' });
    else current = false;
    const afterChange = store.getState().serverData;
    pending.resolve(detail());
    expect(await result).toBeNull();
    expect(store.getState().serverData).toBe(afterChange);
    expect(store.getState().serverData.notes.some(note => note.id === 'unseen')).toBe(false);
    expect(cache.size).toBe(0);
  });

  it('已取消的迟到错误被丢弃，且非 API 范围不能发详情请求', async () => {
    const { store, getNote, load } = setup();
    const pending = deferred();
    getNote.mockReturnValue(pending.promise);
    let current = true;
    const result = load(() => current);
    current = false;
    pending.reject(new Error('旧请求失败'));
    expect(await result).toBeNull();
    store.setState({ dataMode: 'cache' });
    await expect(load()).rejects.toThrow('尚未就绪');
    expect(getNote).toHaveBeenCalledTimes(1);
  });
});

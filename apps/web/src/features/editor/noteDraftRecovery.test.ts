import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createNoteDraftRecovery } from './noteDraftRecovery';
import { useNoteAutosave } from './useNoteAutosave';

afterEach(() => { sessionStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('restores a conflict after editor unmount and page reload without changing its baseline', async () => {
  vi.useFakeTimers();
  const onSave = vi.fn().mockRejectedValue(Object.assign(new Error('冲突'), { status: 409, code: 'NOTE_UPDATE_CONFLICT' }));
  const options = { noteId: 'a', draftScope: 'space', remoteMarkdown: '原文', remoteUpdatedAt: 'v1', canWrite: true, onSave };
  const store = createNoteDraftRecovery();
  const first = renderHook(() => useNoteAutosave({ ...options, recoveryStore: store }));
  act(() => first.result.current.updateDraft('冲突草稿', { immediate: true }));
  await act(async () => vi.advanceTimersByTimeAsync(700));
  first.unmount();
  const freshStore = createNoteDraftRecovery();
  const second = renderHook(() => useNoteAutosave({ ...options, remoteMarkdown: '另一端正文', remoteUpdatedAt: 'v2', recoveryStore: freshStore }));
  expect(second.result.current.draftMarkdown).toBe('冲突草稿');
  expect(second.result.current.hasConflict).toBe(true);
  expect(freshStore.read('space', 'a')?.baseUpdatedAt).toBe('v1');
  await act(async () => vi.advanceTimersByTimeAsync(1400));
  expect(onSave).toHaveBeenCalledTimes(1);
  await expect(second.result.current.saveNow()).rejects.toThrow('冲突');
  second.unmount();
});

it('does not resurrect a removed draft in memory when browser storage removal fails', () => {
  const store = createNoteDraftRecovery();
  const draft = { markdown: 'draft', baseMarkdown: 'base' };
  store.write('s', 'removed', draft);
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
  store.remove('s', 'removed', draft);
  expect(store.read('s', 'removed')).toBeUndefined();
});

it('a late save from an unmounted editor cannot remove a newer recovered draft', async () => {
  vi.useFakeTimers();
  const store = createNoteDraftRecovery();
  let resolve!: (value: { updatedAt: string }) => void;
  const onSave = vi.fn().mockReturnValue(new Promise(r => { resolve = r; }));
  const options = { noteId: 'late', draftScope: 'space', recoveryStore: store, remoteMarkdown: 'base', remoteUpdatedAt: 'v1', canWrite: true, onSave };
  const first = renderHook(() => useNoteAutosave(options));
  act(() => first.result.current.updateDraft('first'));
  first.unmount();
  await act(async () => Promise.resolve());
  const second = renderHook(() => useNoteAutosave(options));
  act(() => second.result.current.updateDraft('newer', { immediate: true }));
  await act(async () => resolve({ updatedAt: 'v2' }));
  expect(store.read('space', 'late')?.markdown).toBe('newer');
  expect(second.result.current.getLatestMarkdown()).toBe('newer');
  second.unmount();
});

it('retains failed saves across routes when session storage is unavailable, scoped by space', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  const store = createNoteDraftRecovery();
  const onSave = vi.fn().mockRejectedValue(new Error('offline'));
  const options = { noteId: 'offline', draftScope: 'one', recoveryStore: store, remoteMarkdown: 'base', remoteUpdatedAt: 'v1', canWrite: true, onSave };
  const first = renderHook(() => useNoteAutosave(options));
  act(() => first.result.current.updateDraft('unsaved', { immediate: true }));
  first.unmount();
  await act(async () => Promise.resolve());
  const other = renderHook(() => useNoteAutosave({ ...options, draftScope: 'two' }));
  expect(other.result.current.draftMarkdown).toBe('base');
  other.unmount();
  const second = renderHook(() => useNoteAutosave({ ...options, canWrite: false }));
  expect(second.result.current.draftMarkdown).toBe('unsaved');
  await act(async () => second.result.current.saveNow());
  expect(onSave).toHaveBeenCalledTimes(1);
  second.unmount();
});

it('clears recovery only after a successful save and keeps the original expectedUpdatedAt on retry', async () => {
  const store = createNoteDraftRecovery();
  store.write('s', 'retry', { markdown: 'draft', baseMarkdown: 'base', baseUpdatedAt: 'v1' });
  const onSave = vi.fn().mockResolvedValue({ rawMarkdown: 'draft', updatedAt: 'v2' });
  const hook = renderHook(() => useNoteAutosave({ noteId: 'retry', draftScope: 's', recoveryStore: store, remoteMarkdown: 'base', remoteUpdatedAt: 'v1', canWrite: true, onSave }));
  await act(async () => hook.result.current.saveNow());
  expect(onSave).toHaveBeenCalledWith('retry', 'draft', 'v1', 'base');
  expect(store.read('s', 'retry')).toBeUndefined();
  expect(createNoteDraftRecovery().read('s', 'retry')).toBeUndefined();
  hook.unmount();
});

it('正文未变时恢复旧冲突草稿并使用重新读取的版本保存', async () => {
  const recoveryStore = createNoteDraftRecovery();
  recoveryStore.write('s', 'metadata', { markdown: '草稿', baseMarkdown: '原文', baseUpdatedAt: 'v1', conflict: 'Note has changed since it was loaded' });
  const onSave = vi.fn().mockResolvedValue({ rawMarkdown: '草稿', updatedAt: 'v3' });
  const hook = renderHook(() => useNoteAutosave({ noteId: 'metadata', draftScope: 's', recoveryStore, remoteMarkdown: '原文', remoteUpdatedAt: 'v2', canWrite: true, onSave }));
  expect(hook.result.current.hasConflict).toBe(false);
  expect(hook.result.current.draftMarkdown).toBe('草稿');
  await act(async () => hook.result.current.saveNow());
  expect(onSave).toHaveBeenCalledWith('metadata', '草稿', 'v2', '原文');
  expect(recoveryStore.read('s', 'metadata')).toBeUndefined();
  hook.unmount();
});

it('桌面草稿必须收到落盘确认，失败时 flush 拒绝；重建存储可读取', async () => {
  const disk: Record<string, unknown> = {};
  const write = vi.fn(async (key: string, draft: unknown) => { if (draft === null) delete disk[key]; else disk[key] = draft; });
  window.knowraDesktop = { onPrepareClose: () => {}, onCancelClose: () => {}, readRecoveryDrafts: () => disk, writeRecoveryDraft: write };
  try {
    const store = createNoteDraftRecovery();
    const draft = { markdown: '桌面草稿', baseMarkdown: '原文' };
    store.write('s', 'n', draft);
    await store.flush();
    expect(createNoteDraftRecovery().read('s', 'n')).toEqual(draft);
    write.mockRejectedValue(new Error('磁盘已满'));
    store.write('s', 'n', { ...draft, markdown: '更新草稿' });
    await expect(store.flush()).rejects.toThrow('磁盘已满');
    expect(createNoteDraftRecovery().read('s', 'n')?.markdown).toBe('桌面草稿');
  } finally { delete window.knowraDesktop; }
});

it('丢响应后重启，正文已等于草稿时不会误报冲突', () => {
  const store = createNoteDraftRecovery();
  store.write('s', 'ack', { markdown: '已写入', baseMarkdown: '原文', baseUpdatedAt: 'v1' });
  const hook = renderHook(() => useNoteAutosave({ noteId: 'ack', draftScope: 's', recoveryStore: store, remoteMarkdown: '已写入', remoteUpdatedAt: 'v2', canWrite: true, onSave: vi.fn() }));
  expect(hook.result.current.hasConflict).toBe(false);
  expect(hook.result.current.hasLocalChanges).toBe(false);
  expect(store.read('s', 'ack')).toBeUndefined();
  hook.unmount();
});

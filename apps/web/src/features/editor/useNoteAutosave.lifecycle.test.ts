import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNoteDraftRecovery } from './noteDraftRecovery';
import { useNoteAutosave, type NoteAutosaveSaveResult } from './useNoteAutosave';

const desktop = vi.hoisted(() => ({
  callbacks: [] as Array<(mode?: 'save' | 'recovery') => Promise<void>>,
  remove: vi.fn()
}));

vi.mock('../../app/desktopLifecycle', () => ({
  registerDesktopSave: vi.fn((callback: (mode?: 'save' | 'recovery') => Promise<void>) => {
    desktop.callbacks.push(callback);
    return desktop.remove;
  })
}));
vi.mock('../../app/runtimeConfig', () => ({
  readRuntimeConfig: () => ({ persistenceMode: 'desktop-local' })
}));

const draftScope = 'autosave-lifecycle-test';
const mapping = expect.objectContaining({ formatVersion: 1, edits: expect.any(Array) });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function desktopSave() {
  expect(desktop.callbacks).toHaveLength(1);
  return desktop.callbacks[0];
}

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  desktop.callbacks.length = 0;
  desktop.remove.mockClear();
});

afterEach(async () => {
  await act(async () => { cleanup(); });
  vi.clearAllTimers();
  vi.useRealTimers();
  sessionStorage.clear();
});

describe('正文保存的桌面退出生命周期', () => {
  it('关窗保存等待已发送请求，再用响应基线保存最新待写草稿并清理恢复记录', async () => {
    const first = deferred<NoteAutosaveSaveResult>();
    const second = deferred<NoteAutosaveSaveResult>();
    const recoveryStore = createNoteDraftRecovery();
    const flush = vi.spyOn(recoveryStore, 'flush');
    const onSave = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useNoteAutosave({
      noteId: 'note-a', remoteMarkdown: 'A', remoteUpdatedAt: 'v1',
      draftScope, recoveryStore, canWrite: true, onSave, renderDelayMs: 0
    }));
    act(() => result.current.updateDraft('A1'));
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    act(() => result.current.updateDraft('A2'));

    let closing!: Promise<void>;
    const completed = vi.fn();
    await act(async () => { closing = desktopSave()('save').then(completed); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1400); });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(completed).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();

    await act(async () => { first.resolve({ rawMarkdown: 'A1', updatedAt: 'v2' }); });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenNthCalledWith(2, 'note-a', 'A2', 'v2', 'A1', mapping);
    expect(completed).not.toHaveBeenCalled();
    expect(recoveryStore.read(draftScope, 'note-a')).toMatchObject({
      markdown: 'A2', baseMarkdown: 'A1', baseUpdatedAt: 'v2'
    });
    await act(async () => {
      second.resolve({ rawMarkdown: 'A2', updatedAt: 'v3' });
      await closing;
    });
    expect(completed).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(result.current.hasLocalChanges).toBe(false);
    expect(recoveryStore.read(draftScope, 'note-a')).toBeUndefined();
    expect(createNoteDraftRecovery().read(draftScope, 'note-a')).toBeUndefined();
  });

  it('只读退出保存拒绝，恢复模式仅落盘最新草稿且不发送正文请求', async () => {
    const recoveryStore = createNoteDraftRecovery();
    const flush = vi.spyOn(recoveryStore, 'flush');
    const onSave = vi.fn();
    const { result, rerender } = renderHook(({ canWrite }) => useNoteAutosave({
      noteId: 'note-a', remoteMarkdown: 'A', remoteUpdatedAt: 'v1',
      draftScope, recoveryStore, canWrite, onSave, renderDelayMs: 0
    }), { initialProps: { canWrite: true } });
    act(() => {
      result.current.updateDraft('A1');
      result.current.updateDraft('A2');
    });
    rerender({ canWrite: false });
    const close = desktopSave();
    await act(async () => {
      await expect(close('save')).rejects.toThrow('当前正文尚未保存，请先处理只读或加载状态。');
    });
    expect(flush).not.toHaveBeenCalled();
    await act(async () => { await close('recovery'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1400); });

    expect(onSave).not.toHaveBeenCalled();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(result.current.hasLocalChanges).toBe(true);
    expect(recoveryStore.read(draftScope, 'note-a')).toMatchObject({
      markdown: 'A2', baseMarkdown: 'A', baseUpdatedAt: 'v1'
    });
    expect(createNoteDraftRecovery().read(draftScope, 'note-a')).toMatchObject({
      markdown: 'A2', baseMarkdown: 'A', baseUpdatedAt: 'v1'
    });
  });

  it('卸载保存成功并完成恢复存储刷新后才注销退出保护', async () => {
    const saved = deferred<NoteAutosaveSaveResult>();
    const flushed = deferred<void>();
    const recoveryStore = createNoteDraftRecovery();
    const originalFlush = recoveryStore.flush;
    const flush = vi.spyOn(recoveryStore, 'flush').mockImplementation(async () => {
      await originalFlush();
      await flushed.promise;
    });
    const onSave = vi.fn().mockReturnValue(saved.promise);
    const { result, unmount } = renderHook(() => useNoteAutosave({
      noteId: 'note-a', remoteMarkdown: 'A', remoteUpdatedAt: 'v1',
      draftScope, recoveryStore, canWrite: true, onSave, renderDelayMs: 0
    }));
    act(() => result.current.updateDraft('A1'));
    await act(async () => { unmount(); });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(desktop.remove).not.toHaveBeenCalled();
    await act(async () => { saved.resolve({ rawMarkdown: 'A1', updatedAt: 'v2' }); });
    expect(flush).toHaveBeenCalledTimes(1);
    expect(recoveryStore.read(draftScope, 'note-a')).toBeUndefined();
    expect(desktop.remove).not.toHaveBeenCalled();

    await act(async () => { flushed.resolve(); });
    expect(desktop.remove).toHaveBeenCalledTimes(1);
  });

  it('卸载保存失败时保留退出保护和草稿，仍可通过恢复模式落盘退出', async () => {
    const recoveryStore = createNoteDraftRecovery();
    const flush = vi.spyOn(recoveryStore, 'flush');
    const onSave = vi.fn().mockRejectedValue(new Error('离线保存失败'));
    const { result, unmount } = renderHook(() => useNoteAutosave({
      noteId: 'note-a', remoteMarkdown: 'A', remoteUpdatedAt: 'v1',
      draftScope, recoveryStore, canWrite: true, onSave, renderDelayMs: 0
    }));
    act(() => result.current.updateDraft('未保存草稿'));
    const close = desktopSave();
    await act(async () => { unmount(); });
    expect(onSave).toHaveBeenCalled();
    expect(desktop.remove).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
    expect(recoveryStore.read(draftScope, 'note-a')).toMatchObject({ markdown: '未保存草稿' });

    const callsBeforeRecovery = onSave.mock.calls.length;
    await act(async () => { await close('recovery'); });
    expect(onSave).toHaveBeenCalledTimes(callsBeforeRecovery);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(createNoteDraftRecovery().read(draftScope, 'note-a')).toMatchObject({
      markdown: '未保存草稿', baseMarkdown: 'A', baseUpdatedAt: 'v1'
    });
  });
});

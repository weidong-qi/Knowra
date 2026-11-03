import { act, cleanup, renderHook } from '@testing-library/react';
import { ApiRequestError } from '@study-accelerator/web-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNoteDraftRecovery } from './noteDraftRecovery';
import { useNoteAutosave, type NoteAutosaveSaveResult } from './useNoteAutosave';

const delayMs = 700;
const draftScope = 'autosave-queue-test';
const mapping = expect.objectContaining({ formatVersion: 1, edits: expect.any(Array) });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function advanceAutosave() {
  await act(async () => { await vi.advanceTimersByTimeAsync(delayMs); });
}

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  sessionStorage.clear();
});

describe('正文保存队列', () => {
  it('同正文的新批注修订不会被旧回执清理，下一次保存保留批注映射', async () => {
    const first = deferred<NoteAutosaveSaveResult>();
    const second = deferred<NoteAutosaveSaveResult>();
    const recoveryStore = createNoteDraftRecovery();
    const onSave = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useNoteAutosave({
      noteId: 'note-a', remoteMarkdown: 'A', remoteUpdatedAt: 'v1',
      draftScope, recoveryStore, canWrite: true, onSave, delayMs, renderDelayMs: 0
    }));

    act(() => result.current.updateDraft('B'));
    await advanceAutosave();
    act(() => result.current.updateDraft('B', {
      immediate: true, editIntent: { deletedEmptyAnnotationIds: ['annotation-1'] }
    }));
    await act(async () => { first.resolve({ rawMarkdown: 'B', updatedAt: 'v2' }); });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(result.current.hasLocalChanges).toBe(true);
    expect(result.current.getLatestMarkdown()).toBe('B');
    expect(recoveryStore.read(draftScope, 'note-a')).toMatchObject({
      markdown: 'B', baseMarkdown: 'B', baseUpdatedAt: 'v2',
      annotationEdits: [expect.objectContaining({
        edit: expect.objectContaining({ deletedEmptyAnnotationIds: ['annotation-1'] })
      })]
    });

    await advanceAutosave();
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenNthCalledWith(2, 'note-a', 'B', 'v2', 'B', expect.objectContaining({
      formatVersion: 1,
      edits: [expect.objectContaining({ deletedEmptyAnnotationIds: ['annotation-1'] })]
    }));
    expect(recoveryStore.read(draftScope, 'note-a')).toBeDefined();
    await act(async () => { second.resolve({ rawMarkdown: 'B', updatedAt: 'v3' }); });
    expect(result.current.hasLocalChanges).toBe(false);
    expect(recoveryStore.read(draftScope, 'note-a')).toBeUndefined();
  });

  it('新编辑器接管恢复草稿后旧请求可完成但旧队列不得继续发送或清除新草稿', async () => {
    const first = deferred<NoteAutosaveSaveResult>();
    const obsolete = deferred<NoteAutosaveSaveResult>();
    const recoveryStore = createNoteDraftRecovery();
    const oldOnSave = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(obsolete.promise);
    const oldEditor = renderHook(() => useNoteAutosave({
      noteId: 'note-a', remoteMarkdown: 'A', remoteUpdatedAt: 'v1',
      draftScope, recoveryStore, canWrite: true, onSave: oldOnSave, delayMs, renderDelayMs: 0
    }));
    act(() => oldEditor.result.current.updateDraft('A1'));
    await advanceAutosave();
    act(() => oldEditor.result.current.updateDraft('A2'));
    await advanceAutosave();
    expect(oldOnSave).toHaveBeenCalledTimes(1);

    // 旧实例仍在挂载；新实例读取并改写记录后取得恢复草稿所有权。
    const newOnSave = vi.fn();
    const newEditor = renderHook(() => useNoteAutosave({
      noteId: 'note-a', remoteMarkdown: 'A', remoteUpdatedAt: 'v1',
      draftScope, recoveryStore, canWrite: true, onSave: newOnSave, delayMs, renderDelayMs: 0
    }));
    expect(newEditor.result.current.getLatestMarkdown()).toBe('A2');
    act(() => newEditor.result.current.updateDraft('新编辑器草稿'));
    const newRecovery = recoveryStore.read(draftScope, 'note-a');
    expect(newRecovery).toMatchObject({ markdown: '新编辑器草稿' });

    await act(async () => { first.resolve({ rawMarkdown: 'A1', updatedAt: 'v2' }); });
    expect(oldOnSave).toHaveBeenCalledTimes(1);
    expect(newOnSave).not.toHaveBeenCalled();
    expect(newEditor.result.current.getLatestMarkdown()).toBe('新编辑器草稿');
    expect(newEditor.result.current.draftMarkdown).toBe('新编辑器草稿');
    expect(newEditor.result.current.hasLocalChanges).toBe(true);
    expect(recoveryStore.read(draftScope, 'note-a')).toBe(newRecovery);
    expect(createNoteDraftRecovery().read(draftScope, 'note-a')).toMatchObject({
      markdown: '新编辑器草稿', baseMarkdown: 'A', baseUpdatedAt: 'v1'
    });
  });

  it('排队后变为只读时仅接收已发送响应，恢复可写后用新基线重试并清理草稿', async () => {
    const first = deferred<NoteAutosaveSaveResult>();
    const retry = deferred<NoteAutosaveSaveResult>();
    const recoveryStore = createNoteDraftRecovery();
    const onSave = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    const { result, rerender } = renderHook(({ canWrite }) => useNoteAutosave({
      noteId: 'note-a', remoteMarkdown: 'A', remoteUpdatedAt: 'v1',
      draftScope, recoveryStore, canWrite, onSave, delayMs, renderDelayMs: 0
    }), { initialProps: { canWrite: true } });

    act(() => result.current.updateDraft('A1'));
    await advanceAutosave();
    expect(onSave).toHaveBeenNthCalledWith(1, 'note-a', 'A1', 'v1', 'A', mapping);
    act(() => result.current.updateDraft('A2'));
    await advanceAutosave();
    expect(onSave).toHaveBeenCalledTimes(1);

    rerender({ canWrite: false });
    await act(async () => { first.resolve({ rawMarkdown: 'A1', updatedAt: 'v2' }); });
    await advanceAutosave();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(result.current.getLatestMarkdown()).toBe('A2');
    expect(result.current.draftMarkdown).toBe('A2');
    expect(result.current.hasLocalChanges).toBe(true);
    expect(result.current.hasConflict).toBe(false);
    expect(recoveryStore.read(draftScope, 'note-a')).toMatchObject({
      markdown: 'A2', baseMarkdown: 'A1', baseUpdatedAt: 'v2'
    });

    rerender({ canWrite: true });
    let saving!: Promise<void>;
    await act(async () => { saving = result.current.saveNow(); });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenNthCalledWith(2, 'note-a', 'A2', 'v2', 'A1', mapping);
    await act(async () => {
      retry.resolve({ rawMarkdown: 'A2', updatedAt: 'v3' });
      await saving;
    });
    expect(result.current.hasLocalChanges).toBe(false);
    expect(result.current.saveError).toBeNull();
    expect(recoveryStore.read(draftScope, 'note-a')).toBeUndefined();
    expect(createNoteDraftRecovery().read(draftScope, 'note-a')).toBeUndefined();
  });

  it('旧请求成功时保留尚未发送的最新草稿和恢复记录', async () => {
    const first = deferred<NoteAutosaveSaveResult>();
    const second = deferred<NoteAutosaveSaveResult>();
    const recoveryStore = createNoteDraftRecovery();
    const onSave = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useNoteAutosave({
      noteId: 'note-a', remoteMarkdown: 'A', remoteUpdatedAt: 'v1',
      draftScope, recoveryStore, canWrite: true, onSave, delayMs, renderDelayMs: 0
    }));

    act(() => result.current.updateDraft('A1'));
    await advanceAutosave();
    act(() => result.current.updateDraft('A2'));
    await act(async () => { first.resolve({ rawMarkdown: 'A1', updatedAt: 'v2' }); });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(result.current.getLatestMarkdown()).toBe('A2');
    expect(result.current.draftMarkdown).toBe('A2');
    expect(result.current.hasLocalChanges).toBe(true);
    expect(recoveryStore.read(draftScope, 'note-a')).toMatchObject({
      markdown: 'A2', baseMarkdown: 'A1', baseUpdatedAt: 'v2'
    });
    expect(createNoteDraftRecovery().read(draftScope, 'note-a')).toMatchObject({
      markdown: 'A2', baseMarkdown: 'A1', baseUpdatedAt: 'v2'
    });

    await advanceAutosave();
    expect(onSave).toHaveBeenNthCalledWith(2, 'note-a', 'A2', 'v2', 'A1', mapping);
    await act(async () => { second.resolve({ rawMarkdown: 'A2', updatedAt: 'v3' }); });
    expect(result.current.hasLocalChanges).toBe(false);
    expect(recoveryStore.read(draftScope, 'note-a')).toBeUndefined();
  });

  it('前一个请求返回正文冲突时拦住已排队的自动保存并保留最新草稿', async () => {
    const first = deferred<NoteAutosaveSaveResult>();
    const recoveryStore = createNoteDraftRecovery();
    const onSave = vi.fn().mockReturnValueOnce(first.promise);
    const { result } = renderHook(() => useNoteAutosave({
      noteId: 'note-a', remoteMarkdown: 'A', remoteUpdatedAt: 'v1',
      draftScope, recoveryStore, canWrite: true, onSave, delayMs, renderDelayMs: 0
    }));

    act(() => result.current.updateDraft('A1'));
    await advanceAutosave();
    act(() => result.current.updateDraft('A2'));
    await advanceAutosave();
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => {
      first.reject(new ApiRequestError('远端正文已更新', {
        status: 409, code: 'NOTE_UPDATE_CONFLICT'
      }));
    });
    await advanceAutosave();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(result.current.hasConflict).toBe(true);
    expect(result.current.saveError).toBe('远端正文已更新');
    expect(result.current.hasLocalChanges).toBe(true);
    expect(result.current.getLatestMarkdown()).toBe('A2');
    expect(result.current.draftMarkdown).toBe('A2');
    expect(recoveryStore.read(draftScope, 'note-a')).toMatchObject({
      markdown: 'A2', baseMarkdown: 'A', baseUpdatedAt: 'v1', conflict: '远端正文已更新'
    });
  });

  it('切换笔记后各自串行保存，另一篇不等待前一篇的未完成请求', async () => {
    const a1 = deferred<NoteAutosaveSaveResult>();
    const a2 = deferred<NoteAutosaveSaveResult>();
    const b1 = deferred<NoteAutosaveSaveResult>();
    const b2 = deferred<NoteAutosaveSaveResult>();
    const recoveryStore = createNoteDraftRecovery();
    const requests = new Map([['A1', a1], ['A2', a2], ['B1', b1], ['B2', b2]]);
    const onSave = vi.fn((_noteId: string, markdown: string) => {
      const request = requests.get(markdown);
      if (!request) throw new Error(`未预期的正文：${markdown}`);
      return request.promise;
    });
    const { result, rerender } = renderHook(({ noteId, markdown, updatedAt }) => useNoteAutosave({
      noteId, remoteMarkdown: markdown, remoteUpdatedAt: updatedAt,
      draftScope, recoveryStore, canWrite: true, onSave, delayMs, renderDelayMs: 0
    }), { initialProps: { noteId: 'note-a', markdown: 'A', updatedAt: 'a-v1' } });

    act(() => result.current.updateDraft('A1'));
    await advanceAutosave();
    act(() => result.current.updateDraft('A2'));
    // 切换时的卸载刷新将 A2 排到 A1 后面，无需等待 A1 完成。
    rerender({ noteId: 'note-b', markdown: 'B', updatedAt: 'b-v1' });
    act(() => result.current.updateDraft('B1'));
    await advanceAutosave();
    act(() => result.current.updateDraft('B2'));
    await advanceAutosave();
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenNthCalledWith(1, 'note-a', 'A1', 'a-v1', 'A', mapping);
    expect(onSave).toHaveBeenNthCalledWith(2, 'note-b', 'B1', 'b-v1', 'B', mapping);

    await act(async () => { b1.resolve({ rawMarkdown: 'B1', updatedAt: 'b-v2' }); });
    expect(onSave).toHaveBeenCalledTimes(3);
    expect(onSave).toHaveBeenNthCalledWith(3, 'note-b', 'B2', 'b-v2', 'B1', mapping);
    await act(async () => { b2.resolve({ rawMarkdown: 'B2', updatedAt: 'b-v3' }); });
    expect(recoveryStore.read(draftScope, 'note-b')).toBeUndefined();
    expect(recoveryStore.read(draftScope, 'note-a')).toMatchObject({ markdown: 'A2', baseUpdatedAt: 'a-v1' });

    await act(async () => { a1.resolve({ rawMarkdown: 'A1', updatedAt: 'a-v2' }); });
    expect(onSave).toHaveBeenCalledTimes(4);
    expect(onSave).toHaveBeenNthCalledWith(4, 'note-a', 'A2', 'a-v2', 'A1', mapping);
    await act(async () => { a2.resolve({ rawMarkdown: 'A2', updatedAt: 'a-v3' }); });
    expect(recoveryStore.read(draftScope, 'note-a')).toBeUndefined();
    expect(result.current.hasLocalChanges).toBe(false);
  });
});

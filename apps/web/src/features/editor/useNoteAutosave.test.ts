import { act, renderHook } from '@testing-library/react';
import { ApiRequestError } from '@study-accelerator/web-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNoteAutosave } from './useNoteAutosave';

afterEach(() => {
  vi.useRealTimers();
});

describe('useNoteAutosave', () => {
  it('debounces edits with the note id and remote concurrency baseline that produced the draft', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue({ rawMarkdown: 'A-1', updatedAt: 'v2' });
    const { result } = renderHook(() => useNoteAutosave({
      noteId: 'note-a', remoteMarkdown: 'A', remoteUpdatedAt: 'v1', canWrite: true, onSave
    }));

    act(() => result.current.updateDraft('A-1'));
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(700));

    expect(onSave).toHaveBeenCalledWith('note-a', 'A-1', 'v1', 'A', expect.objectContaining({ formatVersion: 1, edits: expect.any(Array) }));
    expect(result.current.hasLocalChanges).toBe(false);
  });

  it('附带与待保存正文一致的身份快照；正文不一致或生成失败时照常保存', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useNoteAutosave({
      noteId: 'note-identity', remoteMarkdown: 'A', remoteUpdatedAt: 'v1', canWrite: true, onSave
    }));
    const editorState = { formatVersion: 2 as const, targetContentHash: 'h', blocks: [], annotations: [] };
    act(() => result.current.updateDraft('A-1', { identity: { markdown: 'A-1', build: () => editorState } }));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(onSave).toHaveBeenLastCalledWith('note-identity', 'A-1', 'v1', 'A', expect.objectContaining({ editorState }));
    act(() => result.current.updateDraft('A-2', { identity: { markdown: 'A-stale', build: () => editorState } }));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(onSave.mock.lastCall?.[4]).not.toHaveProperty('editorState');
    act(() => result.current.updateDraft('A-3', { identity: { markdown: 'A-3', build: () => { throw new Error('诊断失败'); } } }));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(onSave).toHaveBeenLastCalledWith('note-identity', 'A-3', 'v1', expect.any(String), expect.not.objectContaining({ editorState: expect.anything() }));
    const oversized = { ...editorState, blocks: Array.from({ length: 30000 }, (_, index) => ({ id: `block-${index}-${'x'.repeat(20)}`, type: 'paragraph', empty: false })) };
    act(() => result.current.updateDraft('A-4', { identity: { markdown: 'A-4', build: () => oversized } }));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(onSave).toHaveBeenLastCalledWith('note-identity', 'A-4', 'v1', expect.any(String), expect.objectContaining({ formatVersion: 1 }));
    expect(onSave.mock.lastCall?.[4]).not.toHaveProperty('editorState');
  });

  it('coalesces long-document UI publication while keeping the latest draft synchronously readable', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useNoteAutosave({
      noteId: 'note-a',
      remoteMarkdown: '初始正文',
      remoteUpdatedAt: 'v1',
      canWrite: true,
      renderDelayMs: 80,
      onSave
    }));

    act(() => {
      result.current.updateDraft('第一版');
      result.current.updateDraft('第二版');
      result.current.updateDraft('最终版');
    });
    expect(result.current.getLatestMarkdown()).toBe('最终版');
    expect(result.current.draftMarkdown).toBe('初始正文');

    await act(async () => vi.advanceTimersByTimeAsync(79));
    expect(result.current.draftMarkdown).toBe('初始正文');
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(result.current.draftMarkdown).toBe('最终版');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('publishes source-editor drafts immediately for controlled textarea input', () => {
    const { result } = renderHook(() => useNoteAutosave({
      noteId: 'note-a', remoteMarkdown: '初始正文', canWrite: true, onSave: vi.fn()
    }));
    act(() => result.current.updateDraft('源码正文', { immediate: true }));
    expect(result.current.draftMarkdown).toBe('源码正文');
  });

  it('serializes saves and advances expectedUpdatedAt after each successful response', async () => {
    vi.useFakeTimers();
    const first = createDeferred<{ rawMarkdown: string; updatedAt: string }>();
    const onSave = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ rawMarkdown: 'A-2', updatedAt: 'v3' });
    const { result } = renderHook(() => useNoteAutosave({
      noteId: 'note-a', remoteMarkdown: 'A', remoteUpdatedAt: 'v1', canWrite: true, onSave
    }));

    act(() => result.current.updateDraft('A-1'));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    act(() => result.current.updateDraft('A-2'));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve({ rawMarkdown: 'A-1', updatedAt: 'v2' }));
    await act(async () => Promise.resolve());

    expect(onSave).toHaveBeenNthCalledWith(1, 'note-a', 'A-1', 'v1', 'A', expect.objectContaining({ formatVersion: 1, edits: expect.any(Array) }));
    expect(onSave).toHaveBeenNthCalledWith(2, 'note-a', 'A-2', 'v2', 'A-1', expect.objectContaining({ formatVersion: 1, edits: expect.any(Array) }));
  });

  it('flushes the previous note explicitly without writing its draft into the next note', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue({ updatedAt: 'saved' });
    const { result, rerender } = renderHook(
      ({ noteId, markdown, updatedAt }) => useNoteAutosave({
        noteId, remoteMarkdown: markdown, remoteUpdatedAt: updatedAt, canWrite: true, onSave
      }),
      { initialProps: { noteId: 'note-a', markdown: '正文 A', updatedAt: 'a-v1' } }
    );

    act(() => result.current.updateDraft('正文 A（未到延迟）'));
    rerender({ noteId: 'note-b', markdown: '正文 B', updatedAt: 'b-v1' });
    expect(result.current.draftMarkdown).toBe('正文 B');
    await act(async () => Promise.resolve());

    expect(onSave).toHaveBeenCalledWith('note-a', '正文 A（未到延迟）', 'a-v1', '正文 A', expect.objectContaining({ formatVersion: 1, edits: expect.any(Array) }));
    expect(onSave).not.toHaveBeenCalledWith('note-b', '正文 A（未到延迟）', expect.anything());
  });

  it('accepts a late remote detail only while there is no local draft', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ markdown, updatedAt }) => useNoteAutosave({
        noteId: 'note-a', remoteMarkdown: markdown, remoteUpdatedAt: updatedAt, canWrite: true, onSave
      }),
      { initialProps: { markdown: '', updatedAt: 'v1' } }
    );

    rerender({ markdown: '后端详情正文', updatedAt: 'v2' });
    expect(result.current.draftMarkdown).toBe('后端详情正文');

    act(() => result.current.updateDraft('我的本地草稿'));
    rerender({ markdown: '另一端的新正文', updatedAt: 'v3' });
    expect(result.current.draftMarkdown).toBe('我的本地草稿');
  });

  it('pauses autosave on a 409 conflict and keeps the local draft available for export', async () => {
    vi.useFakeTimers();
    const conflict = new ApiRequestError('Note has changed since it was loaded', {
      status: 409,
      code: 'NOTE_UPDATE_CONFLICT'
    });
    const onSave = vi.fn().mockRejectedValue(conflict);
    const { result } = renderHook(() => useNoteAutosave({
      noteId: 'note-a', remoteMarkdown: '远端正文', remoteUpdatedAt: 'v1', canWrite: true, onSave
    }));

    act(() => result.current.updateDraft('不会丢失的本地正文'));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(result.current.hasConflict).toBe(true);
    expect(result.current.getLatestMarkdown()).toBe('不会丢失的本地正文');

    act(() => result.current.updateDraft('冲突后的继续输入'));
    await act(async () => vi.advanceTimersByTimeAsync(1400));
    expect(onSave).toHaveBeenCalledTimes(1);
    await expect(result.current.saveNow()).rejects.toThrow('Note has changed since it was loaded');
  });

  it('does not call the API when an explicit save contains the unchanged remote markdown', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useNoteAutosave({
      noteId: 'note-a', remoteMarkdown: '没有变化', remoteUpdatedAt: 'v1', canWrite: true, onSave
    }));

    await act(async () => result.current.saveNow('没有变化'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps a non-conflict failure pending so an explicit save can retry it', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ rawMarkdown: '不会丢失', updatedAt: 'v2' });
    const { result } = renderHook(() => useNoteAutosave({
      noteId: 'note-a', remoteMarkdown: 'A', remoteUpdatedAt: 'v1', canWrite: true, onSave
    }));

    act(() => result.current.updateDraft('不会丢失'));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    await act(async () => result.current.saveNow());

    expect(onSave).toHaveBeenNthCalledWith(1, 'note-a', '不会丢失', 'v1', 'A', expect.objectContaining({ formatVersion: 1, edits: expect.any(Array) }));
    expect(onSave).toHaveBeenNthCalledWith(2, 'note-a', '不会丢失', 'v1', 'A', expect.objectContaining({ formatVersion: 1, edits: expect.any(Array) }));
  });
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

it('主动重试重新核验冲突并解除锁定，其他 409 不锁死自动保存', async () => {
  vi.useFakeTimers();
  const onSave = vi.fn().mockRejectedValueOnce(Object.assign(new Error('冲突'), { code: 'NOTE_UPDATE_CONFLICT', status: 409 })).mockResolvedValue({ rawMarkdown: '草稿', updatedAt: 'v2' });
  const hook = renderHook(() => useNoteAutosave({ noteId: 'retry-conflict', remoteMarkdown: 'base', remoteUpdatedAt: 'v1', canWrite: true, onSave }));
  act(() => hook.result.current.updateDraft('草稿'));
  await act(async () => vi.advanceTimersByTimeAsync(700));
  expect(hook.result.current.hasConflict).toBe(true);
  await act(async () => hook.result.current.saveNow());
  expect(hook.result.current.hasConflict).toBe(false);
  expect(hook.result.current.hasLocalChanges).toBe(false);
  onSave.mockRejectedValueOnce(Object.assign(new Error('其他冲突'), { code: 'OTHER_CONFLICT', status: 409 }));
  act(() => hook.result.current.updateDraft('新的草稿'));
  await act(async () => vi.advanceTimersByTimeAsync(700));
  expect(hook.result.current.hasConflict).toBe(false);
  hook.unmount();
});

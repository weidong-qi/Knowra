import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createNoteDraftRecovery } from './noteDraftRecovery';
import { useNoteAutosave, type NoteAutosaveSaveResult } from './useNoteAutosave';

afterEach(() => { cleanup(); vi.useRealTimers(); sessionStorage.clear(); });

function setup() {
  vi.useFakeTimers();
  const recoveryStore = createNoteDraftRecovery();
  let resolve!: (value: NoteAutosaveSaveResult) => void;
  const onSave = vi.fn().mockImplementationOnce(() => new Promise<NoteAutosaveSaveResult>(done => { resolve = done; }))
    .mockImplementation(async (_id: string, markdown: string) => ({ rawMarkdown: markdown, updatedAt: 'v3' }));
  const hook = renderHook(() => useNoteAutosave({ noteId: 'n', draftScope: 's',
    remoteMarkdown: 'A', remoteUpdatedAt: 'v1', recoveryStore, canWrite: true, onSave }));
  return { ...hook, recoveryStore, onSave, resolve: (value: NoteAutosaveSaveResult) => resolve(value) };
}

it('放弃恢复草稿取消未发送的旧队列，但允许已发送请求确认', async () => {
  const { result, recoveryStore, onSave, resolve } = setup();
  act(() => result.current.updateDraft('B', { immediate: true }));
  await act(async () => vi.advanceTimersByTimeAsync(700));
  let queued!: Promise<void>;
  act(() => {
    result.current.updateDraft('C', { immediate: true });
    queued = result.current.saveNow();
  });
  act(() => result.current.discardRecoveredDraft());
  await act(async () => { resolve({ rawMarkdown: 'B', updatedAt: 'v2' }); await queued; });
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(recoveryStore.read('s', 'n')).toBeUndefined();
  expect(result.current.hasLocalChanges).toBe(false);
  await act(async () => vi.advanceTimersByTimeAsync(1400));
  expect(onSave).toHaveBeenCalledTimes(1);
});

it('放弃后的新编辑保留自己的日志，旧回执只推进保存基线', async () => {
  const { result, recoveryStore, onSave, resolve } = setup();
  act(() => result.current.updateDraft('B', { immediate: true }));
  await act(async () => vi.advanceTimersByTimeAsync(700));
  let queued!: Promise<void>;
  act(() => { result.current.updateDraft('C'); queued = result.current.saveNow(); });
  act(() => {
    result.current.discardRecoveredDraft();
    result.current.updateDraft('D', { immediate: true });
  });
  const edits = recoveryStore.read('s', 'n')?.annotationEdits;
  expect(edits).toHaveLength(1);
  await act(async () => { resolve({ rawMarkdown: 'B', updatedAt: 'v2' }); await queued; });
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(result.current.getLatestMarkdown()).toBe('D');
  expect(result.current.hasLocalChanges).toBe(true);
  expect(recoveryStore.read('s', 'n')).toMatchObject({ markdown: 'D', baseMarkdown: 'B', baseUpdatedAt: 'v2', annotationEdits: edits });
  await act(async () => result.current.saveNow());
  expect(onSave).toHaveBeenLastCalledWith('n', 'D', 'v2', 'B');
  expect(recoveryStore.read('s', 'n')).toBeUndefined();
  expect(result.current.hasLocalChanges).toBe(false);
});

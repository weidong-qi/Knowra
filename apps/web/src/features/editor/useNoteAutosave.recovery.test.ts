import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendEdit } from './annotationEditJournal';
import { createNoteDraftRecovery } from './noteDraftRecovery';
import { useNoteAutosave, type NoteAutosaveSaveResult } from './useNoteAutosave';

const draftScope = 'autosave-annotation-recovery';

beforeEach(() => { vi.useFakeTimers(); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); sessionStorage.clear(); });

function setup({ canWrite = true, onSave = vi.fn().mockResolvedValue({ rawMarkdown: 'B', updatedAt: 'v3' }) } = {}) {
  const initialStore = createNoteDraftRecovery();
  const annotationEdits = appendEdit([], 'B', 'B', { deletedEmptyAnnotationIds: ['annotation-1'] });
  initialStore.write(draftScope, 'note-a', { markdown: 'B', baseMarkdown: 'B', baseUpdatedAt: 'v1', annotationEdits });
  // 使用新的 store，验证持久草稿经过校验后重开，而非复用旧编辑器内存。
  const recoveryStore = createNoteDraftRecovery();
  const hook = renderHook(() => useNoteAutosave({ noteId: 'note-a', remoteMarkdown: 'B', remoteUpdatedAt: 'v2',
    draftScope, recoveryStore, canWrite, onSave, renderDelayMs: 0 }));
  return { ...hook, recoveryStore, annotationEdits, onSave };
}

describe('同正文的批注草稿恢复', () => {
  it('重开后保留尚未确认的批注意图，收到保存回执才清理恢复记录', async () => {
    let resolve!: (value: NoteAutosaveSaveResult) => void;
    const onSave = vi.fn(() => new Promise<NoteAutosaveSaveResult>(done => { resolve = done; }));
    const { result, recoveryStore, annotationEdits } = setup({ onSave });
    expect(result.current.hasLocalChanges).toBe(true);
    expect(recoveryStore.read(draftScope, 'note-a')).toMatchObject({ annotationEdits, baseUpdatedAt: 'v2' });

    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(onSave).toHaveBeenCalledExactlyOnceWith('note-a', 'B', 'v2', 'B', expect.objectContaining({
      edits: [expect.objectContaining({ deletedEmptyAnnotationIds: ['annotation-1'] })]
    }));
    expect(recoveryStore.read(draftScope, 'note-a')).toBeDefined();
    await act(async () => { resolve({ rawMarkdown: 'B', updatedAt: 'v3' }); });
    expect(result.current.hasLocalChanges).toBe(false);
    expect(recoveryStore.read(draftScope, 'note-a')).toBeUndefined();
  });

  it('只读重开时不发送请求或清理批注草稿', async () => {
    const { result, recoveryStore, annotationEdits, onSave } = setup({ canWrite: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.hasLocalChanges).toBe(true);
    expect(recoveryStore.read(draftScope, 'note-a')).toMatchObject({ annotationEdits });
  });

  it('恢复后的保存失败仍保留完整映射，可显式重试', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('合成保存失败'))
      .mockResolvedValueOnce({ rawMarkdown: 'B', updatedAt: 'v3' });
    const { result, recoveryStore, annotationEdits } = setup({ onSave });
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(result.current.saveError).toBe('合成保存失败');
    expect(recoveryStore.read(draftScope, 'note-a')).toMatchObject({ annotationEdits });
    await act(async () => { await result.current.saveNow(); });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.lastCall?.[4]).toMatchObject({ edits: [expect.objectContaining({ deletedEmptyAnnotationIds: ['annotation-1'] })] });
    expect(recoveryStore.read(draftScope, 'note-a')).toBeUndefined();
  });

  it.each([false, true])('已保存的正文不重放旧基线映射（含旧文本编辑：%s）', async withEdits => {
    const recoveryStore = createNoteDraftRecovery();
    recoveryStore.write(draftScope, 'note-a', { markdown: 'B', baseMarkdown: 'A', baseUpdatedAt: 'v1',
      ...(withEdits ? { annotationEdits: appendEdit([], 'A', 'B') } : {}) });
    const onSave = vi.fn();
    const { result } = renderHook(() => useNoteAutosave({ noteId: 'note-a', remoteMarkdown: 'B', remoteUpdatedAt: 'v2',
      draftScope, recoveryStore, canWrite: true, onSave }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.hasLocalChanges).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
    expect(recoveryStore.read(draftScope, 'note-a')).toBeUndefined();
  });
});

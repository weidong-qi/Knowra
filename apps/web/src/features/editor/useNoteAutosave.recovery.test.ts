import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNoteDraftRecovery } from './noteDraftRecovery';
import { useNoteAutosave } from './useNoteAutosave';

const draftScope = 'autosave-legacy-draft-recovery';

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

/** 旧版草稿可能带重点编辑日志（annotationEdits）；读取时丢弃日志，只按正文恢复。 */
function writeLegacyDraft(markdown: string, baseMarkdown: string) {
  sessionStorage.setItem(
    `knowra:note-draft:v1:${JSON.stringify([draftScope, 'note-a'])}`,
    JSON.stringify({
      markdown,
      baseMarkdown,
      baseUpdatedAt: 'v1',
      annotationEdits: [
        { sequence: 1, before: baseMarkdown, after: markdown, edit: { deletedEmptyAnnotationIds: ['annotation-1'] } }
      ]
    })
  );
}

describe('旧版重点编辑日志草稿', () => {
  it('正文与远端相同的旧草稿不再保存，直接清理', async () => {
    writeLegacyDraft('B', 'B');
    const recoveryStore = createNoteDraftRecovery();
    const onSave = vi.fn();
    const { result } = renderHook(() =>
      useNoteAutosave({
        noteId: 'note-a',
        remoteMarkdown: 'B',
        remoteUpdatedAt: 'v2',
        draftScope,
        recoveryStore,
        canWrite: true,
        onSave
      })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.hasLocalChanges).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
    expect(recoveryStore.read(draftScope, 'note-a')).toBeUndefined();
  });

  it('正文有改动的旧草稿照常恢复并保存，不附带编辑映射', async () => {
    writeLegacyDraft('B', 'A');
    const recoveryStore = createNoteDraftRecovery();
    const onSave = vi.fn().mockResolvedValue({ rawMarkdown: 'B', updatedAt: 'v3' });
    const { result } = renderHook(() =>
      useNoteAutosave({
        noteId: 'note-a',
        remoteMarkdown: 'A',
        remoteUpdatedAt: 'v2',
        draftScope,
        recoveryStore,
        canWrite: true,
        onSave,
        renderDelayMs: 0
      })
    );
    expect(recoveryStore.read(draftScope, 'note-a')).not.toHaveProperty('annotationEdits');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(onSave).toHaveBeenCalledExactlyOnceWith('note-a', 'B', 'v2', 'A');
    expect(result.current.hasLocalChanges).toBe(false);
    expect(recoveryStore.read(draftScope, 'note-a')).toBeUndefined();
  });
});

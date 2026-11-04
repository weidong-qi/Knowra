import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { getNoteDraftScope } from './noteDraftScope';
import { createNoteDraftRecovery } from './noteDraftRecovery';
import { useNoteAutosave } from './useNoteAutosave';
import { RecoveryDraftNotice } from './RecoveryDraftNotice';

const notes = [{ id: 'n', title: '原笔记', spaceId: 'space', deleted: false }];
vi.mock('../../store/AppStoreProvider', () => ({ useAppStore: (selector: (state: unknown) => unknown) => selector({ serverData: { notes } }) }));

afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); vi.useRealTimers(); delete window.knowraDesktop; });

it('preserves legacy scopes before restore and isolates each restored dataset', () => {
  expect(getNoteDraftScope('space')).toBe('space');
  vi.stubGlobal('knowraRuntime', { persistenceMode: 'desktop-local', datasetId: 'original', legacyDraftsAllowed: true });
  expect(getNoteDraftScope('space')).toBe('space');
  vi.stubGlobal('knowraRuntime', { persistenceMode: 'desktop-local', datasetId: 'restored-1', legacyDraftsAllowed: false });
  const first = getNoteDraftScope('space');
  expect(first).toBe(JSON.stringify(['restored-1', 'space']));
  vi.stubGlobal('knowraRuntime', { persistenceMode: 'desktop-local', datasetId: 'restored-2', legacyDraftsAllowed: false });
  expect(getNoteDraftScope('space')).not.toBe(first);
});

it('does not replay an old draft over restored content even when its baseline still matches', async () => {
  vi.useFakeTimers();
  const store = createNoteDraftRecovery();
  store.write('space', 'n', { markdown: '恢复前旧草稿', baseMarkdown: '备份正文', baseUpdatedAt: 'v1' });
  vi.stubGlobal('knowraRuntime', { persistenceMode: 'desktop-local', datasetId: 'restored-1', legacyDraftsAllowed: false });
  const scope = getNoteDraftScope('space')!;
  const onSave = vi.fn();
  const options = { noteId: 'n', draftScope: scope, remoteMarkdown: '备份正文', remoteUpdatedAt: 'v1', canWrite: true, recoveryStore: store, onSave };
  const restored = renderHook(() => useNoteAutosave(options));
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(restored.result.current.draftMarkdown).toBe('备份正文');
  expect(onSave).not.toHaveBeenCalled();
  expect(store.read('space', 'n')?.markdown).toBe('恢复前旧草稿');
  restored.unmount();
  store.write(scope, 'n', { markdown: '恢复后新草稿', baseMarkdown: '备份正文', baseUpdatedAt: 'v1' });
  const reopened = renderHook(() => useNoteAutosave({ ...options, canWrite: false }));
  expect(reopened.result.current.draftMarkdown).toBe('恢复后新草稿');
  reopened.unmount();
});

it('only offers export for drafts belonging to another dataset', () => {
  vi.stubGlobal('knowraRuntime', { persistenceMode: 'desktop-local', datasetId: 'restored-1', legacyDraftsAllowed: false });
  const key = `knowra:note-draft:v1:${JSON.stringify(['space', 'n'])}`;
  window.knowraDesktop = { onPrepareClose: () => {}, onCancelClose: () => {}, readRecoveryDrafts: () => ({ [key]: { markdown: '旧草稿', baseMarkdown: '备份正文' } }) };
  render(<RecoveryDraftNotice onOpenNote={vi.fn()} />);
  expect(screen.getByRole('button', { name: '恢复：原笔记' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '导出草稿' })).toBeEnabled();
  expect(screen.getByText('其他资料版本的草稿或原笔记已不存在，仅可导出。')).toBeInTheDocument();
});

import { useEffect } from 'react';
import { readRuntimeConfig } from '../../app/runtimeConfig';
import { registerDesktopSave, type DesktopCloseMode } from '../../app/desktopLifecycle';
import type { noteDraftRecovery } from './noteDraftRecovery';
import type { NoteAutosaveSession } from './noteAutosaveSession';

type NoteTimers = Map<string, ReturnType<typeof setTimeout>>;

/** 路由卸载和窗口退出共用保存会话；失败草稿继续参与桌面退出保护。 */
export function useNoteSaveLifecycle(
  noteId: string,
  session: NoteAutosaveSession,
  timers: NoteTimers,
  renderTimers: NoteTimers,
  recoveryStore: typeof noteDraftRecovery,
  flushNote: NoteAutosaveSession['flush']
) {
  const state = session.get(noteId);
  const { persist, retainDraft } = session;
  useEffect(() => () => {
    const renderTimer = renderTimers.get(noteId);
    if (renderTimer) clearTimeout(renderTimer);
    renderTimers.delete(noteId);
    const timer = timers.get(noteId);
    if (timer) clearTimeout(timer);
    timers.delete(noteId);
    const pending = state.pending;
    if (pending !== undefined && session.canWrite() && !state.conflict) {
      void persist(noteId, pending).catch(() => undefined);
    }
  }, [noteId, persist, state, session, timers, renderTimers]);
  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (![...session.notes.values()].some(item => item.pending !== undefined || item.inFlight)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [session]);
  useEffect(() => {
    if (!window.knowraDesktop && readRuntimeConfig().persistenceMode !== 'desktop-local') return;
    const flushAll = async (mode: DesktopCloseMode = 'save') => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      await Promise.allSettled([...session.notes.values()].map(item => item.inFlight));
      // 旧编辑器卸载后，重新打开的编辑器可能已经保存或处理了恢复草稿。
      for (const [id, item] of session.notes) {
        const owned = item.recovery;
        if (owned && recoveryStore.read(owned.scope, id) !== owned.draft) {
          item.pending = undefined;
          item.conflict = undefined;
          item.error = undefined;
        }
      }
      if (mode === 'recovery') {
        for (const [id, item] of session.notes) {
          if (item.pending === undefined) continue;
          const owned = item.recovery;
          if (!owned) throw new Error('正文缺少恢复草稿，请返回笔记导出后退出。');
          retainDraft(id, item.markdown);
        }
        await recoveryStore.flush();
        return;
      }
      if (!session.canWrite() && [...session.notes.values()].some(item => item.pending !== undefined)) throw new Error('当前正文尚未保存，请先处理只读或加载状态。');
      for (const [id, item] of session.notes) if (item.pending !== undefined) await flushNote(id, undefined, true);
      if ([...session.notes.values()].some(item => item.conflict)) throw new Error('正文有未解决的保存冲突，请处理后退出。');
      await recoveryStore.flush();
    };
    const remove = registerDesktopSave(flushAll);
    return () => {
      // 切换路由后仍保留失败草稿的退出保护，成功落盘才注销。
      void flushAll().then(remove).catch(() => undefined);
    };
  }, [flushNote, recoveryStore, retainDraft, session, timers]);
}

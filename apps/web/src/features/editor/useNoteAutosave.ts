import { appendEdit, buildEditMapping } from './annotationEditJournal';
import { createNoteAutosaveSession, noteHasLocalWork } from './noteAutosaveSession';
import { useNoteSaveLifecycle } from './useNoteSaveLifecycle';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { noteDraftRecovery } from './noteDraftRecovery';

const DEFAULT_AUTOSAVE_DELAY_MS = 700;
const DEFAULT_DRAFT_RENDER_DELAY_MS = 80;

interface DraftState {
  noteId: string;
  markdown: string;
}
export interface NoteAutosaveSaveResult {
  rawMarkdown?: string;
  updatedAt?: string;
}
export interface UseNoteAutosaveOptions {
  noteId: string;
  draftScope?: string;
  recoveryStore?: typeof noteDraftRecovery;
  remoteMarkdown: string;
  remoteUpdatedAt?: string;
  canWrite: boolean;
  delayMs?: number;
  renderDelayMs?: number;
  onSave(
    noteId: string,
    markdown: string,
    expectedUpdatedAt?: string,
    baseMarkdown?: string,
    annotationMapping?: import('@study-accelerator/web-core').AnnotationMapping
  ): Promise<NoteAutosaveSaveResult | void>;
}

export interface NoteAutosaveController {
  draftMarkdown: string;
  hasLocalChanges: boolean;
  hasConflict: boolean;
  saveError: string | null;
  updateDraft(markdown: string, options?: { immediate?: boolean; editIntent?: import('./annotationEditJournal').AnnotationEditIntent; identity?: import('./annotationShadow').AnnotationIdentitySnapshot }): void;
  saveNow(markdown?: string): Promise<void>;
  getLatestMarkdown(): string;
  discardRecoveredDraft(): void;
}
/**
 * 每篇笔记分别保存远端基线、本地修订号和待写入草稿。
 * 所有写入都携带首次产生草稿时的 updatedAt；若后端报告冲突，自动保存暂停，
 * 本地草稿通过恢复存储跨路由保留，绝不以 replaceAll 或无条件 PATCH 覆盖远端版本。
 */
export function useNoteAutosave({
  noteId,
  draftScope,
  recoveryStore = noteDraftRecovery,
  remoteMarkdown,
  remoteUpdatedAt,
  canWrite,
  delayMs = DEFAULT_AUTOSAVE_DELAY_MS,
  renderDelayMs = DEFAULT_DRAFT_RENDER_DELAY_MS,
  onSave
}: UseNoteAutosaveOptions): NoteAutosaveController {
  const [draft, setDraft] = useState<DraftState>({ noteId, markdown: remoteMarkdown });
  const [, publishStateChange] = useReducer((version: number) => version + 1, 0);
  const currentNoteIdRef = useRef(noteId);
  const timerByNoteRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const renderTimerByNoteRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const optionsRef = useRef({ onSave, canWrite, recoveryStore });
  optionsRef.current = { onSave, canWrite, recoveryStore };
  currentNoteIdRef.current = noteId;
  const sessionRef = useRef<ReturnType<typeof createNoteAutosaveSession> | null>(null);
  if (!sessionRef.current) sessionRef.current = createNoteAutosaveSession({
    canWrite: () => optionsRef.current.canWrite,
    save: (...args) => optionsRef.current.onSave(...args),
    recoveryStore: () => optionsRef.current.recoveryStore,
    publish: (id) => { if (currentNoteIdRef.current === id) publishStateChange(); }
  });
  const session = sessionRef.current;
  const state = session.get(noteId, remoteMarkdown, remoteUpdatedAt);
  const { retainDraft, clearRecovery } = session;
  const setCurrentDraft = useCallback((next: DraftState) => {
    const renderTimer = renderTimerByNoteRef.current.get(next.noteId);
    if (renderTimer) clearTimeout(renderTimer);
    renderTimerByNoteRef.current.delete(next.noteId);
    session.get(next.noteId).markdown = next.markdown;
    setDraft(next);
  }, [session]);
  const scheduleCurrentDraft = useCallback((next: DraftState, immediate = false) => {
    session.get(next.noteId).markdown = next.markdown;
    const previousTimer = renderTimerByNoteRef.current.get(next.noteId);
    if (previousTimer) clearTimeout(previousTimer);
    if (immediate || renderDelayMs <= 0) {
      renderTimerByNoteRef.current.delete(next.noteId);
      if (currentNoteIdRef.current === next.noteId) setDraft(next);
      return;
    }
    const timer = setTimeout(() => {
      renderTimerByNoteRef.current.delete(next.noteId);
      if (currentNoteIdRef.current !== next.noteId) return;
      setDraft({
        noteId: next.noteId,
        markdown: session.get(next.noteId).markdown
      });
    }, renderDelayMs);
    renderTimerByNoteRef.current.set(next.noteId, timer);
  }, [renderDelayMs, session]);
  const flushNote = useCallback(async (targetNoteId: string, fallback?: string, retryConflict = false) => {
    const timer = timerByNoteRef.current.get(targetNoteId);
    if (timer) clearTimeout(timer);
    timerByNoteRef.current.delete(targetNoteId);
    await session.flush(targetNoteId, fallback, retryConflict);
  }, [session]);
  const updateDraft = useCallback((markdown: string, options?: { immediate?: boolean; editIntent?: import('./annotationEditJournal').AnnotationEditIntent; identity?: import('./annotationShadow').AnnotationIdentitySnapshot }) => {
    const before = state.markdown;
    state.edits = appendEdit(state.edits, before, markdown, options?.editIntent);
    state.identity = options?.identity;
    scheduleCurrentDraft({ noteId, markdown }, options?.immediate);
    if (!optionsRef.current.canWrite) return;
    state.localRevision += 1;
    state.pending = markdown;
    retainDraft(noteId, markdown, draftScope);
    state.error = undefined;
    const previousTimer = timerByNoteRef.current.get(noteId);
    if (previousTimer) clearTimeout(previousTimer);
    if (!state.conflict) {
      const timer = setTimeout(() => {
        timerByNoteRef.current.delete(noteId);
        void flushNote(noteId).catch(() => undefined);
      }, delayMs);
      timerByNoteRef.current.set(noteId, timer);
    }
  }, [delayMs, draftScope, flushNote, noteId, retainDraft, scheduleCurrentDraft, state]);
  const saveNow = useCallback(async (markdown?: string) => {
    const latest = markdown ?? state.markdown;
    state.markdown = latest;
    if (latest !== state.serverMarkdown) {
      state.pending = latest;
      retainDraft(noteId, latest, draftScope);
    }
    await flushNote(noteId, latest, true);
  }, [draftScope, flushNote, noteId, retainDraft, state]);
  useEffect(() => {
    if (draftScope !== undefined && !state.restored) {
      state.restored = true;
      const recovered = recoveryStore.read(draftScope, noteId);
      if (recovered) {
        state.recovery = { scope: draftScope, draft: recovered };
        state.edits = recovered.annotationEdits ?? [];
        state.serverMarkdown = recovered.baseMarkdown;
        state.baseUpdatedAt = recovered.baseUpdatedAt;
        state.pending = recovered.markdown;
        state.localRevision = 1;
        state.syncedRevision = 0;
        // 同正文的批注意图仍需提交；只重放与当前远端基线完整匹配的日志。
        const pendingAnnotationMapping = recovered.baseMarkdown === remoteMarkdown
          && buildEditMapping(recovered.baseMarkdown, recovered.markdown, state.edits);
        if (recovered.markdown === remoteMarkdown && !pendingAnnotationMapping) {
          state.pending = undefined;
          clearRecovery(noteId);
          state.serverMarkdown = remoteMarkdown;
          state.baseUpdatedAt = remoteUpdatedAt;
          state.syncedRevision = 1;
        } else if (recovered.baseMarkdown === remoteMarkdown) {
          // 已重新读取正文且内容未变：时间戳变化不构成正文冲突。
          state.baseUpdatedAt = remoteUpdatedAt;
          retainDraft(noteId, recovered.markdown, draftScope);
        } else {
          const message = recovered.conflict ?? '远端正文已更新，已恢复本地草稿，请导出草稿后核对。';
          state.conflict = message;
          state.error = message;
        }
        setCurrentDraft({ noteId, markdown: recovered.markdown });
        if (state.pending !== undefined && !state.conflict && optionsRef.current.canWrite) {
          timerByNoteRef.current.set(noteId, setTimeout(() => {
            timerByNoteRef.current.delete(noteId);
            void flushNote(noteId).catch(() => undefined);
          }, delayMs));
        }
        return;
      }
    }
    const hasLocalWork = noteHasLocalWork(state);
    if (!hasLocalWork) {
      state.edits = [];
      state.serverMarkdown = remoteMarkdown;
      state.baseUpdatedAt = remoteUpdatedAt;
      if (draft.noteId !== noteId || draft.markdown !== remoteMarkdown) {
        setCurrentDraft({ noteId, markdown: remoteMarkdown });
      }
      return;
    }
    const localDraft = state.markdown;
    if (draft.noteId !== noteId || draft.markdown !== localDraft) {
      setCurrentDraft({ noteId, markdown: localDraft });
    }
  }, [clearRecovery, delayMs, flushNote, draft.markdown, draft.noteId, draftScope, noteId, recoveryStore, remoteMarkdown, remoteUpdatedAt, retainDraft, setCurrentDraft, state]);
  useNoteSaveLifecycle(noteId, session, timerByNoteRef.current, renderTimerByNoteRef.current, recoveryStore, flushNote);
  const hasLocalChanges = noteHasLocalWork(state);
  const localDraft = draft.noteId === noteId
    ? draft.markdown
    : state.markdown;
  return {
    draftMarkdown: hasLocalChanges ? localDraft : remoteMarkdown,
    hasLocalChanges,
    hasConflict: Boolean(state.conflict),
    saveError: state.error ?? null,
    updateDraft,
    saveNow,
    discardRecoveredDraft: () => {
      state.generation += 1;
      state.edits = [];
      const timer = timerByNoteRef.current.get(noteId);
      if (timer) clearTimeout(timer);
      timerByNoteRef.current.delete(noteId);
      state.pending = undefined;
      clearRecovery(noteId);
      state.conflict = undefined;
      state.error = undefined;
      state.syncedRevision = state.localRevision;
      state.serverMarkdown = remoteMarkdown;
      state.baseUpdatedAt = remoteUpdatedAt;
      setCurrentDraft({ noteId, markdown: remoteMarkdown });
    },
    getLatestMarkdown: () => state.markdown
  };
}

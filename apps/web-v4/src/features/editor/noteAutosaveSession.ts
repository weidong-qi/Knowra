import type { noteDraftRecovery, RecoveredNoteDraft } from './noteDraftRecovery';
import type { UseNoteAutosaveOptions } from './useNoteAutosave';

/** 同一篇笔记的正文、并发基线和恢复所有权必须一起推进。 */
export interface NoteSaveState {
  markdown: string;
  serverMarkdown: string;
  baseUpdatedAt?: string;
  pending?: string;
  inFlight?: Promise<void>;
  localRevision: number;
  syncedRevision: number;
  conflict?: string;
  error?: string;
  recovery?: { scope: string; draft: RecoveredNoteDraft };
  restored: boolean;
  generation: number;
}

export function noteHasLocalWork(state: NoteSaveState): boolean {
  return (
    state.pending !== undefined ||
    Boolean(state.inFlight) ||
    Boolean(state.conflict) ||
    state.localRevision !== state.syncedRevision
  );
}

interface SessionOptions {
  canWrite(): boolean;
  save: UseNoteAutosaveOptions['onSave'];
  recoveryStore(): typeof noteDraftRecovery;
  publish(noteId: string): void;
}

/** 不持有 React 状态、计时器或桌面监听器；只管理逐笔记的保存与恢复状态。 */
export function createNoteAutosaveSession(options: SessionOptions) {
  const notes = new Map<string, NoteSaveState>();
  function get(noteId: string, markdown = '', updatedAt?: string): NoteSaveState {
    let state = notes.get(noteId);
    if (!state) {
      state = {
        markdown,
        serverMarkdown: markdown,
        baseUpdatedAt: updatedAt,
        localRevision: 0,
        syncedRevision: 0,
        restored: false,
        generation: 0
      };
      notes.set(noteId, state);
    }
    return state;
  }
  function retainDraft(noteId: string, markdown: string, scope?: string) {
    const state = get(noteId);
    const owned = state.recovery;
    const targetScope = scope ?? owned?.scope;
    if (targetScope === undefined) return;
    const store = options.recoveryStore();
    // 已卸载编辑器不能覆盖后来编辑器取得所有权的恢复记录。
    if (owned && store.read(targetScope, noteId) !== owned.draft) return;
    const draft: RecoveredNoteDraft = {
      markdown,
      baseMarkdown: state.serverMarkdown,
      baseUpdatedAt: state.baseUpdatedAt,
      conflict: state.conflict
    };
    store.write(targetScope, noteId, draft);
    state.recovery = { scope: targetScope, draft };
  }
  function clearRecovery(noteId: string) {
    const state = get(noteId);
    const owned = state.recovery;
    // 保留旧所有权凭据，让尚未发送的队列仍能识别接管，不能误当作无恢复记录。
    if (owned && options.recoveryStore().read(owned.scope, noteId) !== owned.draft) return;
    if (owned) options.recoveryStore().remove(owned.scope, noteId, owned.draft);
    state.recovery = undefined;
  }
  async function persist(noteId: string, markdown: string, retryConflict = false) {
    if (!options.canWrite()) return;
    const state = get(noteId);
    const revision = state.localRevision;
    const generation = state.generation;
    const previous = state.inFlight ?? Promise.resolve();
    const request = previous
      .catch(() => undefined)
      .then(async () => {
        // 显式放弃只取消未发送的旧代请求，不把旧正文重新放回 pending。
        if (state.generation !== generation) return;
        try {
          // 入队不等于已发送：等待期间的只读切换必须在调用保存接口前生效。
          // 已发送的请求仍正常确认，并为保留的下一版草稿推进并发基线。
          if (!options.canWrite()) throw new Error('当前正文尚未保存，请先处理只读或加载状态。');
          const owned = state.recovery;
          if (owned && options.recoveryStore().read(owned.scope, noteId) !== owned.draft) {
            throw new Error('恢复草稿已由另一编辑器接管，请在当前笔记中继续保存。');
          }
          if (state.conflict && !retryConflict) throw new Error(state.conflict);
          const expectedUpdatedAt = state.baseUpdatedAt;
          const saved = await options.save(noteId, markdown, expectedUpdatedAt, state.serverMarkdown);
          state.serverMarkdown = saved?.rawMarkdown ?? markdown;
          state.baseUpdatedAt = saved?.updatedAt ?? expectedUpdatedAt;
          // 放弃期间已发送的请求仍确认服务端事实，但不能确认或清理新代编辑。
          if (state.generation !== generation) {
            if (state.pending !== undefined) retainDraft(noteId, state.markdown);
            return;
          }
          state.syncedRevision = revision;
          state.error = undefined;
          state.conflict = undefined;
          const isCurrentRevision = state.localRevision === revision && state.markdown === markdown;
          if (isCurrentRevision) clearRecovery(noteId);
          else retainDraft(noteId, state.markdown);
          if (isCurrentRevision && state.pending === markdown) state.pending = undefined;
        } catch (error) {
          if (state.generation !== generation) throw error;
          state.error = error instanceof Error ? error.message : '正文保存失败';
          if (isUpdateConflict(error)) state.conflict = state.error;
          retainDraft(noteId, state.markdown);
          state.pending ??= markdown;
          throw error;
        } finally {
          options.publish(noteId);
        }
      });
    state.inFlight = request;
    options.publish(noteId);
    try {
      await request;
    } finally {
      if (state.inFlight === request) {
        state.inFlight = undefined;
        options.publish(noteId);
      }
    }
  }
  async function flush(noteId: string, fallback?: string, retryConflict = false) {
    const state = get(noteId);
    const markdown = state.pending ?? fallback;
    if (markdown === undefined || !options.canWrite()) return;
    if (!state.conflict && !state.inFlight && markdown === state.serverMarkdown) {
      state.pending = undefined;
      clearRecovery(noteId);
      state.syncedRevision = state.localRevision;
      options.publish(noteId);
      return;
    }
    await persist(noteId, markdown, retryConflict);
  }
  return { notes, get, retainDraft, clearRecovery, persist, flush, canWrite: options.canWrite };
}

function isUpdateConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'NOTE_UPDATE_CONFLICT';
}

export type NoteAutosaveSession = ReturnType<typeof createNoteAutosaveSession>;

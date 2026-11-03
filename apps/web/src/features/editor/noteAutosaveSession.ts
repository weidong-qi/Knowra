import { buildEditMapping, type EditEntry } from './annotationEditJournal';
import type { noteDraftRecovery, RecoveredNoteDraft } from './noteDraftRecovery';
import type { UseNoteAutosaveOptions } from './useNoteAutosave';

/** 同一篇笔记的正文、并发基线和恢复所有权必须一起推进。 */
export interface NoteSaveState {
  markdown: string;
  serverMarkdown: string;
  baseUpdatedAt?: string;
  edits: EditEntry[];
  /** 最近一次正文变化时的身份快照（影子比对用），只在与待保存正文一致时随保存提交。 */
  identity?: import('./annotationShadow').AnnotationIdentitySnapshot;
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

/** 服务端 JSON 请求体上限，与 `packages/shared/src/http-limits.js` 的 DEFAULT_JSON_BODY_LIMIT_BYTES 一致（测试校验）。 */
export const SAVE_REQUEST_LIMIT_BYTES = 8 * 1024 * 1024;
/** 影子快照自身上限，以及为请求中其他字段与编码差异保留的余量。 */
export const IDENTITY_SNAPSHOT_MAX_BYTES = 1024 * 1024;
const SAVE_REQUEST_HEADROOM_BYTES = 16 * 1024;

/**
 * 影子比对只是诊断：生成失败、快照过大，或附带后最终序列化的请求 JSON（UTF-8 字节，含转义）
 * 会逼近服务端上限时，省略快照，保存照常进行。
 */
export function withIdentity(mapping: ReturnType<typeof buildEditMapping>, identity: NoteSaveState['identity'], markdown: string, expectedUpdatedAt?: string) {
  if (!mapping || identity?.markdown !== markdown) return mapping;
  try {
    const editorState = identity.build();
    const encoder = new TextEncoder();
    if (encoder.encode(JSON.stringify(editorState)).byteLength > IDENTITY_SNAPSHOT_MAX_BYTES) return mapping;
    const withState = { ...mapping, editorState };
    // 与 workspaceSlice.saveNoteContent 发送的请求体同形状。
    const body = JSON.stringify({ rawMarkdown: markdown, annotationMapping: withState, expectedUpdatedAt: expectedUpdatedAt ?? '' });
    return encoder.encode(body).byteLength + SAVE_REQUEST_HEADROOM_BYTES > SAVE_REQUEST_LIMIT_BYTES ? mapping : withState;
  } catch { return mapping; }
}

export function noteHasLocalWork(state: NoteSaveState): boolean {
  return state.pending !== undefined || Boolean(state.inFlight) || Boolean(state.conflict)
    || state.localRevision !== state.syncedRevision;
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
      state = { markdown, serverMarkdown: markdown, baseUpdatedAt: updatedAt,
        edits: [], localRevision: 0, syncedRevision: 0, restored: false, generation: 0 };
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
    const draft: RecoveredNoteDraft = { markdown, baseMarkdown: state.serverMarkdown,
      baseUpdatedAt: state.baseUpdatedAt, annotationEdits: state.edits, conflict: state.conflict };
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
    const capturedEdits = [...state.edits];
    const capturedIdentity = state.identity;
    const revision = state.localRevision;
    const generation = state.generation;
    const previous = state.inFlight ?? Promise.resolve();
    const request = previous.catch(() => undefined).then(async () => {
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
        const pendingEdits = new Set(state.edits.map(edit => edit.sequence));
        const batch = capturedEdits.filter(edit => pendingEdits.has(edit.sequence));
        const mapping = withIdentity(buildEditMapping(state.serverMarkdown, markdown, batch), capturedIdentity, markdown, expectedUpdatedAt);
        const saved = mapping
          ? await options.save(noteId, markdown, expectedUpdatedAt, state.serverMarkdown, mapping)
          : await options.save(noteId, markdown, expectedUpdatedAt, state.serverMarkdown);
        state.serverMarkdown = saved?.rawMarkdown ?? markdown;
        state.baseUpdatedAt = saved?.updatedAt ?? expectedUpdatedAt;
        // 放弃期间已发送的请求仍确认服务端事实，但不能确认或清理新代编辑。
        if (state.generation !== generation) {
          if (state.pending !== undefined) retainDraft(noteId, state.markdown);
          return;
        }
        const acknowledged = new Set(batch.map(edit => edit.sequence));
        state.edits = state.edits.filter(edit => !acknowledged.has(edit.sequence));
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
    try { await request; }
    finally {
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
    if (!state.edits.length && !state.conflict && !state.inFlight && markdown === state.serverMarkdown) {
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

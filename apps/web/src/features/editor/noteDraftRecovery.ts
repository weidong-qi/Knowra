import { registerAiDraft } from './aiDraftCoordination';
import { validRecoveredEdits } from './annotationEditJournal';
export interface RecoveredNoteDraft {
  markdown: string;
  baseMarkdown: string;
  baseUpdatedAt?: string;
  conflict?: string;
  annotationEdits?: import('./annotationEditJournal').EditEntry[];
}

/** 桌面使用独立原子文件；网页保留会话恢复。所有失败记录到 flush，不能误报已落盘。 */
export function createNoteDraftRecovery(onChange: (scope: string, noteId: string, dirty: boolean) => void = () => {}) {
  const drafts = new Map<string, RecoveredNoteDraft | undefined>();
  const pending = new Map<string, Promise<void>>();
  const errors = new Map<string, Error>();
  const dirty = new Map<string, RecoveredNoteDraft | null>();
  const keyFor = (scope: string, noteId: string) => `knowra:note-draft:v1:${JSON.stringify([scope, noteId])}`;
  function persist(key: string, draft: RecoveredNoteDraft | null) {
    dirty.set(key, draft);
    const native = window.knowraDesktop?.writeRecoveryDraft;
    if (native) {
      const previous = pending.get(key) ?? Promise.resolve();
      const task = previous.catch(() => undefined).then(async () => {
        if (dirty.get(key) !== draft) return;
        await native(key, draft);
        errors.delete(key);
        if (dirty.get(key) === draft) dirty.delete(key);
      }).catch(error => { errors.set(key, new Error(`本机恢复草稿写入失败：${error instanceof Error ? error.message : '未知错误'}`)); });
      pending.set(key, task);
    } else {
      try {
        if (draft === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(draft));
        dirty.delete(key); errors.delete(key);
      } catch { errors.set(key, new Error('浏览器草稿存储不可用，请先导出正文。')); }
    }
  }
  return {
    read(scope: string, noteId: string): RecoveredNoteDraft | undefined {
      const key = keyFor(scope, noteId);
      if (drafts.has(key)) return drafts.get(key);
      try {
        const native = window.knowraDesktop?.readRecoveryDrafts;
        const raw = native ? native()[key] : JSON.parse(sessionStorage.getItem(key) ?? 'null');
        if (!raw) return undefined;
        const value = raw as RecoveredNoteDraft;
        if (typeof value.markdown !== 'string' || typeof value.baseMarkdown !== 'string'
          || (value.baseUpdatedAt !== undefined && typeof value.baseUpdatedAt !== 'string')
          || (value.conflict !== undefined && typeof value.conflict !== 'string')) throw new Error('恢复草稿格式无效');
        if (value.annotationEdits && !validRecoveredEdits(value.annotationEdits)) value.annotationEdits = undefined;
        drafts.set(key, value);
        onChange(scope, noteId, value.markdown !== value.baseMarkdown || Boolean(value.conflict));
        return value;
      } catch { errors.set(key, new Error('恢复草稿读取失败，请保留草稿文件并重试。')); return undefined; }
    },
    write(scope: string, noteId: string, draft: RecoveredNoteDraft) {
      const key = keyFor(scope, noteId);
      drafts.set(key, draft);
      onChange(scope, noteId, draft.markdown !== draft.baseMarkdown || Boolean(draft.conflict));
      persist(key, draft);
    },
    remove(scope: string, noteId: string, expected: RecoveredNoteDraft) {
      const key = keyFor(scope, noteId);
      if (drafts.get(key) !== expected) return;
      drafts.set(key, undefined);
      onChange(scope, noteId, false);
      persist(key, null);
    },
    async flush() {
      await Promise.all([...pending.values()]);
      for (const [key, value] of dirty) persist(key, value);
      await Promise.all([...pending.values()]);
      if (errors.size) throw errors.values().next().value;
    }
  };
}

export const noteDraftRecovery = createNoteDraftRecovery(registerAiDraft);

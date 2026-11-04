import type { Annotation } from '@study-accelerator/web-core';
import { readRuntimeConfig } from '../../app/runtimeConfig';
import type { KnowledgeFormValue } from './KnowledgeItemForm';

export const KNOWLEDGE_DRAFT_PREFIX = 'knowra:knowledge-draft:v1:';
export interface KnowledgeDraftSource {
  annotationId: string;
  noteVersionId?: string;
  expectedAnnotationRevision?: number;
  quoteText: string;
  headingPath: string[];
}
export interface KnowledgeDraft {
  version: 1;
  kind: 'create' | 'edit';
  candidateId: string;
  initialValue: KnowledgeFormValue;
  value: KnowledgeFormValue;
  expectedUpdatedAt?: string;
  source?: KnowledgeDraftSource;
}

/** 知识没有历史草稿兼容包袱：始终按资料库版本隔离，包括首次安装。 */
export function getKnowledgeDraftScope(runtime = readRuntimeConfig()) {
  return JSON.stringify([runtime.persistenceMode, runtime.persistenceMode === 'desktop-local' ? runtime.datasetId ?? 'unknown-desktop-dataset' : window.location.origin]);
}
export function knowledgeDraftSource(annotation: Annotation): KnowledgeDraftSource {
  return { annotationId: annotation.id, ...(annotation.noteVersionId ? { noteVersionId: annotation.noteVersionId } : {}),
    ...(annotation.revision !== undefined ? { expectedAnnotationRevision: annotation.revision } : {}), quoteText: annotation.quoteText, headingPath: [...annotation.headingPath] };
}
export function isKnowledgeDraft(value: unknown): value is KnowledgeDraft {
  const draft = value as KnowledgeDraft | null;
  const form = (input: KnowledgeFormValue | undefined) => input && ['title', 'canonicalStatement', 'userExplanation'].every(key => typeof input[key as keyof KnowledgeFormValue] === 'string')
    && ['concept', 'fact', 'principle', 'process', 'algorithm', 'formula', 'comparison', 'application'].includes(input.knowledgeType);
  return Boolean(draft && draft.version === 1 && ['create', 'edit'].includes(draft.kind) && typeof draft.candidateId === 'string' && draft.candidateId
    && form(draft.initialValue) && form(draft.value) && (draft.kind !== 'edit' || (typeof draft.expectedUpdatedAt === 'string' && draft.expectedUpdatedAt))
    && (!draft.source || (draft.kind === 'create' && typeof draft.source.annotationId === 'string' && draft.source.annotationId
      && typeof draft.source.quoteText === 'string' && Array.isArray(draft.source.headingPath) && draft.source.headingPath.every(part => typeof part === 'string')
      && (draft.source.noteVersionId === undefined || typeof draft.source.noteVersionId === 'string')
      && (draft.source.expectedAnnotationRevision === undefined || (Number.isInteger(draft.source.expectedAnnotationRevision) && draft.source.expectedAnnotationRevision > 0)))));
}

/** 复用桌面原子草稿文件；逐键串行写入，flush 必须收到落盘确认。 */
export function createKnowledgeDraftRecovery() {
  const pending = new Map<string, Promise<void>>();
  const dirty = new Map<string, KnowledgeDraft | null>();
  const errors = new Map<string, Error>();
  const keyFor = (scope: string, id: string) => `${KNOWLEDGE_DRAFT_PREFIX}${JSON.stringify([scope, id])}`;
  function persist(key: string, draft: KnowledgeDraft | null) {
    dirty.set(key, draft);
    const native = window.knowraDesktop?.writeRecoveryDraft;
    const write = async () => {
      if (dirty.get(key) !== draft) return;
      if (native) await native(key, draft);
      else if (draft === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, JSON.stringify(draft));
      errors.delete(key);
      if (dirty.get(key) === draft) dirty.delete(key);
    };
    const task = (pending.get(key) ?? Promise.resolve()).then(write).catch(cause => {
      errors.set(key, new Error(`知识恢复草稿写入失败：${cause instanceof Error ? cause.message : '存储不可用'}`));
    });
    pending.set(key, task);
  }
  return {
    list(scope: string): KnowledgeDraft[] {
      const native = window.knowraDesktop?.readRecoveryDrafts;
      const records: Record<string, unknown> = native ? { ...native() } : {};
      if (!native) for (let index = 0; index < sessionStorage.length; index++) {
        const key = sessionStorage.key(index);
        if (key?.startsWith(KNOWLEDGE_DRAFT_PREFIX)) records[key] = JSON.parse(sessionStorage.getItem(key) ?? 'null');
      }
      for (const [key, draft] of dirty) { if (draft === null) delete records[key]; else records[key] = draft; }
      const result: KnowledgeDraft[] = [];
      for (const [key, draft] of Object.entries(records)) {
        if (!key.startsWith(KNOWLEDGE_DRAFT_PREFIX)) continue;
        const parts: unknown = JSON.parse(key.slice(KNOWLEDGE_DRAFT_PREFIX.length));
        if (!Array.isArray(parts) || parts.length !== 2 || !isKnowledgeDraft(draft) || draft.candidateId !== parts[1]) throw new Error('知识恢复草稿格式无效，请保留恢复文件。');
        if (parts[0] === scope) result.push(draft);
      }
      return result;
    },
    write(scope: string, draft: KnowledgeDraft) { persist(keyFor(scope, draft.candidateId), draft); },
    remove(scope: string, draft: KnowledgeDraft) {
      const key = keyFor(scope, draft.candidateId);
      if (dirty.has(key) && dirty.get(key) !== draft) return;
      persist(key, null);
    },
    async flush() {
      await Promise.all([...pending.values()]);
      for (const [key, draft] of dirty) persist(key, draft);
      await Promise.all([...pending.values()]);
      if (errors.size) throw errors.values().next().value;
    }
  };
}
export const knowledgeDraftRecovery = createKnowledgeDraftRecovery();

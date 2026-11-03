import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { annotationUrl, pdfRequest, pdfHeaders, randomId } from './pdfApi';

export type PdfDraft = { id: string; fields: Partial<PdfAnnotation>; remove?: boolean; task?: Record<string, unknown> };
export class PdfSession {
  items = new Map<string, PdfAnnotation>();
  drafts = new Map<string, PdfDraft>();
  error = '';
  errorCode = '';
  busy = false;
  private running: Promise<void> | null = null;
  private readonly headers = pdfHeaders();
  private persistence: Promise<void> = Promise.resolve();
  private recoveryError: Error | null = null;
  constructor(
    readonly noteId: string,
    readonly sha256: string,
    readonly key: string,
    private changed: () => void,
    private canWrite = () => true
  ) {}
  async persist() {
    if (this.recoveryError) throw this.recoveryError;
    const value = this.drafts.size ? { version: 1, sha256: this.sha256, drafts: [...this.drafts.values()] } : null;
    const save = async () => {
      if (window.knowraDesktop?.writeRecoveryDraft) await window.knowraDesktop.writeRecoveryDraft(this.key, value);
      else if (value) localStorage.setItem(this.key, JSON.stringify(value));
      else localStorage.removeItem(this.key);
    };
    this.persistence = this.persistence.catch(() => undefined).then(save);
    await this.persistence;
  }
  recover() {
    try {
      const raw = window.knowraDesktop?.readRecoveryDrafts
        ? window.knowraDesktop.readRecoveryDrafts()[this.key]
        : JSON.parse(localStorage.getItem(this.key) ?? 'null');
      const value = raw as { version?: number; sha256?: string; drafts?: PdfDraft[] } | undefined;
      if (!value) return;
      if (value.version !== 1 || value.sha256 !== this.sha256 || !Array.isArray(value.drafts))
        throw new Error('PDF 恢复草稿与原文件不匹配');
      const valid = value.drafts.every(
        draft =>
          typeof draft.id === 'string' &&
          draft.fields &&
          ['highlight', 'region'].includes(draft.fields.type ?? '') &&
          Array.isArray(draft.fields.segments) &&
          draft.fields.segments.length > 0 &&
          draft.fields.segments.every(
            segment =>
              Number.isInteger(segment.pageIndex) &&
              Array.isArray(segment.rect) &&
              segment.rect.length === 4 &&
              segment.rect.every(Number.isFinite)
          ) &&
          typeof draft.fields.quoteText === 'string'
      );
      if (!valid) throw new Error('PDF 恢复草稿无效，原始草稿已保留，请从备份导出检查。');
      for (const draft of value.drafts) this.drafts.set(draft.id, draft);
    } catch (error) {
      this.recoveryError = error instanceof Error ? error : new Error('PDF 恢复草稿读取失败');
      throw this.recoveryError;
    }
  }

  stage(id: string, fields: Partial<PdfAnnotation>, remove = false) {
    const previous = this.drafts.get(id);
    if (remove && !this.items.has(id) && !previous?.task) {
      this.drafts.delete(id);
      this.changed();
      return this.persist();
    }
    this.drafts.set(id, { ...previous, id, fields: { ...this.items.get(id), ...previous?.fields, ...fields }, remove });
    this.changed();
    return this.persist();
  }
  values() {
    const values = new Map(this.items);
    for (const [id, draft] of this.drafts) {
      if (draft.remove) values.delete(id);
      else values.set(id, { ...this.items.get(id), ...draft.fields, id } as PdfAnnotation);
    }
    return [...values.values()];
  }
  async reconcile(id: string, remote: PdfAnnotation | null, keepLocal: boolean) {
    if (this.running) throw new Error('请等待当前保存完成');
    const draft = this.drafts.get(id);
    if (!draft) return id;
    if (remote && (remote.noteId !== this.noteId || remote.sha256 !== this.sha256))
      throw new Error('标注来源已变化，草稿已保留');
    if (remote) this.items.set(id, remote);
    else this.items.delete(id);
    this.drafts.delete(id);
    let nextId = id;
    if (keepLocal && (!draft.remove || remote)) {
      if (!remote) nextId = randomId();
      this.drafts.set(nextId, { ...draft, id: nextId, task: undefined });
    }
    this.error = '';
    this.errorCode = '';
    await this.persist();
    this.changed();
    return nextId;
  }
  flush(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.drain().finally(() => {
      this.running = null;
      this.busy = false;
      this.changed();
    });
    return this.running;
  }
  private async drain() {
    this.busy = true;
    this.error = '';
    this.errorCode = '';
    this.changed();
    try {
      while (this.drafts.size) {
        const [id, draft] = this.drafts.entries().next().value!;
        draft.task ??= {
          ...draft.fields,
          operationId: randomId(),
          expectedRevision: this.items.get(id)?.revision ?? 0
        };
        const task = draft.task;
        await this.persist();
        if (!this.canWrite()) throw new Error('当前资料只读，PDF 标注草稿已保留。');
        const saved = await pdfRequest<PdfAnnotation>(annotationUrl(this.noteId, id), {
          method: draft.remove ? 'DELETE' : 'PUT',
          headers: { ...this.headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(task)
        });
        this.items.set(id, saved);
        const current = this.drafts.get(id)!;
        if (current === draft) this.drafts.delete(id);
        else this.drafts.set(id, { ...current, task: undefined });
        await this.persist();
        this.changed();
      }
    } catch (error) {
      this.errorCode = (error as { code?: string })?.code ?? '';
      this.error = error instanceof Error ? error.message : 'PDF 标注保存失败';
      this.changed();
      throw error;
    }
  }
}

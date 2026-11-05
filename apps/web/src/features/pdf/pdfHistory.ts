import type { PdfAnnotation } from '@study-accelerator/shared/pdf';
import { randomId } from './pdfApi';
import type { PdfSession } from './pdfSession';

type MarkState = Pick<PdfAnnotation, 'type' | 'segments' | 'quoteText' | 'kind' | 'comment'>;
type Entry = { id: string; before: MarkState | null; after: MarkState | null; comment: boolean; at: number };
const snapshot = (item: PdfAnnotation | undefined): MarkState | null =>
  item
    ? structuredClone({
        type: item.type,
        segments: item.segments,
        quoteText: item.quoteText,
        kind: item.kind,
        comment: item.comment
      })
    : null;
const same = (a: MarkState | null, b: MarkState | null) => JSON.stringify(a) === JSON.stringify(b);

/** 仅记录本次阅读会话的本机操作；保存仍经 PdfSession 的幂等队列与原修订检查。 */
export class PdfHistory {
  private past: Entry[] = [];
  private future: Entry[] = [];
  busy = false;
  constructor(
    private session: PdfSession,
    private changed: () => void,
    private canWrite = () => true
  ) {}
  get canUndo() {
    return !this.busy && this.past.length > 0 && !this.session.conflicts.size;
  }
  get canRedo() {
    return !this.busy && this.future.length > 0 && !this.session.conflicts.size;
  }
  clear() {
    this.past = [];
    this.future = [];
    this.changed();
  }
  stage(id: string, fields: Partial<PdfAnnotation>, remove = false) {
    if (this.busy || !this.canWrite()) return Promise.reject(new Error('当前无法修改标注。'));
    const before = snapshot(this.session.values().find(item => item.id === id));
    const pending = this.session.stage(id, fields, remove);
    const after = snapshot(this.session.values().find(item => item.id === id));
    if (!same(before, after)) {
      const at = Date.now(),
        previous = this.past.at(-1);
      const comment = !remove && Object.keys(fields).length === 1 && 'comment' in fields;
      if (!this.future.length && comment && previous?.comment && previous.id === id && at - previous.at < 1000) {
        previous.after = after;
        previous.at = at;
        if (same(previous.before, after)) this.past.pop();
      } else {
        this.past.push({ id, before, after, comment, at });
        if (this.past.length > 100) this.past.shift();
      }
      this.future = [];
      this.changed();
    }
    return pending;
  }
  async move(redo = false): Promise<string | null> {
    if (!this.canWrite() || !(redo ? this.canRedo : this.canUndo)) return null;
    const from = redo ? this.future : this.past,
      to = redo ? this.past : this.future;
    const entry = from.at(-1)!;
    this.busy = true;
    this.changed();
    try {
      // 请求可能已生效但回执丢失：先用冻结请求取得确认，不能绕过原方法与修订号。
      if (this.session.drafts.get(entry.id)?.task) await this.session.flush();
      if (!this.canWrite()) throw new Error('当前资料只读，未执行撤销或重做。');
      const expected = redo ? entry.before : entry.after;
      if (!same(snapshot(this.session.values().find(item => item.id === entry.id)), expected))
        throw new Error('标注内容已变化，请核对最新标注后再操作。');
      const target = redo ? entry.after : entry.before;
      if (target && this.session.items.get(entry.id)?.deletedAt) {
        // 已确认删除不可复活；恢复为同来源的新身份，并让同一条标注的其余历史继续指向它。
        const previousId = entry.id,
          id = randomId();
        for (const item of [...this.past, ...this.future]) if (item.id === previousId) item.id = id;
      }
      const pending = this.session.stage(entry.id, target ?? {}, !target);
      entry.comment = false;
      from.pop();
      to.push(entry);
      await pending;
      return target ? entry.id : null;
    } finally {
      this.busy = false;
      this.changed();
    }
  }
}

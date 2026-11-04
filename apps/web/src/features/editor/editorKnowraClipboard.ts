import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import { DOMParser as ProseDOMParser, type Schema, type Slice } from '@milkdown/kit/prose/model';
import { isHistoryTransaction } from '@milkdown/kit/prose/history';
import { KNOWRA_BLOCKS_ATTR, KNOWRA_MARK, type KnowraBlockEntry } from './editorKnowraMarks';

export const KNOWRA_CLIPBOARD_CUT = 'knowraClipboardCut';
export const KNOWRA_CLIPBOARD_COPY = 'knowraClipboardCopy';
export const KNOWRA_CLIPBOARD_PASTE = 'knowraClipboardPaste';
export const KNOWRA_CLIPBOARD_PLAIN = 'knowraClipboardPlain';

interface ClipboardIntent { text: string; signature: string }

export function knowraClipboardIntent(text: string, slice: Slice): ClipboardIntent {
  const runs: Array<{ text: string; marks: string }> = [];
  const blocks: unknown[] = [];
  slice.content.descendants(node => {
    if (node.attrs[KNOWRA_BLOCKS_ATTR]?.length) blocks.push(node.attrs[KNOWRA_BLOCKS_ATTR]);
    if (!node.isText) return;
    const marks = JSON.stringify(node.marks.filter(mark => mark.type.name === KNOWRA_MARK).map(mark => mark.attrs)
      .sort((left, right) => String(left.id).localeCompare(String(right.id))));
    const last = runs.at(-1);
    if (last?.marks === marks) last.text += node.text;
    else runs.push({ text: node.text!, marks });
  });
  return { text: text.replace(/\r\n?/g, '\n'), signature: JSON.stringify({ runs, blocks }) };
}

const isClipboardIntent = (value: unknown): value is ClipboardIntent => value !== null && typeof value === 'object'
  && typeof (value as ClipboardIntent).text === 'string' && typeof (value as ClipboardIntent).signature === 'string';

interface ClipboardPayload { text: string; html: string; plain: string }
let clipboardPayload: ClipboardPayload | null = null;
let nativeKnowraText: string | null = null;

/** 菜单的 text/plain 后备与原生 HTML 剪贴板共享同一份本会话载体，允许交叉使用两个入口。 */
export function rememberKnowraClipboard(slice: Slice, text: string, html: string) {
  nativeKnowraText = null;
  clipboardPayload = hasPastedKnowraMarks(slice) ? { text, html, plain: slice.content.textBetween(0, slice.content.size, '\n\n', '\uFFFC') } : null;
}

export function rememberNativeKnowraClipboard(slice: Slice, text: string) {
  clipboardPayload = null;
  nativeKnowraText = hasPastedKnowraMarks(slice) ? text : null;
}

export function expectsNativeKnowraClipboard(text: string) { return nativeKnowraText === text; }

export function recallKnowraClipboard(text: string) { return clipboardPayload?.text === text ? clipboardPayload : null; }

export function parseKnowraClipboardSlice(schema: Schema, html: string): Slice {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return ProseDOMParser.fromSchema(schema).parseSlice(parsed.body, { preserveWhitespace: true });
}

/** 菜单使用异步纯文本剪贴板时，用标记 Markdown 精确匹配一次剪切；撤销/复制会取消移动意图。 */
export function createKnowraClipboardIntent() {
  let cut: ClipboardIntent | null = null;
  return {
    clear: () => { cut = null; },
    consume(transactions: readonly Transaction[]) {
      let moving = false;
      for (const transaction of transactions) {
        if (isHistoryTransaction(transaction) || transaction.getMeta(KNOWRA_CLIPBOARD_COPY) || transaction.getMeta('uiEvent') === 'cut') cut = null;
        const text: unknown = transaction.getMeta(KNOWRA_CLIPBOARD_CUT);
        if (isClipboardIntent(text)) cut = text;
        if (transaction.getMeta('uiEvent') === 'paste') {
          const pasted: unknown = transaction.getMeta(KNOWRA_CLIPBOARD_PASTE);
          moving ||= cut !== null && isClipboardIntent(pasted) && pasted.text === cut.text && pasted.signature === cut.signature;
          cut = null;
        }
      }
      return moving;
    }
  };
}

export function hasPastedKnowraMarks(slice: Slice): boolean {
  let found = false;
  slice.content.descendants(node => {
    if (node.attrs[KNOWRA_BLOCKS_ATTR]?.length || node.marks.some(mark => mark.type.name === KNOWRA_MARK)) found = true;
    return !found;
  });
  return found;
}

/** 代码内仍只粘贴字面文字，同时保留剪贴板里已经解析、且与该文字精确对应的重点区间。 */
export function insertKnowraSource(state: EditorState, slice: Slice, source: string): Transaction | null {
  const type = state.schema.marks[KNOWRA_MARK];
  if (!type) return null;
  const text = source.replace(/\r\n?/g, '\n');
  const flat = slice.content.textBetween(0, slice.content.size, '\n\n', '\uFFFC');
  if (flat !== text) return null;
  const ranges: Array<{ from: number; to: number; mark: ReturnType<typeof type.create> }> = [];
  slice.content.descendants((node, position) => {
    if (!node.isText) return;
    const from = slice.content.textBetween(0, position, '\n\n', '\uFFFC').length;
    for (const mark of node.marks) if (mark.type === type) ranges.push({ from, to: from + node.nodeSize, mark });
  });
  if (!ranges.length) return null;
  const start = state.selection.from;
  const tr = state.tr.insertText(text).removeMark(start, start + text.length, type);
  for (const range of ranges) tr.addMark(start + range.from, start + range.to, range.mark);
  return tr.setMeta('uiEvent', 'paste');
}

/** 粘贴后的实际区间：在文本已经和原文合并时，也只改插入的那一部分。 */
export function remapCopiedKnowraMarks(tr: Transaction, ranges: Array<[number, number]>, moving: boolean): boolean {
  if (moving || !ranges.length) return false;
  const type = tr.doc.type.schema.marks[KNOWRA_MARK];
  const inside = (position: number) => ranges.some(([from, to]) => from <= position && position < to);
  const outside = new Set<string>();
  const positives = new Set<string>();
  const used = new Set<string>();
  tr.doc.descendants((node, position) => {
    const entries = (node.attrs[KNOWRA_BLOCKS_ATTR] as KnowraBlockEntry[] | null) ?? [];
    for (const entry of entries) {
      used.add(entry.id);
      if (!inside(position)) outside.add(entry.id);
      else if (!entry.exclude) positives.add(entry.id);
    }
    if (!node.isInline) return;
    for (const mark of node.marks.filter(mark => mark.type === type)) {
      const id = String(mark.attrs.id);
      used.add(id);
      if (ranges.some(([from, to]) => position < to && from < position + node.nodeSize)) positives.add(id);
      if (!ranges.some(([from, to]) => from <= position && position + node.nodeSize <= to)) outside.add(id);
    }
  });
  // 一次粘贴共用一张映射：跨格式、跨块、代码范围和章节排除均关联到同一个副本。
  const copies = new Map<string, string>();
  for (const id of positives) if (outside.has(id)) {
    let next: string;
    do { next = crypto.randomUUID().replace(/-/g, '').slice(0, 8); } while (used.has(next));
    used.add(next);
    copies.set(id, next);
  }
  let changed = false;
  for (const [from, end] of ranges) {
    const to = Math.min(end, tr.doc.content.size);
    tr.doc.nodesBetween(from, to, (node, position) => {
      if (node.isInline) for (const mark of node.marks.filter(mark => mark.type === type)) {
        const id = copies.get(String(mark.attrs.id));
        if (!id) continue;
        const start = Math.max(position, from);
        const stop = Math.min(position + node.nodeSize, to);
        tr.removeMark(start, stop, mark).addMark(start, stop, type.create({ ...mark.attrs, id }));
        changed = true;
      }
      const entries = node.attrs[KNOWRA_BLOCKS_ATTR] as KnowraBlockEntry[] | null;
      if (!entries?.length || !inside(position)) return;
      // 单独复制排除块不应继续排除原章节；剪切/拖动则保持原关联。
      const next = entries.filter(entry => !entry.exclude || positives.has(entry.id))
        .map(entry => copies.has(entry.id) ? { ...entry, id: copies.get(entry.id)! } : entry);
      if (next.length === entries.length && next.every((entry, index) => entry === entries[index])) return;
      tr.setNodeAttribute(position, KNOWRA_BLOCKS_ATTR, next.length ? next : null);
      changed = true;
    });
  }
  return changed;
}

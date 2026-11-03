import type { EditorView } from '@milkdown/kit/prose/view';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import type { Node } from '@milkdown/kit/prose/model';
import { TextSelection, Plugin } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { closeHistory } from '@milkdown/kit/prose/history';
import { linkSchema } from '@milkdown/kit/preset/commonmark';
import { createNoteLinkUrl, parseNoteLinkUrl, resolveNoteLinkOccurrence, type NoteLinkLocator } from '@study-accelerator/content-anchor';

/** 内部协议只存于 mark；DOM 使用应用内 hash，外链继续使用上游安全过滤。 */
export const noteLinkSchema = linkSchema.extendSchema(previous => ctx => {
  const schema = previous(ctx);
  return { ...schema,
    parseDOM: [{ tag: 'a[data-note-link-url]', getAttrs: element => {
      const url = (element as HTMLElement).getAttribute('data-note-link-url');
      return parseNoteLinkUrl(url) ? { href: url, title: null } : false;
    } }, ...(schema.parseDOM ?? [])],
    toDOM: (mark, inline) => {
      const parsed = parseNoteLinkUrl(mark.attrs.href);
      return parsed ? ['a', { href: `#/materials/notes/${encodeURIComponent(parsed.targetNoteId)}`,
        'data-note-link-url': mark.attrs.href, 'data-note-link': parsed.occurrenceId }, 0]
        : schema.toDOM!(mark, inline);
    }
  };
});

export function noteLinkDomBehavior(getStatuses: () => Record<string, 'active' | 'deleted'> | undefined) {
  return $prose(() => new Plugin({ props: { decorations(state) {
    const statuses = getStatuses();
    return DecorationSet.create(state.doc, rangesInDocument(state.doc).flatMap(range => {
      const status = statuses?.[range.targetNoteId] ?? 'active';
      const title = status === 'deleted' ? '目标已删除' : '打开目标笔记（可通过内部链接菜单编辑）';
      const result = [Decoration.inline(range.from, range.to, { 'data-note-link-status': status, title })];
      if (status === 'deleted') result.push(Decoration.widget(range.to, () => {
        const badge = document.createElement('span'); badge.textContent = '（目标已删除）';
        badge.dataset.noteLinkDeleted = ''; badge.contentEditable = 'false'; return badge;
      }, { key: `deleted:${range.occurrenceId}:${range.from}`, side: -1 }));
      return result;
    }));
  } } }));
}

export interface NoteLinkEditSession {
  document: unknown; from: number; to: number; label: string;
  targetNoteId?: string; occurrenceId?: string;
}

export function noteLinkRanges(view: EditorView) {
  return rangesInDocument(view.state.doc);
}
function rangesInDocument(doc: Node) {
  const ranges: Array<{ from: number; to: number; href: string; targetNoteId: string; occurrenceId: string }> = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const mark = node.marks.find(item => item.type.name === 'link' && parseNoteLinkUrl(item.attrs.href));
    const parsed = mark && parseNoteLinkUrl(mark.attrs.href);
    if (!mark || !parsed) return;
    const prior = ranges.at(-1);
    if (prior?.to === pos && prior.href === mark.attrs.href) prior.to += node.nodeSize;
    else ranges.push({ from: pos, to: pos + node.nodeSize, href: mark.attrs.href, ...parsed });
  });
  return ranges;
}

export function captureNoteLinkEdit(view: EditorView): NoteLinkEditSession | null {
  let { from, to } = view.state.selection;
  const existing = noteLinkRanges(view).find(range => range.from <= from && range.to >= to);
  if (existing) ({ from, to } = existing);
  if (from === to) return null;
  const start = view.state.doc.resolve(from), end = view.state.doc.resolve(to);
  if (!start.sameParent(end) || !start.parent.inlineContent || start.parent.type.spec.code) return null;
  // Inline atoms / hard breaks split a link during Markdown serialization. Only a
  // contiguous text range can retain exactly one occurrence identity.
  let textOnly = true;
  view.state.doc.nodesBetween(from, to, node => { if (node.isInline && !node.isText) textOnly = false; });
  if (!textOnly) return null;
  return { document: view.state.doc, from, to, label: view.state.doc.textBetween(from, to),
    targetNoteId: existing?.targetNoteId, occurrenceId: existing?.occurrenceId };
}

export function applyNoteLinkEdit(view: EditorView, session: NoteLinkEditSession, targetNoteId: string | null, label: string): boolean {
  if (view.state.doc !== session.document || !label.trim()) return false;
  const type = view.state.schema.marks.link;
  if (!type) return false;
  const transaction = closeHistory(view.state.tr);
  let to = session.to;
  transaction.removeMark(session.from, session.to, type);
  const legacyType = view.state.schema.marks.internalLink;
  if (legacyType) transaction.removeMark(session.from, session.to, legacyType);
  if (label !== session.label) {
    transaction.insertText(label, session.from, session.to);
    to = session.from + label.length;
  }
  if (targetNoteId) {
    const href = createNoteLinkUrl(targetNoteId, session.occurrenceId ?? crypto.randomUUID());
    transaction.addMark(session.from, to, type.create({ href, title: null }));
  }
  transaction.setSelection(TextSelection.create(transaction.doc, session.from, to));
  view.dispatch(transaction.scrollIntoView());
  view.focus();
  return true;
}

export function selectNoteLinkOccurrence(view: EditorView, markdown: string, locator: NoteLinkLocator): boolean {
  if (!resolveNoteLinkOccurrence(markdown, locator)) return false;
  const ranges = noteLinkRanges(view).filter(item => item.occurrenceId === locator.occurrenceId);
  if (ranges.length !== 1 || ranges[0].targetNoteId !== locator.targetNoteId) return false;
  const { from, to } = ranges[0];
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)).scrollIntoView());
  view.focus();
  return true;
}

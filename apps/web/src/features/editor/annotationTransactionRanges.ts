import { listItemAt } from './editorListAnnotations';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import type { Transaction } from '@milkdown/kit/prose/state';
export interface TrackedAnnotationRange { from: number; to: number; scopeType: 'selection' | 'blocks' | 'section' | 'list'; missing?: boolean; needsReview?: boolean }
export function mapAnnotationRange(range: TrackedAnnotationRange, transaction: Transaction): TrackedAnnotationRange {
  if (range.missing) return range;
  if (range.scopeType === 'selection') {
    const start = transaction.before.resolve(range.from), end = transaction.before.resolve(range.to);
    if (start.sameParent(end) && start.parent.type.name === 'code_block'
      && range.from === start.start() && range.to === end.end()) {
      const mapped = mapAnnotationRange({ ...range, scopeType: 'blocks' }, transaction);
      return { ...mapped, scopeType: 'selection', ...(mapped.from >= mapped.to ? { missing: true } : {}) };
    }
  }
  let from = range.from, to = range.to;
  let internal = true;
  for (let index = 0; index < transaction.mapping.maps.length; index++) {
    const map = transaction.mapping.maps[index];
    let replacement: { from: number; to: number } | undefined;
    let removed = false;
    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      if (oldStart < from || oldEnd > to) internal = false;
      if (oldStart <= from && oldEnd >= to && oldEnd > oldStart) {
        if (oldStart === from && oldEnd === to && (newEnd > newStart || range.scopeType === 'blocks')) replacement = { from: newStart, to: newEnd };
        else removed = true;
      }
    });
    if (removed) return { ...range, missing: true };
    if (replacement) { from = replacement.from; to = replacement.to; }
    else { from = map.map(from, 1); to = map.map(to, -1); }
  }
  if (from >= to && range.scopeType === 'selection') return { ...range, missing: true };
  from = Math.max(0, Math.min(from, transaction.doc.content.size));
  to = Math.max(from, Math.min(to, transaction.doc.content.size));
  if (range.scopeType === 'list') {
    const old = listItemAt(transaction.before, range.from);
    const current = listItemAt(transaction.doc, from);
    if (!old || !current || current.task) return { ...range, from, to, needsReview: true };
    const structureChanged = old.depth !== current.depth || current.from !== from || current.to > to;
    return { ...range, from: current.from, to: current.to, needsReview: range.needsReview || (!internal && structureChanged) };
  }
  if (range.scopeType === 'section') {
    const previous = headingAt(transaction.before, range.from);
    const current = headingAt(transaction.doc, from);
    if (!previous || !current) return { ...range, from, to, missing: true };
    const boundary = nextHeading(transaction.doc, current.position, current.level);
    const oldBoundary = nextHeading(transaction.before, previous.position, previous.level);
    const mappedBoundary = oldBoundary ? transaction.mapping.map(oldBoundary.position, 1) : null;
    const needsReview = current.level !== previous.level || (boundary?.position ?? null) !== mappedBoundary;
    return { ...range, from: current.position + 1, to: boundary?.position ?? transaction.doc.content.size, needsReview };
  }
  if (range.scopeType === 'blocks') {
    const start = transaction.doc.resolve(from), end = transaction.doc.resolve(to);
    if (start.depth && end.depth) {
      const startOfBlock = start.start(), endOfBlock = end.end();
      if (internal) return { ...range, from: startOfBlock, to: endOfBlock };
      // Partial coverage after joining must become a selection, not absorb adjacent text.
      if (startOfBlock < from || endOfBlock > to) {
        return { from, to, scopeType: 'selection' };
      }
    }
  }
  return { ...range, from, to };
}
function headingAt(doc: ProseNode, from: number) {
  let found: { position: number; level: number } | null = null;
  doc.descendants((node, position) => {
    if (node.type.name === 'heading' && position < from && position + node.nodeSize >= from) found = { position, level: Number(node.attrs.level) };
  });
  return found as { position: number; level: number } | null;
}
function nextHeading(doc: ProseNode, after: number, level: number) {
  let found: { position: number; level: number } | null = null;
  doc.descendants((node, position) => {
    if (!found && position > after && node.type.name === 'heading' && Number(node.attrs.level) <= level) found = { position, level: Number(node.attrs.level) };
  });
  return found as { position: number; level: number } | null;
}

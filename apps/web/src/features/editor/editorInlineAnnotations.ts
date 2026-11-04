import type { Mark, Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import type { Annotation } from '@study-accelerator/web-core';
import { listItemAt } from './editorListAnnotations';
import { KNOWRA_BLOCKS_ATTR, KNOWRA_MARK, type KnowraBlockEntry } from './editorKnowraMarks';

/**
 * 重点内联化 I3b：编辑器里的内联重点（正文标记）。
 * - 显示：按标记与块属性生成与旧高亮相同的装饰（editor-annotation、重要程度配色、data-annotation-ids 供点击选中）。
 * - 操作：新建、取消（可撤销）、改类型和重要程度、重新选择、排除当前块、定位都只改正文，保存后由服务端派生 v3 行。
 */
export type InlineAnnotationScope = 'selection' | 'blocks' | 'section' | 'list';
export type InlineAnnotationImportance = 'normal' | 'important' | 'core';
type MarkData = Record<string, string>;

const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'code_block',
  'math_block',
  'table',
  'list_item',
  'blockquote',
  'hr'
]);

export const isInlineAnnotation = (annotation: Pick<Annotation, 'schemaVersion'>) => annotation.schemaVersion === 3;
export const inlineMarkIdOf = (annotation: Annotation) =>
  (annotation.anchor as unknown as { markId?: string } | null)?.markId ?? null;

function insideTable(doc: ProseNode, position: number) {
  const resolved = doc.resolve(position);
  for (let depth = resolved.depth; depth > 0; depth -= 1) if (resolved.node(depth).type.name === 'table') return true;
  return false;
}

/**
 * 范围内各行的外层块：段落若是列表项、引用的第一个子节点，与父块同行，块级标记归父块（与写出规则一致）；
 * 表格整体作为一个块，不展开单元格。迁移计算与编辑器操作共用。
 */
export function outerBlocks(doc: ProseNode, from: number, to: number) {
  const result: Array<{ node: ProseNode; position: number }> = [];
  doc.nodesBetween(from, to, (node, position) => {
    if (!BLOCK_TYPES.has(node.type.name)) return true;
    const contentFrom = position + 1;
    const contentTo = position + node.nodeSize - 1;
    if (contentTo <= from || contentFrom >= to) return false;
    if (node.type.name === 'paragraph' && !node.content.size) return false;
    if (insideTable(doc, position) && node.type.name !== 'table') return false;
    // nodesBetween 也访问仅部分相交的祖先；不能把一个续段扩大成整棵列表或引用。
    if (['list_item', 'blockquote'].includes(node.type.name)) {
      let textFrom = Infinity,
        textTo = -Infinity;
      node.descendants((child, offset) => {
        if (child.isText) {
          textFrom = Math.min(textFrom, position + 1 + offset);
          textTo = Math.max(textTo, position + 1 + offset + child.nodeSize);
        }
      });
      if (from > textFrom || to < textTo) return true;
    }
    result.push({ node, position });
    return false;
  });
  return result;
}

/** 光标所在行的外层块（收拢选区时只取一个）。 */
function blockAt(doc: ProseNode, position: number) {
  const resolved = doc.resolve(position);
  let found: { node: ProseNode; position: number } | null = null;
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const node = resolved.node(depth);
    if (node.type.name === 'table') {
      found = { node, position: resolved.before(depth) };
      continue;
    }
    if (!BLOCK_TYPES.has(node.type.name) || insideTable(doc, resolved.before(depth))) continue;
    const parent = resolved.node(depth - 1);
    if (
      node.type.name === 'paragraph' &&
      ['list_item', 'blockquote'].includes(parent.type.name) &&
      resolved.index(depth - 1) === 0
    )
      continue;
    if (!found) found = { node, position: resolved.before(depth) };
  }
  return found;
}

/** 光标所在章节的标题：光标在标题内即该标题，否则取它之前最近的标题（与旧链路一致）。 */
function sectionHeadingAt(doc: ProseNode, position: number) {
  let found: { node: ProseNode; position: number } | null = null;
  doc.descendants((node, at) => {
    if (at > position) return false;
    if (node.type.name === 'heading' && position < sectionEnd(doc, at, Number(node.attrs.level)))
      found = { node, position: at };
    return true;
  });
  return found as { node: ProseNode; position: number } | null;
}

function sectionEnd(doc: ProseNode, headingPosition: number, level: number) {
  const container = doc.resolve(headingPosition);
  let end = container.end();
  let found = false;
  doc.descendants((node, at) => {
    if (found || at <= headingPosition || at >= end) return true;
    if (node.type.name === 'heading' && Number(node.attrs.level) <= level) {
      end = at;
      found = true;
    }
    return true;
  });
  return end;
}

export function createInlineMarkId(doc: ProseNode) {
  const taken = new Set(Object.keys(inlineAnnotationRanges(doc).byId));
  let id: string;
  do id = `k${Math.random().toString(36).slice(2, 9)}`;
  while (taken.has(id));
  return id;
}

function markData(importance: InlineAnnotationImportance, kind = 'important'): MarkData {
  return {
    t: 'key',
    ...(kind !== 'important' ? { c: kind } : {}),
    ...(importance !== 'normal' ? { l: importance } : {})
  };
}

function appendBlockEntry(tr: Transaction, position: number, entry: KnowraBlockEntry) {
  const current = (tr.doc.nodeAt(position)?.attrs[KNOWRA_BLOCKS_ATTR] as KnowraBlockEntry[] | null) ?? [];
  if (current.some(item => item.id === entry.id && Boolean(item.exclude) === Boolean(entry.exclude))) return;
  tr.setNodeAttribute(position, KNOWRA_BLOCKS_ATTR, [...current, entry]);
}

/** 在当前选区或光标处按范围写入标记；返回标记 ID。错误信息与旧入口一致。 */
function applyMark(tr: Transaction, scope: InlineAnnotationScope, markId: string, data: MarkData) {
  const { doc, selection } = tr;
  const markType = doc.type.schema.marks[KNOWRA_MARK];
  if (scope === 'selection') {
    if (selection.empty || !doc.textBetween(selection.from, selection.to).trim())
      throw new Error('请先在正文中选中要标记的内容');
    let unsupported = false;
    doc.nodesBetween(selection.from, selection.to, node => {
      if (node.isTextblock && !node.type.allowsMarkType(markType)) unsupported = true;
    });
    if (unsupported) throw new Error('当前范围不支持选区重点，请改用整块重点');
    tr.addMark(selection.from, selection.to, markType.create({ id: markId, data }));
    return;
  }
  if (scope === 'section') {
    const heading = sectionHeadingAt(doc, selection.from);
    if (!heading) throw new Error('请先将光标放在标题章节内');
    appendBlockEntry(tr, heading.position, { id: markId, attrs: { s: 'section', ...data } });
    return;
  }
  if (scope === 'list') {
    const item = listItemAt(doc, selection.from);
    if (!item || item.task || !item.node.textContent.trim()) throw new Error('请先将光标放在非空的普通列表项内');
    appendBlockEntry(tr, item.position, { id: markId, attrs: { s: 'list', ...data } });
    return;
  }
  const blocks = selection.empty
    ? [blockAt(doc, selection.from)].filter((item): item is { node: ProseNode; position: number } => Boolean(item))
    : outerBlocks(doc, selection.from, selection.to);
  if (blocks.some(block => block.node.type.name === 'paragraph' && !block.node.content.size))
    throw new Error('空段落无法标记为重点');
  if (!blocks.length) throw new Error('请先在正文中选择对应内容');
  for (const block of blocks) appendBlockEntry(tr, block.position, { id: markId, attrs: { s: 'blocks', ...data } });
}

// ───────────────────────────── 读取 ─────────────────────────────

interface InlineRanges {
  /** 每个标记的文字区间（已减去排除块），用于显示与定位。 */
  byId: Record<string, Array<{ from: number; to: number }>>;
  /** 每个标记写在正文里的属性（重要程度等）。 */
  dataById: Record<string, MarkData>;
  /** 列表项重点所在的列表项节点。 */
  listItems: Array<{ id: string; position: number; size: number }>;
}

export function inlineAnnotationRanges(doc: ProseNode): InlineRanges {
  const byId: InlineRanges['byId'] = {};
  const dataById: InlineRanges['dataById'] = {};
  const listItems: InlineRanges['listItems'] = [];
  const excluded: Record<string, Array<{ from: number; to: number }>> = {};
  const push = (id: string, from: number, to: number) => {
    if (to <= from) return;
    const list = (byId[id] ??= []);
    const last = list.at(-1);
    if (last && last.to >= from) last.to = Math.max(last.to, to);
    else list.push({ from, to });
  };
  doc.descendants((node, position) => {
    for (const entry of (node.attrs[KNOWRA_BLOCKS_ATTR] as KnowraBlockEntry[] | null) ?? []) {
      if (entry.exclude) {
        (excluded[entry.id] ??= []).push({ from: position, to: position + node.nodeSize });
        continue;
      }
      dataById[entry.id] ??= entry.attrs;
      if (entry.attrs.s === 'section' && node.type.name === 'heading')
        push(entry.id, position + 1, sectionEnd(doc, position, Number(node.attrs.level)));
      else if (entry.attrs.s === 'code') continue;
      else {
        push(entry.id, position + 1, position + node.nodeSize - 1);
        if (entry.attrs.s === 'list') listItems.push({ id: entry.id, position, size: node.nodeSize });
      }
    }
    if (!node.isInline) return true;
    for (const mark of node.marks as readonly Mark[]) {
      if (mark.type.name !== KNOWRA_MARK) continue;
      dataById[mark.attrs.id] ??= mark.attrs.data as MarkData;
      push(mark.attrs.id, position, position + node.nodeSize);
    }
    return true;
  });
  for (const [id, holes] of Object.entries(excluded)) {
    const ranges = byId[id];
    if (!ranges) continue;
    byId[id] = ranges.flatMap(range => {
      let pieces = [range];
      for (const hole of holes)
        pieces = pieces.flatMap(piece =>
          hole.to <= piece.from || hole.from >= piece.to
            ? [piece]
            : [
                { from: piece.from, to: hole.from },
                { from: hole.to, to: piece.to }
              ].filter(item => item.to > item.from)
        );
      return pieces;
    });
  }
  return { byId, dataById, listItems };
}

// ───────────────────────────── 显示 ─────────────────────────────

interface HighlightState {
  rows: Map<string, Annotation>;
  focusedId: string | null;
  decorations: DecorationSet;
}
export const inlineAnnotationHighlightKey = new PluginKey<HighlightState>('KNOWRA_INLINE_ANNOTATIONS');

const RANK: Record<string, number> = { normal: 1, important: 2, core: 3 };

function buildDecorations(doc: ProseNode, rows: Map<string, Annotation>, focusedId: string | null) {
  const { byId, dataById, listItems } = inlineAnnotationRanges(doc);
  const segments = Object.entries(byId).flatMap(([id, ranges]) => ranges.map(range => ({ ...range, id })));
  const boundaries = [...new Set(segments.flatMap(item => [item.from, item.to]))].sort((left, right) => left - right);
  const decorations: Decoration[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const from = boundaries[index],
      to = boundaries[index + 1];
    const ids = [...new Set(segments.filter(item => item.from < to && item.to > from).map(item => item.id))];
    if (!ids.length) continue;
    const rowIds = ids.map(id => rows.get(id)?.id).filter((id): id is string => Boolean(id));
    const level = ids
      .map(id => dataById[id]?.l ?? 'normal')
      .sort((left, right) => (RANK[right] ?? 0) - (RANK[left] ?? 0))[0];
    decorations.push(
      Decoration.inline(from, to, {
        class: ['editor-annotation', rowIds.includes(focusedId ?? '') ? 'editor-annotation-active' : '']
          .filter(Boolean)
          .join(' '),
        'data-importance': level,
        'data-annotation-ids': JSON.stringify(rowIds),
        'data-annotation-count': String(rowIds.length),
        ...(rowIds.length === 1 ? { 'data-annotation-id': rowIds[0] } : {}),
        title: '重要内容标注'
      })
    );
  }
  for (const item of listItems)
    decorations.push(
      Decoration.node(item.position, item.position + item.size, {
        class: 'editor-list-annotation',
        'data-list-annotation': rows.get(item.id)?.id ?? ''
      })
    );
  return DecorationSet.create(doc, decorations);
}

export const inlineAnnotationHighlightBehavior = $prose(
  () =>
    new Plugin<HighlightState>({
      key: inlineAnnotationHighlightKey,
      state: {
        init: (_config, state) => ({
          rows: new Map(),
          focusedId: null,
          decorations: buildDecorations(state.doc, new Map(), null)
        }),
        apply(tr, previous) {
          const meta = tr.getMeta(inlineAnnotationHighlightKey) as
            { rows?: Map<string, Annotation>; focusedId?: string | null } | undefined;
          if (!meta && !tr.docChanged) return previous;
          const rows = meta?.rows ?? previous.rows;
          const focusedId = meta && 'focusedId' in meta ? (meta.focusedId ?? null) : previous.focusedId;
          return { rows, focusedId, decorations: buildDecorations(tr.doc, rows, focusedId) };
        }
      },
      props: { decorations: state => inlineAnnotationHighlightKey.getState(state)?.decorations ?? null }
    })
);

/** 把服务端派生的 v3 行交给显示插件：按标记 ID 对应行，供点击选中与聚焦样式使用。 */
export function setInlineAnnotationRows(view: EditorView, annotations: Annotation[], focusedId: string | null) {
  const rows = new Map(
    annotations
      .filter(item => isInlineAnnotation(item) && (item.lifecycleStatus ?? 'active') === 'active')
      .map(item => [inlineMarkIdOf(item) ?? '', item] as const)
      .filter(([markId]) => markId)
  );
  view.dispatch(
    view.state.tr.setMeta(inlineAnnotationHighlightKey, { rows, focusedId }).setMeta('addToHistory', false)
  );
}

// ───────────────────────────── 操作 ─────────────────────────────

export function createInlineAnnotation(
  view: EditorView,
  scope: InlineAnnotationScope,
  importance: InlineAnnotationImportance = 'normal'
) {
  const markId = createInlineMarkId(view.state.doc);
  const tr = view.state.tr;
  applyMark(tr, scope, markId, markData(importance));
  view.dispatch(tr.scrollIntoView());
  return markId;
}

/** 取消前的快照：自定义撤销只接受取消后的原文档，避免相同文字误定位。 */
export interface InlineAnnotationSnapshot {
  removedDocument?: ProseNode;
  markId: string;
  inline: Array<{ from: number; to: number; text: string; data: MarkData }>;
  blocks: Array<{ position: number; type: string; text: string; entry: KnowraBlockEntry }>;
}

function snapshotOf(state: EditorState, markId: string): InlineAnnotationSnapshot {
  const snapshot: InlineAnnotationSnapshot = { markId, inline: [], blocks: [] };
  state.doc.descendants((node, position) => {
    for (const entry of (node.attrs[KNOWRA_BLOCKS_ATTR] as KnowraBlockEntry[] | null) ?? []) {
      if (entry.id === markId) snapshot.blocks.push({ position, type: node.type.name, text: node.textContent, entry });
    }
    if (!node.isInline) return true;
    const mark = node.marks.find(item => item.type.name === KNOWRA_MARK && item.attrs.id === markId);
    if (!mark) return true;
    const last = snapshot.inline.at(-1);
    if (last && last.to === position && JSON.stringify(last.data) === JSON.stringify(mark.attrs.data))
      last.to = position + node.nodeSize;
    else
      snapshot.inline.push({
        from: position,
        to: position + node.nodeSize,
        text: '',
        data: mark.attrs.data as MarkData
      });
    return true;
  });
  for (const item of snapshot.inline) item.text = state.doc.textBetween(item.from, item.to, '\n', '￼');
  return snapshot;
}

function removeFrom(tr: Transaction, snapshot: InlineAnnotationSnapshot) {
  const markType = tr.doc.type.schema.marks[KNOWRA_MARK];
  for (const item of snapshot.inline)
    tr.removeMark(item.from, item.to, markType.create({ id: snapshot.markId, data: item.data }));
  const positions = [...new Set(snapshot.blocks.map(item => item.position))];
  for (const position of positions) {
    const current = (tr.doc.nodeAt(position)?.attrs[KNOWRA_BLOCKS_ATTR] as KnowraBlockEntry[] | null) ?? [];
    const next = current.filter(item => item.id !== snapshot.markId);
    tr.setNodeAttribute(position, KNOWRA_BLOCKS_ATTR, next.length ? next : null);
  }
}

export function hasInlineAnnotation(view: EditorView, markId: string) {
  const snapshot = snapshotOf(view.state, markId);
  return snapshot.inline.length + snapshot.blocks.length > 0;
}

export function removeInlineAnnotation(view: EditorView, markId: string): InlineAnnotationSnapshot {
  const snapshot = snapshotOf(view.state, markId);
  if (!snapshot.inline.length && !snapshot.blocks.length) throw new Error('正文中已经没有这条重点');
  const tr = view.state.tr;
  removeFrom(tr, snapshot);
  view.dispatch(tr);
  snapshot.removedDocument = view.state.doc;
  return snapshot;
}

export function restoreInlineAnnotation(view: EditorView, snapshot: InlineAnnotationSnapshot) {
  const { doc } = view.state;
  if (!snapshot.removedDocument || !doc.eq(snapshot.removedDocument))
    throw new Error('正文已经变化，无法安全恢复这条重点；请使用编辑器撤销或重新标记');
  const markType = doc.type.schema.marks[KNOWRA_MARK];
  const changed =
    snapshot.inline.some(
      item => item.to > doc.content.size || doc.textBetween(item.from, item.to, '\n', '￼') !== item.text
    ) ||
    snapshot.blocks.some(item => {
      const node = doc.nodeAt(item.position);
      return !node || node.type.name !== item.type || node.textContent !== item.text;
    });
  if (changed) throw new Error('正文已经变化，无法撤销，请重新标记');
  const tr = view.state.tr;
  for (const item of snapshot.inline)
    tr.addMark(item.from, item.to, markType.create({ id: snapshot.markId, data: item.data }));
  for (const item of snapshot.blocks) appendBlockEntry(tr, item.position, item.entry);
  view.dispatch(tr);
}

/** 改类型或重要程度：同一标记的所有片段与块属性一起改。 */
export function updateInlineAnnotation(
  view: EditorView,
  markId: string,
  patch: { kind?: string; importance?: InlineAnnotationImportance | null }
) {
  const snapshot = snapshotOf(view.state, markId);
  if (!snapshot.inline.length && !snapshot.blocks.length) throw new Error('正文中已经没有这条重点');
  const update = (data: MarkData) => {
    const next = { ...data };
    if (patch.kind !== undefined) {
      if (patch.kind && patch.kind !== 'important') next.c = patch.kind;
      else delete next.c;
    }
    if (patch.importance !== undefined) {
      if (patch.importance && patch.importance !== 'normal') next.l = patch.importance;
      else delete next.l;
    }
    return next;
  };
  const tr = view.state.tr;
  removeFrom(tr, snapshot);
  const markType = tr.doc.type.schema.marks[KNOWRA_MARK];
  for (const item of snapshot.inline)
    tr.addMark(item.from, item.to, markType.create({ id: markId, data: update(item.data) }));
  for (const item of snapshot.blocks)
    appendBlockEntry(
      tr,
      item.position,
      item.entry.exclude
        ? item.entry
        : {
            ...item.entry,
            attrs: { ...update(item.entry.attrs), ...(item.entry.attrs.s ? { s: item.entry.attrs.s } : {}) }
          }
    );
  view.dispatch(tr);
}

/** 重新选择范围：保留标记 ID 与属性（备注、修订号随服务端行保留），只换位置；排除不再适用，一并去掉。 */
export function reanchorInlineAnnotation(view: EditorView, markId: string, scope: InlineAnnotationScope) {
  const snapshot = snapshotOf(view.state, markId);
  const data =
    snapshot.inline[0]?.data ??
    Object.fromEntries(
      Object.entries(snapshot.blocks.find(item => !item.entry.exclude)?.entry.attrs ?? { t: 'key' }).filter(
        ([key]) => key !== 's'
      )
    );
  const tr = view.state.tr;
  removeFrom(tr, snapshot);
  applyMark(tr, scope, markId, data);
  view.dispatch(tr.scrollIntoView());
}

/** 从章节或列表项重点中排除光标所在的块。 */
export function excludeBlockFromInlineAnnotation(view: EditorView, markId: string) {
  const { doc, selection } = view.state;
  const block = blockAt(doc, selection.from);
  if (!block) throw new Error('请先将光标放在要排除的内容块内');
  const ranges = inlineAnnotationRanges(doc).byId[markId] ?? [];
  if (!ranges.some(range => range.from <= block.position + 1 && range.to >= block.position + block.node.nodeSize - 1))
    throw new Error('当前内容块不在这条重点范围内');
  const tr = view.state.tr;
  appendBlockEntry(tr, block.position, { id: markId, attrs: {}, exclude: true });
  view.dispatch(tr);
}

/** 定位：选中第一段并滚动到可见处。 */
export function selectInlineAnnotation(view: EditorView, markId: string) {
  const [first] = inlineAnnotationRanges(view.state.doc).byId[markId] ?? [];
  if (!first) return false;
  const { doc } = view.state;
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.between(doc.resolve(first.from), doc.resolve(Math.min(first.to, doc.content.size))))
      .scrollIntoView()
      .setMeta('addToHistory', false)
  );
  return true;
}

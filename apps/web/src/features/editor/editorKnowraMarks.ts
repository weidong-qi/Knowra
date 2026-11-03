import { ParserReady, SerializerReady, editorStateTimerCtx, parserCtx, serializerCtx } from '@milkdown/kit/core';
import type { Mark, MarkType, Node as ProseNode } from '@milkdown/kit/prose/model';
import { Transform } from '@milkdown/kit/prose/transform';
import { $markSchema, addTimer } from '@milkdown/kit/utils';
import { alignIdentityBlocks, EDITOR_TO_MARKDOWN_BLOCK, identityBlockModels, parseIdentityBlocks } from '@study-accelerator/content-anchor';
import {
  insertKnowraMarks,
  parseKnowraMarks,
  stripKnowraMarksMapped,
  type KnowraBlockInsertion,
  type KnowraInlineInsertion,
  type KnowraMarkAttrs
} from '@study-accelerator/shared/knowra-marks';

/**
 * 重点内联化 I1：正文中的 Knowra 标记（《重点标记内联化方案》第 2 节）与编辑器文档互相转换。
 * - 行内 `<mark data-k>` ↔ mark `knowraMark`（代码块内 ↔ `<!--k id s=code r= h=-->`）。
 * - 块级 `<!--k id ...-->` ↔ 块节点属性 `knowraBlocks`。
 * 在解析器和序列化器入口转换：Milkdown 只处理去掉标记的 Markdown，位置靠"块内偏移 ↔ 源码偏移"模型换算。
 * 加载时有标记无法落位，整篇按原文解析（多显示几个 HTML 标签，但不丢内容）。
 */
export const KNOWRA_MARK = 'knowraMark';
export const KNOWRA_BLOCKS_ATTR = 'knowraBlocks';

export interface KnowraBlockEntry { id: string; attrs: KnowraMarkAttrs; exclude?: boolean }
export interface KnowraMarkProblem { stage: 'parse' | 'serialize'; id?: string; reason: string }

const clipboardId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(value);
const clipboardAttrs = (value: unknown): value is KnowraMarkAttrs => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.entries(value).every(([key, item]) => /^[a-z][a-z0-9-]*$/.test(key) && typeof item === 'string');

/** 剪贴板 HTML 不可信，只接收可由正文格式无损表达的块标记；未知合法属性继续保留。 */
export function parseKnowraClipboardBlocks(source: string | null): KnowraBlockEntry[] | null {
  try {
    const parsed: unknown = JSON.parse(source ?? 'null');
    if (!Array.isArray(parsed)) return null;
    const entries = parsed.filter((entry): entry is KnowraBlockEntry => entry !== null && typeof entry === 'object'
      && clipboardId(entry.id) && clipboardAttrs(entry.attrs) && (entry.exclude === undefined || typeof entry.exclude === 'boolean'));
    return entries.length ? entries : null;
  } catch { return null; }
}

export const knowraMarkSchema = $markSchema(KNOWRA_MARK, () => ({
  attrs: { id: { default: '' }, data: { default: {} } },
  excludes: '',
  inclusive: false,
  parseDOM: [{
    tag: 'mark[data-knowra-mark]',
    // 普通高亮也使用 <mark>；剪贴板中的重点载体必须优先读回，不能退化成 highlight。
    priority: 60,
    getAttrs: (dom) => {
      const element = dom as HTMLElement;
      const id = element.getAttribute('data-knowra-mark');
      if (!clipboardId(id)) return false;
      try {
        const data: unknown = JSON.parse(element.getAttribute('data-knowra-attrs') ?? '{}');
        return clipboardAttrs(data) ? { id, data } : false;
      } catch { return false; }
    }
  }],
  toDOM: (mark) => ['mark', {
    'data-knowra-mark': mark.attrs.id,
    'data-knowra-roles': (mark.attrs.data as KnowraMarkAttrs).t ?? '',
    'data-knowra-attrs': JSON.stringify(mark.attrs.data)
  }, 0],
  parseMarkdown: { match: () => false, runner: () => {} },
  // 序列化前由 serializeWithKnowraMarks 剥离，标记按偏移另行写回。
  toMarkdown: { match: (mark) => mark.type.name === KNOWRA_MARK, runner: () => undefined as never }
}));

interface EditorEntry { id: string; node: ProseNode; position: number; type: string; empty: boolean }

/** 与服务端 parseIdentityBlocks 同序的编辑器块；表格整体参与对齐，不展开单元格。 */
function editorEntries(doc: ProseNode): EditorEntry[] {
  const entries: EditorEntry[] = [];
  doc.descendants((node, position) => {
    const type = EDITOR_TO_MARKDOWN_BLOCK[node.type.name as keyof typeof EDITOR_TO_MARKDOWN_BLOCK];
    if (type) entries.push({ id: String(entries.length), node, position, type, empty: node.type.name === 'paragraph' && node.content.size === 0 });
    return node.type.name !== 'table';
  });
  return entries;
}

interface Alignment {
  entries: EditorEntry[];
  blocks: ReturnType<typeof parseIdentityBlocks>;
  models: ReturnType<typeof identityBlockModels>;
  editorToMarkdown: Map<number, number>;
  markdownToEditor: Map<number, number>;
}

function align(doc: ProseNode, markdown: string): Alignment | null {
  const entries = editorEntries(doc);
  const blocks = parseIdentityBlocks(markdown);
  const result = alignIdentityBlocks(blocks, entries);
  if (!result.aligned) return null;
  const editorToMarkdown = result.pairs as Map<number, number>;
  return { entries, blocks, models: identityBlockModels(markdown), editorToMarkdown, markdownToEditor: new Map([...editorToMarkdown].map(([editor, md]) => [md, editor])) };
}

interface OffsetModel { size: number; start: Array<number | null>; end: Array<number | null>; from?: number; to?: number }
type BlockModel = OffsetModel | { kind: 'table'; rows: Array<Array<OffsetModel | null>> } | null;

function cellModel(model: BlockModel, cell?: [number, number]): OffsetModel | null {
  if (!model) return null;
  if ('kind' in model) return cell ? model.rows[cell[0]]?.[cell[1]] ?? null : null;
  return cell ? null : model;
}

/** 表格中某个单元格里的文本块及其内容起点。 */
function tableCellTextblock(table: ProseNode, tablePosition: number, row: number, column: number) {
  let position = tablePosition + 1;
  for (let index = 0; index < row; index += 1) position += table.child(index).nodeSize;
  const rowNode = table.maybeChild(row);
  if (!rowNode) return null;
  position += 1;
  for (let index = 0; index < column; index += 1) position += rowNode.child(index).nodeSize;
  const cell = rowNode.maybeChild(column);
  const textblock = cell?.firstChild;
  if (!cell || !textblock?.isTextblock) return null;
  return { node: textblock, contentStart: position + 2 };
}

const lineStartOf = (markdown: string, offset: number) => markdown.lastIndexOf('\n', offset - 1) + 1;
const lineIndexOf = (markdown: string, offset: number) => {
  let count = 0;
  for (let index = markdown.indexOf('\n'); index >= 0 && index < offset; index = markdown.indexOf('\n', index + 1)) count += 1;
  return count;
};
const dataOf = (attrs: KnowraMarkAttrs) => Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== 'k'));
const markKey = (mark: Mark) => `${mark.type.name}${JSON.stringify(mark.attrs)}`;

// ───────────────────────────── 序列化：文档 → 带标记的 Markdown ─────────────────────────────

interface InlinePiece { id: string; data: KnowraMarkAttrs; from: number; to: number }

/**
 * 文本块里每条行内标记的片段（块内容偏移）。在其他格式变化、换行和硬换行处切段，
 * 保证每段落在同一个 Markdown 兄弟节点内，写回的 `<mark>` 与强调、链接正确嵌套；行内代码整体包住。
 */
function inlinePieces(textblock: ProseNode, type: MarkType): InlinePiece[] {
  const children: Array<{ from: number; to: number; key: string; code: boolean; marks: Mark[]; skip: boolean }> = [];
  let offset = 0;
  textblock.forEach(child => {
    const marks = child.marks.filter(mark => mark.type === type);
    const others = child.marks.filter(mark => mark.type !== type && mark.type.name !== 'knowraAnnotation');
    const key = others.map(markKey).join('|');
    const code = others.some(mark => mark.type.name === 'inlineCode');
    if (child.isText && child.text!.includes('\n')) {
      let start = 0;
      for (const part of child.text!.split('\n')) {
        if (part) children.push({ from: offset + start, to: offset + start + part.length, key, code, marks, skip: false });
        start += part.length + 1;
      }
    // 硬换行与行内 HTML 标签不进标记：前者会让 `<mark>` 跨行，后者会让 `<mark>` 与标签交叉。
    } else children.push({ from: offset, to: offset + child.nodeSize, key, code, marks, skip: child.type.name === 'hardbreak' || child.type.name === 'html' });
    offset += child.nodeSize;
  });
  // 行内代码不能只包一部分：同一段代码里任一处带标记，就整段带上。
  for (let index = 0; index < children.length; index += 1) {
    if (!children[index].code) continue;
    let end = index;
    while (end + 1 < children.length && children[end + 1].key === children[index].key && children[end + 1].from === children[end].to) end += 1;
    const group = children.slice(index, end + 1);
    const all = new Map(group.flatMap(item => item.marks).map(mark => [mark.attrs.id as string, mark]));
    for (const item of group) item.marks = [...all.values()];
    index = end;
  }
  const pieces: InlinePiece[] = [];
  const open = new Map<string, InlinePiece & { key: string }>();
  for (const child of children) {
    if (child.skip) { open.clear(); continue; }
    const ids = new Set<string>();
    for (const mark of child.marks) {
      const id = String(mark.attrs.id);
      ids.add(id);
      const current = open.get(id);
      if (current && current.to === child.from && current.key === child.key) { current.to = child.to; continue; }
      const piece = { id, data: mark.attrs.data as KnowraMarkAttrs, from: child.from, to: child.to, key: child.key };
      pieces.push(piece);
      open.set(id, piece);
    }
    for (const id of [...open.keys()]) if (!ids.has(id)) open.delete(id);
  }
  return pieces.map(({ id, data, from, to }) => ({ id, data, from, to }));
}

/** 代码块里每条标记覆盖的连续区间（代码文字偏移）。 */
function codeRanges(code: ProseNode, type: MarkType) {
  const ranges: Array<{ id: string; data: KnowraMarkAttrs; from: number; to: number }> = [];
  let offset = 0;
  code.forEach(child => {
    for (const mark of child.marks.filter(item => item.type === type)) {
      const id = String(mark.attrs.id);
      const last = [...ranges].reverse().find(range => range.id === id);
      if (last && last.to === offset) last.to = offset + child.nodeSize;
      else ranges.push({ id, data: mark.attrs.data as KnowraMarkAttrs, from: offset, to: offset + child.nodeSize });
    }
    offset += child.nodeSize;
  });
  return ranges;
}

function hasKnowraContent(doc: ProseNode, type: MarkType | undefined) {
  let found = false;
  doc.descendants(node => {
    if (found) return false;
    if ((node.attrs[KNOWRA_BLOCKS_ATTR] as KnowraBlockEntry[] | null)?.length || (type && node.marks.some(mark => mark.type === type))) found = true;
    return !found;
  });
  return found;
}

/** 在块的源码里找唯一一处相同文字作为兜底；不唯一或找不到时放弃。 */
function searchInBlock(markdown: string, block: { sourceStart: number; sourceEnd: number }, text: string) {
  if (!text) return null;
  const slice = markdown.slice(block.sourceStart, block.sourceEnd);
  const first = slice.indexOf(text);
  if (first < 0 || slice.indexOf(text, first + 1) >= 0) return null;
  return { from: block.sourceStart + first, to: block.sourceStart + first + text.length };
}

export function serializeWithKnowraMarks(doc: ProseNode, serializeClean: (doc: ProseNode) => string, onProblem?: (problem: KnowraMarkProblem) => void): string {
  const type = doc.type.schema.marks[KNOWRA_MARK];
  if (!hasKnowraContent(doc, type)) return serializeClean(doc);
  const cleanDoc = type ? new Transform(doc).removeMark(0, doc.content.size, type).doc : doc;
  const markdown = serializeClean(cleanDoc);
  const alignment = align(cleanDoc, markdown);
  const report = (id: string | undefined, reason: string) => onProblem?.({ stage: 'serialize', id, reason });
  if (!alignment) { report(undefined, 'alignFailed'); return markdown; }
  const inline: KnowraInlineInsertion[] = [];
  const blocks: KnowraBlockInsertion[] = [];
  const placeInline = (textblock: ProseNode, model: OffsetModel | null, block: { sourceStart: number; sourceEnd: number }) => {
    if (!type) return;
    for (const piece of inlinePieces(textblock, type)) {
      let from = model?.start[piece.from] ?? null;
      let to = model?.end[piece.to] ?? null;
      if (!Number.isInteger(from) || !Number.isInteger(to) || from! >= to!) {
        const found = searchInBlock(markdown, block, textblock.textBetween(piece.from, piece.to, '\n', '￼'));
        if (!found) { report(piece.id, 'inlineUnmapped'); continue; }
        ({ from, to } = found);
      }
      inline.push({ id: piece.id, from: from!, to: to!, attrs: piece.data });
    }
  };
  // 块级标记只能写在对齐块（标题、段落、列表项、表格整体等）上；表格单元格等内部块没有可写的位置。
  const entryPositions = new Set(alignment.entries.map(entry => entry.position));
  doc.descendants((node, position) => {
    if (!entryPositions.has(position)) for (const item of (node.attrs[KNOWRA_BLOCKS_ATTR] as KnowraBlockEntry[] | null) ?? []) report(item.id, 'blockUnsupported');
  });
  alignment.entries.forEach((entry, editorIndex) => {
    const markdownIndex = alignment.editorToMarkdown.get(editorIndex);
    if (markdownIndex === undefined) return;
    const block = alignment.blocks[markdownIndex];
    const model = alignment.models[markdownIndex] as BlockModel;
    const line = lineIndexOf(markdown, block.sourceStart);
    for (const item of (doc.nodeAt(entry.position)?.attrs[KNOWRA_BLOCKS_ATTR] as KnowraBlockEntry[] | null) ?? []) {
      // 空段落在 Markdown 里是 `<br />` 或空行，块级标记写上去重开后无法保持，也没有可标记的内容。
      if (entry.empty || block.br) { report(item.id, 'blockOnEmpty'); continue; }
      blocks.push({ id: item.id, line, attrs: item.attrs, exclude: item.exclude });
    }
    const original = doc.nodeAt(entry.position);
    if (!original) return;
    if (entry.node.type.name === 'code_block') {
      if (type) for (const range of codeRanges(original, type)) blocks.push({ id: range.id, line, attrs: range.data, code: { from: range.from, to: range.to } });
    } else if (entry.node.type.name === 'table') {
      original.forEach((row, _rowOffset, rowIndex) => row.forEach((_cell, _cellOffset, columnIndex) => {
        const target = tableCellTextblock(original, entry.position, rowIndex, columnIndex);
        const cell = cellModel(model, [rowIndex, columnIndex]);
        if (target) placeInline(target.node, cell, cell?.from !== undefined ? { sourceStart: cell.from, sourceEnd: cell.to! } : block);
      }));
    } else if (original.isTextblock) placeInline(original, cellModel(model), block);
  });
  return insertKnowraMarks(markdown, { inline, blocks, snap: true, onInvalid: (item, message) => report(item.id, message) });
}

// ───────────────────────────── 解析：带标记的 Markdown → 文档 ─────────────────────────────

/** 源码区间 → 块内偏移：起点取第一个不早于它的位置，终点取最后一个不晚于它的位置（越过定界符）。 */
function sourceRangeToOffsets(model: OffsetModel, from: number, to: number) {
  let start = -1;
  let end = -1;
  for (let offset = 0; offset <= model.size; offset += 1) {
    const value = model.start[offset];
    if (start < 0 && Number.isInteger(value) && value! >= from) start = offset;
    const close = model.end[offset];
    if (Number.isInteger(close) && close! <= to) end = offset;
  }
  return start >= 0 && end > start ? { start, end } : null;
}

const INLINE_TARGETS = new Set(['paragraph', 'heading', 'table']);

class Unplaceable extends Error {}

export function parseWithKnowraMarks(markdown: string, parseClean: (markdown: string) => ProseNode | string | null, onProblem?: (problem: KnowraMarkProblem) => void) {
  if (typeof markdown !== 'string' || (!markdown.includes('<mark') && !markdown.includes('<!--k'))) return parseClean(markdown);
  const parsed = parseKnowraMarks(markdown);
  // 语法不合法的标记保留为原文（Milkdown 当作 HTML），这里只报告。
  for (const problem of parsed.problems) onProblem?.({ stage: 'parse', id: problem.id, reason: problem.reason });
  if (!parsed.inline.length && !parsed.blocks.length) return parseClean(markdown);
  const { markdown: clean, toClean } = stripKnowraMarksMapped(markdown);
  const doc = parseClean(clean);
  if (!doc || typeof doc === 'string') return doc;
  try {
    return applyKnowraMarks(doc, clean, parsed, toClean, markdown);
  } catch (error) {
    // 有标记无法落位：整篇按原文解析，标记以 HTML 原文保留，保存时原样写回。
    onProblem?.({ stage: 'parse', reason: error instanceof Error ? error.message : String(error) });
    return parseClean(markdown);
  }
}

function applyKnowraMarks(doc: ProseNode, clean: string, parsed: ReturnType<typeof parseKnowraMarks>, toClean: (offset: number) => number, marked: string) {
  const type = doc.type.schema.marks[KNOWRA_MARK];
  const alignment = align(doc, clean);
  if (!alignment || !type) throw new Unplaceable('alignFailed');
  const tr = new Transform(doc);
  const editorOf = (markdownIndex: number) => {
    const editorIndex = alignment.markdownToEditor.get(markdownIndex);
    if (editorIndex === undefined) throw new Unplaceable('blockUnaligned');
    return alignment.entries[editorIndex];
  };

  for (const mark of parsed.inline) {
    const from = toClean(mark.contentStart);
    const to = toClean(mark.contentEnd);
    // 最内层的文本块（段落、标题、表格）。
    let markdownIndex = -1;
    alignment.blocks.forEach((block, index) => {
      if (INLINE_TARGETS.has(block.type) && block.sourceStart <= from && to <= block.sourceEnd) markdownIndex = index;
    });
    if (markdownIndex < 0) throw new Unplaceable(`inlineOutsideBlock:${mark.id}`);
    const entry = editorOf(markdownIndex);
    const model = alignment.models[markdownIndex] as BlockModel;
    let target: { model: OffsetModel | null; contentStart: number } | null = null;
    if (model && 'kind' in model) {
      model.rows.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => {
        if (!cell || cell.from === undefined || !(cell.from <= from && to <= cell.to!)) return;
        const textblock = tableCellTextblock(entry.node, entry.position, rowIndex, columnIndex);
        if (textblock) target = { model: cell, contentStart: textblock.contentStart };
      }));
    } else target = { model: model as OffsetModel | null, contentStart: entry.position + 1 };
    const resolved = target as { model: OffsetModel | null; contentStart: number } | null;
    const offsets = resolved?.model ? sourceRangeToOffsets(resolved.model, from, to) : null;
    if (!resolved || !offsets) throw new Unplaceable(`inlineUnmapped:${mark.id}`);
    tr.addMark(resolved.contentStart + offsets.start, resolved.contentStart + offsets.end, type.create({ id: mark.id, data: dataOf(mark.attrs) }));
  }

  const attached = new Map<number, KnowraBlockEntry[]>();
  for (const marker of parsed.blocks) {
    if (marker.targetLine === null) throw new Unplaceable(`markerWithoutTarget:${marker.id}`);
    const targetStart = marker.placement === 'lineBefore' ? lineStartAt(marked, marker.targetLine) : lineStartOf(marked, marker.start);
    const lineStart = lineStartOf(clean, toClean(targetStart));
    const lineEnd = clean.indexOf('\n', lineStart) < 0 ? clean.length : clean.indexOf('\n', lineStart);
    const candidates = alignment.blocks.map((block, index) => ({ block, index })).filter(({ block }) => block.sourceStart >= lineStart && block.sourceStart <= lineEnd);
    const wanted = marker.attrs.s === 'section' ? 'heading' : marker.attrs.s === 'list' ? 'listItem' : marker.attrs.s === 'code' ? 'code' : null;
    const chosen = wanted ? candidates.find(({ block }) => block.type === wanted) : candidates.sort((left, right) => left.block.depth - right.block.depth)[0];
    if (!chosen) throw new Unplaceable(`markerUnplaced:${marker.id}`);
    const entry = editorOf(chosen.index);
    if (marker.code?.resolved && entry.node.type.name === 'code_block') {
      tr.addMark(entry.position + 1 + marker.code.from, entry.position + 1 + marker.code.to, type.create({ id: marker.id, data: Object.fromEntries(Object.entries(marker.attrs).filter(([key]) => !['s', 'r', 'h'].includes(key))) }));
      continue;
    }
    // 未落位的代码范围等：作为块属性原样保留，保存时照写，等待用户处理。
    attached.set(entry.position, [...(attached.get(entry.position) ?? []), { id: marker.id, attrs: marker.attrs, ...(marker.exclude ? { exclude: true } : {}) }]);
  }
  for (const [position, entries] of attached) tr.setNodeAttribute(position, KNOWRA_BLOCKS_ATTR, entries);
  return tr.doc;
}

function lineStartAt(markdown: string, line: number) {
  let offset = 0;
  for (let index = 0; index < line; index += 1) {
    const next = markdown.indexOf('\n', offset);
    if (next < 0) return markdown.length;
    offset = next + 1;
  }
  return offset;
}

/** 在编辑器状态创建前接管解析器与序列化器；只在正文含 Knowra 标记时多做一次换算。 */
export function createKnowraMarksCodec(onProblem?: (problem: KnowraMarkProblem) => void) {
  return addTimer(async (ctx) => {
    await ctx.wait(ParserReady);
    ctx.update(parserCtx, parse => ((markdown: string) => parseWithKnowraMarks(markdown, parse, onProblem)) as typeof parse);
    await ctx.wait(SerializerReady);
    ctx.update(serializerCtx, serialize => (doc: ProseNode) => serializeWithKnowraMarks(doc, serialize, onProblem));
  }, editorStateTimerCtx, 'KnowraMarksCodec');
}

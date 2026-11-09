import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { mathFromMarkdown } from 'mdast-util-math';
import { cjkFriendlyExtension } from 'micromark-extension-cjk-friendly';
import { gfmStrikethroughCjkFriendly } from 'micromark-extension-cjk-friendly-gfm-strikethrough';
import { gfm } from 'micromark-extension-gfm';
import { math } from 'micromark-extension-math';

/**
 * 块内偏移模型（稳定身份迁移 S2b-2）：为身份块中的文本块推出与编辑器 ProseMirror 一致的内容偏移，
 * 并与 Markdown 源码偏移互相换算。编辑器侧偏移 = 位置 − 文本块内容起点：文本字符与行内叶子各占 1，
 * 行内公式节点内部是文本、首尾各占 1，mark 不占位置。无法可靠换算时返回 null，绝不猜测。
 */
const MARK_TYPES = new Set(['emphasis', 'strong', 'delete', 'link', 'linkReference', 'highlight', 'internalLink']);
const LEAF_TYPES = new Set(['image', 'imageReference', 'break', 'html']);
const INLINE_BLOCKS = new Set(['paragraph', 'heading']);
const BR_HTML = /^\s*<br\s*\/?>\s*$/i;
const FLOW_CONTAINERS = new Set(['root', 'blockquote', 'list', 'listItem', 'footnoteDefinition']);

/** 与编辑器 mathInlineGuardRemark 相同：内侧首尾为空白、或结束符后紧跟数字的单美元公式还原为文本。 */
function guardInlineMath(node, source) {
  if (!node.children) return;
  node.children = node.children.map(child => {
    if (child.type !== 'inlineMath' || !child.position) return child;
    const { offset: start } = child.position.start, { offset: end } = child.position.end;
    const raw = source.slice(start, end);
    if (raw.startsWith('$$')) return child;
    if (/^\s|\s$/.test(raw.slice(1, -1)) || /\d/.test(source[end] ?? '')) return { type: 'text', value: raw, position: child.position };
    return child;
  });
  node.children.forEach(child => guardInlineMath(child, source));
}

/** 与编辑器 highlightRemark、internalLinkRemark 相同的顺序与规则：定界符成为 mark，不占位置。 */
const DELIMITED = [/==([^=\n]+?)==/g, /\[\[([^\]\n]+?)\]\]/g];
function delimiterMask(value) {
  const keep = new Array(value.length).fill(true);
  let pieces = [[0, value.length]];
  for (const pattern of DELIMITED) {
    const next = [];
    for (const [from, to] of pieces) {
      let last = from;
      for (const match of value.slice(from, to).matchAll(pattern)) {
        const start = from + match.index, innerStart = start + match[0].indexOf(match[1]);
        const innerEnd = innerStart + match[1].length, end = start + match[0].length;
        for (let i = start; i < innerStart; i += 1) keep[i] = false;
        for (let i = innerEnd; i < end; i += 1) keep[i] = false;
        if (start > last) next.push([last, start]);
        next.push([innerStart, innerEnd]);
        last = end;
      }
      if (last < to) next.push([last, to]);
    }
    pieces = next;
  }
  return keep;
}

/** 把值中的字符逐一对齐到源码切片（跳过转义反斜杠等）；对不上时返回 null。 */
function alignValue(value, source, from, to, complete = false) {
  const starts = [], ends = [];
  let cursor = from;
  for (const char of value) {
    let found = source.indexOf(char, cursor);
    if (found < 0 || found >= to) return null;
    // 只允许跳过转义反斜杠、缩进与换行续行前缀，避免跨过真实内容错配。
    if (!/^[\\\s>]*$/.test(source.slice(cursor, found))) return null;
    for (let i = 0; i < char.length; i += 1) { starts.push(found + i); ends.push(found + i + 1); }
    cursor = found + char.length;
  }
  if (complete && !/^\s*$/.test(source.slice(cursor, to))) return null;
  return { starts, ends };
}

/** 生成行内内容的偏移表：start[k]／end[k] 为偏移 k 作为范围起点／终点时的源码位置。 */
function inlineModel(children, source) {
  const start = [], end = [];
  let size = 0;
  const push = (startSource, endSource) => {
    if (start[size] === undefined) start[size] = startSource;
    end[size + 1] = endSource;
    size += 1;
  };
  const visit = (nodes) => {
    for (const node of nodes) {
      if (!node.position) return false;
      const from = node.position.start.offset, to = node.position.end.offset;
      if (node.type === 'text' || node.type === 'inlineCode') {
        const inner = node.type === 'inlineCode' ? source.slice(from, to).match(/^`+/)[0].length : 0;
        const value = node.value ?? '';
        const offsets = alignValue(value, source, from + inner, to - inner, true);
        if (!offsets) return false;
        const keep = node.type === 'text' ? delimiterMask(value) : null;
        for (let i = 0; i < offsets.starts.length; i += 1) if (!keep || keep[i]) push(offsets.starts[i], offsets.ends[i]);
      } else if (node.type === 'inlineMath') {
        const delimiter = source.slice(from, to).match(/^\$+/)[0].length;
        const offsets = alignValue(node.value ?? '', source, from + delimiter, to - delimiter, true);
        if (!offsets) return false;
        push(from, from + delimiter);
        for (let i = 0; i < offsets.starts.length; i += 1) push(offsets.starts[i], offsets.ends[i]);
        push(to - delimiter, to);
      } else if (node.type === 'html' && BR_HTML.test(node.value ?? '')) {
        // Milkdown 的 remarkPreserveEmptyLine 删除所有 <br> 系列 HTML 节点，编辑器中不占位置。
      } else if (LEAF_TYPES.has(node.type)) {
        push(from, to);
      } else if (MARK_TYPES.has(node.type)) {
        if (!visit(node.children ?? [])) return false;
      } else return false;
    }
    return true;
  };
  if (!visit(children)) return null;
  start[size] ??= end[size] ?? null;
  end[0] ??= start[0] ?? null;
  return { size, start, end };
}

function codeModel(node, source) {
  const from = node.position.start.offset, to = node.position.end.offset;
  const value = node.value ?? '';
  const body = source.slice(from, to);
  const index = body.indexOf(value, body.indexOf('\n') + 1);
  // 列表或引用内的代码块，值去掉了每行缩进：从围栏下一行开始逐字对齐，只允许跳过缩进空白。
  const contentStart = from + body.indexOf('\n') + 1;
  const offsets = index >= 0 ? {
    starts: Array.from({ length: value.length }, (_, i) => from + index + i),
    ends: Array.from({ length: value.length }, (_, i) => from + index + i + 1)
  } : alignValue(value, source, contentStart, to);
  if (!offsets) return null;
  return { size: value.length, start: [...offsets.starts, offsets.ends.at(-1) ?? contentStart],
    end: [offsets.starts[0] ?? contentStart, ...offsets.ends] };
}

function blockModel(node, source) {
  if (INLINE_BLOCKS.has(node.type)) return inlineModel(node.children ?? [], source);
  if (node.type === 'code') return codeModel(node, source);
  // 块级 HTML 在编辑器里是段落：<br /> 为空段落，其余为只含一个 html 原子的段落。
  if (node.type === 'html') {
    const from = node.position.start.offset, to = node.position.end.offset;
    return BR_HTML.test(node.value ?? '') ? { size: 0, start: [from], end: [from] } : { size: 1, start: [from, to], end: [from, to] };
  }
  if (node.type === 'table') {
    const rows = (node.children ?? []).map(row => (row.children ?? []).map(cell => {
      const model = inlineModel(cell.children ?? [], source);
      return model && cell.position ? { ...model, from: cell.position.start.offset, to: cell.position.end.offset } : null;
    }));
    return { kind: 'table', rows };
  }
  return null;
}

const BLOCKS = new Set(['paragraph', 'heading', 'blockquote', 'code', 'thematicBreak', 'listItem', 'table', 'math', 'html']);

/** 与 parseIdentityBlocks 同序的块偏移模型；非文本块为 null。 */
export function identityBlockModels(markdown) {
  const source = String(markdown ?? '');
  const tree = fromMarkdown(source, {
    extensions: [gfm(), cjkFriendlyExtension(), gfmStrikethroughCjkFriendly(), math({ singleDollarTextMath: true })],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()]
  });
  guardInlineMath(tree, source);
  const models = [];
  const walk = (node) => {
    if (BLOCKS.has(node.type) && node.position) models.push(blockModel(node, source));
    if (!FLOW_CONTAINERS.has(node.type)) return;
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return models;
}

function cellModel(model, cell) {
  if (!model) return null;
  if (model.kind === 'table') return Array.isArray(cell) ? model.rows[cell[0]]?.[cell[1]] ?? null : null;
  return cell === undefined ? model : null;
}

/** 块内偏移 → 源码偏移。edge 为 'start' 或 'end'，决定定界符两侧取哪一边。 */
export function blockOffsetToSource(model, point, edge) {
  const target = cellModel(model, point.cell);
  if (!target || !Number.isInteger(point.offset) || point.offset < 0 || point.offset > target.size) return null;
  const value = (edge === 'start' ? target.start : target.end)[point.offset];
  return Number.isInteger(value) ? value : null;
}

/** 源码偏移 → 块内偏移；只接受模型中精确存在的边界。 */
export function sourceToBlockOffset(model, sourceOffset, edge, cell) {
  const target = cellModel(model, cell);
  if (!target) return null;
  const map = edge === 'start' ? target.start : target.end;
  for (let offset = 0; offset <= target.size; offset += 1) if (map[offset] === sourceOffset) return offset;
  return null;
}

/** 定位源码偏移所在的表格单元格 [行, 列]；不在任何单元格内时返回 null。 */
export function tableCellAt(model, sourceOffset) {
  if (model?.kind !== 'table') return null;
  for (let row = 0; row < model.rows.length; row += 1) {
    for (let column = 0; column < model.rows[row].length; column += 1) {
      const cell = model.rows[row][column];
      if (cell && cell.from <= sourceOffset && sourceOffset <= cell.to) return [row, column];
    }
  }
  return null;
}

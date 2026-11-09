import { fromMarkdown } from 'mdast-util-from-markdown';
import { cjkFriendlyEmphasisExtension } from './markdown-cjk.js';
import { gfmStrikethroughCjkFriendly } from 'micromark-extension-cjk-friendly-gfm-strikethrough';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown } from 'mdast-util-math';

// Knowra 正文内联标记：重点、挖空等以标记形式写在 Markdown 正文里（见《重点标记内联化方案》第 2 节）。
// 行内 `<mark data-k="id" ...>文字</mark>`，块级 `<!--k id s=section ...-->`，标题局部排除 `<!--k- id-->`。
// 与编辑器一致的 CommonMark/GFM/公式语法树提供字面边界，其余标记按源码偏移扫描；未知属性与角色原样保留。

export const KNOWRA_MARKS_FORMAT = 1;

const ID = /^[A-Za-z0-9_-]{1,32}$/;
const ATTR_KEY = /^[a-z][a-z0-9-]*$/;
const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const ATX_HEADING = /^\s{0,3}#{1,6}(\s|$)/;
const THEMATIC_BREAK = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const DELIMITERS = new Set(['*', '_', '~', '=']);
const ASCII_PUNCTUATION = /^[!-/:-@[-`{-~]$/;
const VOID_ELEMENTS = new Set(['br', 'img', 'hr', 'input', 'wbr', 'col', 'embed', 'source', 'track', 'area', 'base', 'link', 'meta', 'param']);

/** 覆盖文字的短校验值（FNV-1a 32 位，36 进制），用于发现编辑器外对代码块的改写。 */
export function knowraCheck(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

const encodeHtml = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const decodeHtml = value => value.replace(/&(quot|lt|gt|#39|amp);/g, (_, name) => ({ quot: '"', lt: '<', gt: '>', '#39': "'", amp: '&' })[name]);
const rolesOf = attrs => (attrs.t ?? '').split(/\s+/).filter(Boolean);

function lineTable(markdown) {
  const lines = [];
  for (let start = 0; ;) {
    const newline = markdown.indexOf('\n', start);
    const end = newline < 0 ? markdown.length : newline;
    lines.push({ start, end, next: newline < 0 ? end : newline + 1, kind: 'text' });
    if (newline < 0) return lines;
    start = newline + 1;
  }
}

/** 由 CommonMark/GFM 判定字面代码边界，包含缩进、引用/列表容器和跨行 code span。 */
function classifyLines(markdown, lines) {
  const fences = new Map();
  const codeSpans = [];
  const tree = fromMarkdown(markdown, { extensions: [gfm(), cjkFriendlyEmphasisExtension(), gfmStrikethroughCjkFriendly(), math({ singleDollarTextMath: true })], mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()] });
  function visit(node) {
    if (node.type === 'math') {
      for (let index = node.position.start.line - 1; index < node.position.end.line; index += 1) lines[index].kind = 'math';
      return;
    }
    if (node.type === 'inlineCode') codeSpans.push([node.position.start.offset, node.position.end.offset]);
    if (node.type === 'inlineMath') {
      const from = node.position.start.offset;
      const to = node.position.end.offset;
      const raw = markdown.slice(from, to);
      // 与 editorMathMarkdown 的 single-dollar guard 一致：金额、边缘空白等退回普通正文。
      if (raw.startsWith('$$') || (!/^\s|\s$/.test(raw.slice(1, -1)) && !/\d/.test(markdown[to] ?? ''))) codeSpans.push([from, to]);
    }
    if (node.type === 'code') {
      const first = node.position.start.line - 1;
      const last = node.position.end.line - 1;
      for (let index = first; index <= last; index += 1) lines[index].kind = 'code';
      const source = markdown.slice(node.position.start.offset, lines[first].end);
      const open = FENCE_OPEN.exec(source);
      if (open) {
        lines[first].kind = 'fenceOpen';
        // 逻辑代码由语法树去掉容器前缀和缩进，供 r/h 校验使用。
        fences.set(first, { text: node.value });
      }
      return;
    }
    for (const child of node.children ?? []) visit(child);
  }
  visit(tree);
  return { fences, codeSpans };
}

/** 代码块的逻辑内容，与编辑器看到的代码文字一致。 */
function codeText(_markdown, fence) { return fence.text; }

function parseOpenTag(tag) {
  const attrs = {};
  for (const match of tag.matchAll(/\s([A-Za-z][\w-]*)\s*=\s*"([^"]*)"/g)) {
    if (match[1].toLowerCase().startsWith('data-')) attrs[match[1].slice(5).toLowerCase()] = decodeHtml(match[2]);
  }
  return attrs;
}

function parseComment(body) {
  const match = /^k(-?)\s+(\S+)((?:\s+\S+)*)\s*$/.exec(body);
  if (!match) return null;
  const marker = { id: match[2], exclude: match[1] === '-', attrs: {}, valid: ID.test(match[2]) };
  for (const token of match[3].trim().split(/\s+/).filter(Boolean)) {
    const separator = token.indexOf('=');
    const key = token.slice(0, separator);
    if (separator < 1 || !ATTR_KEY.test(key) || marker.exclude) { marker.valid = false; continue; }
    try { marker.attrs[key] = decodeURIComponent(token.slice(separator + 1)); } catch { marker.valid = false; }
  }
  // 块级标记至少带一个属性，避免把用户自己写的 `<!--k 备注-->` 误认成标记。
  if (!marker.exclude && !match[3].trim()) return null;
  return marker;
}

function backtickRun(markdown, index, end) {
  let length = 0;
  while (index + length < end && markdown[index + length] === '`') length += 1;
  return length;
}

/** 行尾"后缀"：结尾空白、硬换行反斜杠、ATX 标题的闭合 #。块级标记写在后缀之前。 */
function lineSuffixStart(text) {
  const heading = ATX_HEADING.test(text) ? /\s+#+\s*$/.exec(text) : null;
  if (heading && heading.index > text.search(/#/) + 1) return heading.index;
  const tail = /\\?[ \t\r]*$/.exec(text);
  return tail.index;
}

/**
 * 扫描一行正文：行内代码、普通注释、转义、实体和 HTML 标签是受保护区间（插入时边界不能落在其中）；
 * 同时收集 `<mark>` 开闭标签与 Knowra 注释。`<mark>` 必须在同一行内闭合。
 */
function scanTextLine(markdown, line, state, sink, codeSpans) {
  const stack = [];
  let index = line.start;
  while (index < line.end) {
    if (state.comment) {
      const close = markdown.indexOf('-->', index);
      if (close < 0 || close >= line.end) { sink.protect(index, line.end); return finish(); }
      sink.protect(index, close + 3);
      state.comment = false;
      index = close + 3;
      continue;
    }
    while (codeSpans[state.codeIndex]?.[1] <= index) state.codeIndex += 1;
    const code = codeSpans[state.codeIndex];
    if (code && code[0] <= index) {
      const end = Math.min(code[1], line.end);
      sink.protect(code[0], code[1], 'code');
      index = end;
      continue;
    }
    const char = markdown[index];
    // CommonMark 只把反斜杠加 ASCII 标点当作转义，`\\eta` 里的反斜杠是普通字符。
    if (char === '\\' && index + 1 < line.end && ASCII_PUNCTUATION.test(markdown[index + 1])) { sink.protect(index, index + 2, 'escape'); index += 2; continue; }
    if (char === '`') {
      const length = backtickRun(markdown, index, line.end);
      let close = index + length;
      while (close < line.end) {
        const next = markdown.indexOf('`', close);
        if (next < 0 || next >= line.end) { close = -1; break; }
        const run = backtickRun(markdown, next, line.end);
        if (run === length) { close = next; break; }
        close = next + run;
      }
      if (close >= 0 && close < line.end) { sink.protect(index, close + length, 'code'); index = close + length; } else index += length;
      continue;
    }
    if (markdown.startsWith('<!--', index)) {
      const close = markdown.indexOf('-->', index + 4);
      if (close < 0 || close >= line.end) { state.comment = true; sink.protect(index, line.end); return finish(); }
      const marker = parseComment(markdown.slice(index + 4, close));
      if (marker) sink.marker({ ...marker, start: index, end: close + 3 });
      sink.protect(index, close + 3);
      index = close + 3;
      continue;
    }
    if (markdown.startsWith('<mark', index) && /[\s>]/.test(markdown[index + 5] ?? '')) {
      const close = markdown.indexOf('>', index);
      if (close < 0 || close >= line.end) { index += 5; continue; }
      const attrs = parseOpenTag(markdown.slice(index, close + 1));
      stack.push({ name: 'mark', ours: ID.test(attrs.k ?? ''), attrs, start: index, openEnd: close + 1 });
      sink.protect(index, close + 1);
      index = close + 1;
      continue;
    }
    if (char === '<') {
      const tag = /^<(\/?)([A-Za-z][\w-]*)\b[^<>\n]*?(\/?)>/.exec(markdown.slice(index, line.end));
      if (tag) {
        const end = index + tag[0].length;
        const name = tag[2].toLowerCase();
        if (tag[1]) {
          const at = stack.findLastIndex(item => item.name === name);
          if (at >= 0) {
            const [open] = stack.splice(at, stack.length - at);
            if (open.ours) sink.inline({ id: open.attrs.k, attrs: open.attrs, start: open.start, contentStart: open.openEnd, contentEnd: index, end });
            else sink.element(open.start, end);
          }
        } else if (!tag[3] && !VOID_ELEMENTS.has(name)) stack.push({ name, ours: false, start: index, openEnd: end });
        sink.protect(index, end);
        index = end;
        continue;
      }
    }
    if (char === '&') {
      const entity = /^&(?:#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/i.exec(markdown.slice(index, line.end));
      if (entity) { sink.protect(index, index + entity[0].length, 'entity'); index += entity[0].length; continue; }
    }
    if (DELIMITERS.has(char)) {
      let end = index + 1;
      while (end < line.end && markdown[end] === char) end += 1;
      if (end - index > 1) sink.protect(index, end);
      index = end;
      continue;
    }
    index += 1;
  }
  return finish();
  function finish() {
    for (const open of stack) if (open.ours) sink.problem({ reason: 'unclosedMark', id: open.attrs.k, start: open.start, end: open.openEnd });
  }
}

function scan(markdown) {
  const lines = lineTable(markdown);
  const { fences, codeSpans } = classifyLines(markdown, lines);
  const state = { comment: false, codeIndex: 0 };
  const inline = [];
  const markers = [];
  const problems = [];
  const protectedSpans = new Map();
  lines.forEach((line, index) => {
    if (line.kind !== 'text') { state.comment = false; return; }
    const spans = [];
    const elements = [];
    scanTextLine(markdown, line, state, {
      protect: (start, end, kind = 'syntax') => spans.push([start, end, kind]),
      element: (start, end) => elements.push([start, end]),
      inline: mark => inline.push({ ...mark, line: index, roles: rolesOf(mark.attrs) }),
      marker: marker => markers.push({ ...marker, line: index }),
      problem: problem => problems.push(problem)
    }, codeSpans);
    protectedSpans.set(index, { spans, elements });
  });
  inline.sort((left, right) => left.start - right.start);
  return { lines, fences, inline, markers, problems, protectedSpans };
}

/** 把同一行内首尾相接的有效块级注释归成一段，判断它是单独成行还是在行尾。 */
function markerRuns(markdown, lines, markers) {
  const runs = [];
  for (const marker of markers.filter(item => item.valid)) {
    const last = runs.at(-1);
    if (last && last.line === marker.line && last.end === marker.start) { last.markers.push(marker); last.end = marker.end; continue; }
    runs.push({ line: marker.line, start: marker.start, end: marker.end, markers: [marker] });
  }
  for (const run of runs) {
    const line = lines[run.line];
    const before = markdown.slice(line.start, run.start);
    const after = markdown.slice(run.end, line.end);
    if (!before.trim() && !after.trim()) run.placement = 'lineBefore';
    else if (/^(?:\s+#+\s*|\\?[ \t\r]*)$/.test(after)) run.placement = 'lineEnd';
    else run.placement = 'inline';
  }
  return runs;
}

/**
 * 解析正文中的 Knowra 标记。偏移均为 Markdown 源码偏移；`line` 为从 0 开始的行号。
 * 语法不合法的标记计入 problems，并且不出现在结果里（strip 也会把它们当普通文字保留）。
 */
export function parseKnowraMarks(markdown) {
  const text = typeof markdown === 'string' ? markdown : '';
  const { lines, fences, inline, markers, problems } = scan(text);
  for (const marker of markers.filter(item => !item.valid)) problems.push({ reason: 'invalidMarker', id: marker.id, start: marker.start, end: marker.end });
  const blocks = [];
  const runs = markerRuns(text, lines, markers);
  const standalone = new Set(runs.filter(item => item.placement === 'lineBefore').map(item => item.line));
  for (const run of runs) {
    let targetLine = run.line;
    if (run.placement === 'lineBefore') {
      targetLine = run.line + 1;
      while (standalone.has(targetLine)) targetLine += 1;
      if (targetLine >= lines.length) targetLine = null;
    }
    for (const marker of run.markers) {
      const block = { id: marker.id, attrs: marker.attrs, roles: rolesOf(marker.attrs), exclude: marker.exclude, start: marker.start, end: marker.end, line: run.line, placement: run.placement, targetLine };
      if (marker.attrs.s === 'code') {
        const fence = run.placement === 'lineBefore' ? fences.get(targetLine) : null;
        const range = /^(\d+)-(\d+)$/.exec(marker.attrs.r ?? '');
        const code = fence ? codeText(text, fence) : null;
        const from = range ? Number(range[1]) : NaN;
        const to = range ? Number(range[2]) : NaN;
        let reason = null;
        if (!fence) reason = 'codeTargetMissing';
        else if (!(from >= 0 && from < to && to <= code.length)) reason = 'codeRangeInvalid';
        else if (knowraCheck(code.slice(from, to)) !== marker.attrs.h) reason = 'codeCheckMismatch';
        block.code = { from, to, text: reason ? null : code.slice(from, to), resolved: !reason };
        if (reason) problems.push({ reason, id: marker.id, start: marker.start, end: marker.end });
      }
      blocks.push(block);
    }
  }
  problems.sort((left, right) => left.start - right.start);
  return { format: KNOWRA_MARKS_FORMAT, inline, blocks, problems };
}

function removalsOf(text) {
  const { lines, inline, markers } = scan(text);
  const removals = [];
  for (const mark of inline) removals.push([mark.start, mark.contentStart], [mark.contentEnd, mark.end]);
  for (const run of markerRuns(text, lines, markers)) {
    const line = lines[run.line];
    if (run.placement === 'lineBefore') removals.push(line.next > line.end ? [line.start, line.next] : [Math.max(0, line.start - 1), line.end]);
    else removals.push([text[run.start - 1] === ' ' && run.start > line.start ? run.start - 1 : run.start, run.end]);
  }
  removals.sort((left, right) => left[0] - right[0]);
  const merged = [];
  for (const [start, end] of removals) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** 全部有效标记本身占用的源码区间（已排序、合并）：标签、行尾注释连同前导空格、单独成行的注释整行。 */
export function knowraMarkSpans(markdown) {
  return removalsOf(typeof markdown === 'string' ? markdown : '').map(([start, end]) => ({ start, end }));
}

/** 去掉全部有效的 Knowra 标记，其余文字逐字不变。不合法的标记当作普通文字保留。 */
export function stripKnowraMarks(markdown) {
  return stripKnowraMarksMapped(markdown).markdown;
}

/** 同 stripKnowraMarks，另返回把原文偏移换算到去除后偏移的函数；落在被删除标记内部的偏移归到该标记的起点。 */
export function stripKnowraMarksMapped(markdown) {
  const text = typeof markdown === 'string' ? markdown : '';
  const removals = removalsOf(text);
  let output = '';
  let cursor = 0;
  for (const [start, end] of removals) {
    output += text.slice(cursor, start);
    cursor = end;
  }
  output += text.slice(cursor);
  const toClean = offset => {
    let removed = 0;
    for (const [start, end] of removals) {
      if (offset <= start) break;
      if (offset < end) return start - removed;
      removed += end - start;
    }
    return offset - removed;
  };
  return { markdown: output, toClean };
}

const mayContainMarks = text => text.includes('<mark') || text.includes('<!--k');

/** 两份正文去掉 Knowra 标记后是否相同：只增删、修改标记的保存不算正文改动。 */
export function sameKnowraText(left, right) {
  if (left === right) return true;
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  if (!mayContainMarks(left) && !mayContainMarks(right)) return false;
  return stripKnowraMarks(left) === stripKnowraMarks(right);
}

export function formatKnowraMarkOpen(id, attrs = {}) {
  if (!ID.test(id)) throw new Error(`Invalid Knowra mark id: ${id}`);
  const parts = [`data-k="${id}"`];
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'k' || value === undefined || value === null || value === '') continue;
    if (!ATTR_KEY.test(key)) throw new Error(`Invalid Knowra mark attribute: ${key}`);
    parts.push(`data-${key}="${encodeHtml(String(value))}"`);
  }
  return `<mark ${parts.join(' ')}>`;
}

export function formatKnowraMarker(id, attrs = {}, { exclude = false } = {}) {
  if (!ID.test(id)) throw new Error(`Invalid Knowra mark id: ${id}`);
  if (exclude) return `<!--k- ${id}-->`;
  const tokens = [];
  if (!Object.values(attrs).some(value => value !== undefined && value !== null && value !== '')) throw new Error(`Knowra marker ${id} needs at least one attribute`);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === '') continue;
    if (!ATTR_KEY.test(key)) throw new Error(`Invalid Knowra marker attribute: ${key}`);
    tokens.push(`${key}=${encodeURIComponent(String(value))}`);
  }
  return `<!--k ${id}${tokens.map(token => ` ${token}`).join('')}-->`;
}

const insideSpan = (spans, offset) => spans.some(([start, end]) => offset > start && offset < end);
const SNAPPABLE = new Set(['escape', 'code', 'entity']);
/** 边界落在转义、行内代码或实体中间时向外移到其边缘（起点向前、终点向后）。 */
function snapOutward(spans, offset, edge) {
  const span = spans.find(([start, end, kind]) => SNAPPABLE.has(kind) && offset > start && offset < end);
  return span ? (edge === 'start' ? span[0] : span[1]) : offset;
}

/**
 * 在不含 Knowra 标记的正文中插入标记，供迁移和测试使用；结果满足 `stripKnowraMarks(结果) === 原文`。
 * - inline：`{ id, from, to, attrs }`，范围限在一行正文内，边界不能落在行内代码、标签、转义、实体或成串的强调符号中间；
 *   重叠范围自动切段并嵌套。是否与强调、链接等 Markdown 结构正确嵌套由调用方按语法树保证。
 * - blocks：`{ id, line, attrs, exclude, code: { from, to } }`。代码块、公式块、表格、HTML 块和分隔线写在前一行，其余写在行尾；
 *   `code` 只用于围栏代码块开头行，自动写入 `s=code`、`r` 和 `h`。
 */
export function insertKnowraMarks(markdown, { inline = [], blocks = [], snap = false, onInvalid = null } = {}) {
  const { lines, fences, protectedSpans, inline: existing, markers } = scan(markdown);
  if (existing.length || markers.some(marker => marker.valid)) throw new Error('Markdown already contains Knowra marks');
  const lineOf = offset => lines.findIndex(line => offset >= line.start && offset <= line.end);
  const operations = [];
  let sequence = 0;
  const add = (position, priority, text) => operations.push({ position, priority, sequence: sequence += 1, text });

  // onInvalid 存在时，不合法的单条标记跳过并报告，其余照常插入。
  const guarded = (item, run) => {
    if (!onInvalid) return run();
    try { return run(); } catch (error) { onInvalid(item, error instanceof Error ? error.message : String(error)); return undefined; }
  };
  const byLine = new Map();
  inline.forEach((item, order) => guarded(item, () => {
    const { id } = item;
    let { from, to } = item;
    if (!ID.test(id)) throw new Error(`Invalid Knowra mark id: ${id}`);
    if (!(Number.isInteger(from) && Number.isInteger(to) && from >= 0 && from < to && to <= markdown.length)) throw new Error(`Invalid range for ${id}`);
    const index = lineOf(from);
    const line = lines[index];
    if (line.kind !== 'text' || to > line.end) throw new Error(`Inline mark ${id} must stay within one text line`);
    const { spans = [], elements = [] } = protectedSpans.get(index) ?? {};
    if (snap) { from = snapOutward(spans, from, 'start'); to = snapOutward(spans, to, 'end'); }
    if (from < line.start || to > line.end) throw new Error(`Inline mark ${id} must stay within one text line`);
    // 紧跟在普通反斜杠后面的 `<` 会被当成转义，标签失效：起点前移包住反斜杠，终点前收排除它。
    const literalBackslashBefore = offset => markdown[offset - 1] === '\\' && !spans.some(([start, end, kind]) => kind === 'escape' && (end === offset || start === offset - 1));
    if (snap) {
      while (literalBackslashBefore(from)) from -= 1;
      while (to > from + 1 && literalBackslashBefore(to)) to -= 1;
      // 只标了一个反斜杠：前收会变空，改为往后多包一个字符。
      if (literalBackslashBefore(to) && to < line.end) to += 1;
    }
    if (literalBackslashBefore(from) || literalBackslashBefore(to)) throw new Error(`Inline mark ${id} would follow a literal backslash`);
    if (insideSpan(spans, from) || insideSpan(spans, to)) throw new Error(`Inline mark ${id} splits protected Markdown syntax`);
    if (elements.some(([start, end]) => (from > start && from < end) !== (to > start && to < end))) throw new Error(`Inline mark ${id} crosses an HTML element`);
    if (!byLine.has(index)) byLine.set(index, []);
    byLine.get(index).push({ ...item, from, to, order });
  }));
  for (const items of byLine.values()) {
    const boundaries = [...new Set(items.flatMap(item => [item.from, item.to]))].sort((left, right) => left - right);
    let stack = [];
    for (let step = 0; step < boundaries.length; step += 1) {
      const position = boundaries[step];
      const next = boundaries[step + 1];
      const wanted = next === undefined ? [] : items
        .filter(item => item.from <= position && item.to >= next)
        .sort((left, right) => left.from - right.from || right.to - left.to || left.order - right.order);
      let common = 0;
      while (common < stack.length && common < wanted.length && stack[common] === wanted[common]) common += 1;
      for (let index = stack.length - 1; index >= common; index -= 1) add(position, 1, '</mark>');
      for (const item of wanted.slice(common)) add(position, 2, formatKnowraMarkOpen(item.id, item.attrs));
      stack = wanted;
    }
  }

  const lineEnd = new Map();
  for (const item of blocks) guarded(item, () => {
    const line = lines[item.line];
    if (!line || line.kind === 'code' || line.kind === 'fenceClose') throw new Error(`Invalid block line for ${item.id}`);
    const text = markdown.slice(line.start, line.end);
    if (!text.trim()) throw new Error(`Block marker ${item.id} cannot target an empty line`);
    let attrs = item.attrs ?? {};
    if (item.code) {
      const fence = fences.get(item.line);
      if (!fence) throw new Error(`Code marker ${item.id} must target a fenced code block`);
      const code = codeText(markdown, fence);
      const { from, to } = item.code;
      if (!(Number.isInteger(from) && Number.isInteger(to) && from >= 0 && from < to && to <= code.length)) throw new Error(`Invalid code range for ${item.id}`);
      attrs = { ...attrs, s: 'code', r: `${from}-${to}`, h: knowraCheck(code.slice(from, to)) };
    }
    const marker = formatKnowraMarker(item.id, attrs, { exclude: item.exclude });
    const before = line.kind !== 'text' || /^\s*[|<]/.test(text) || THEMATIC_BREAK.test(text);
    const position = before ? line.start : line.start + lineSuffixStart(text);
    if (insideSpan(protectedSpans.get(item.line)?.spans ?? [], position)) throw new Error(`Block marker ${item.id} splits protected Markdown syntax`);
    if (before) { add(line.start, 0, `${text.match(/^\s*/)[0]}${marker}\n`); return; }
    if (!lineEnd.has(item.line)) lineEnd.set(item.line, []);
    lineEnd.get(item.line).push(marker);
  });
  for (const [index, list] of lineEnd) {
    const line = lines[index];
    add(line.start + lineSuffixStart(markdown.slice(line.start, line.end)), 3, ` ${list.join('')}`);
  }

  operations.sort((left, right) => left.position - right.position || left.priority - right.priority || left.sequence - right.sequence);
  let output = '';
  let cursor = 0;
  for (const operation of operations) {
    output += markdown.slice(cursor, operation.position) + operation.text;
    cursor = operation.position;
  }
  return output + markdown.slice(cursor);
}

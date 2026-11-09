import { fromMarkdown } from 'mdast-util-from-markdown';
import { cjkFriendlyExtension } from 'micromark-extension-cjk-friendly';
import { gfmStrikethroughCjkFriendly } from 'micromark-extension-cjk-friendly-gfm-strikethrough';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown } from 'mdast-util-math';
import { collectListItems } from './list-projection.js';
import { calculateContentHash } from './hash.js';

export const MARKDOWN_PROJECTION_VERSION = 1;

const BLOCK_TYPES = new Set([
  'heading',
  'paragraph',
  'code',
  'blockquote',
  'listItem',
  'table',
  'thematicBreak',
  'html'
]);
const LEAF_BLOCK_TYPES = new Set(['heading', 'paragraph', 'code', 'tableCell']);

export function projectMarkdown(markdown, { includeMath = false } = {}) {
  const source = String(markdown ?? '');
  const tree = fromMarkdown(source, {
    extensions: [gfm(), cjkFriendlyExtension(), gfmStrikethroughCjkFriendly(), ...(includeMath ? [math({ singleDollarTextMath: true })] : [])],
    mdastExtensions: [gfmFromMarkdown(), ...(includeMath ? [mathFromMarkdown()] : [])]
  });
  if (includeMath) guardInlineMath(tree, source);
  const units = [];
  const blocks = [];
  const headings = [];
  const leafBlocks = [];

  walk(tree, [], (node, path) => {
    if ((BLOCK_TYPES.has(node.type) || (includeMath && node.type === 'math')) && hasOffsets(node)) {
      blocks.push(buildBlock(node, path));
    }
    if (node.type === 'heading' && hasOffsets(node)) {
      headings.push({
        ...buildBlock(node, path),
        level: Number(node.depth),
        title: visibleText(node, source, includeMath)
      });
    }
    if ((LEAF_BLOCK_TYPES.has(node.type) || (includeMath && node.type === 'math')) && hasOffsets(node)) {
      leafBlocks.push({ node, path });
    }
  });

  leafBlocks.sort((left, right) => offset(left.node) - offset(right.node));
  leafBlocks.forEach(({ node, path }, index) => {
    if (index > 0) units.push(separatorUnit('\n'));
    appendLeafUnits(units, node, path, source, includeMath);
  });

  let projectedOffset = 0;
  for (const unit of units) {
    unit.projectedStart = projectedOffset;
    projectedOffset += unit.text.length;
    unit.projectedEnd = projectedOffset;
  }
  const text = units.map(unit => unit.text).join('');
  const sections = headings.map((heading, index) => {
    const next = headings.slice(index + 1).find(candidate => candidate.level <= heading.level);
    return {
      ...heading,
      sourceEnd: next?.sourceStart ?? source.length,
      endBoundaryPath: next?.path ?? null,
      endBoundaryLevel: next?.level ?? null,
      endBoundaryTitle: next?.title ?? null,
      memberFingerprint: fingerprintBlocks(
        blocks.filter(
          block => block.sourceStart >= heading.sourceStart && block.sourceStart < (next?.sourceStart ?? source.length)
        )
      )
    };
  });

  return {
    version: MARKDOWN_PROJECTION_VERSION,
    source,
    contentHash: calculateContentHash(source),
    text,
    units,
    blocks: blocks.sort((left, right) => left.sourceStart - right.sourceStart),
    headings,
    sections,
    listItems: collectListItems(tree)
  };
}

/** 与编辑器一致：单美元边缘空白或紧接数字时保留原文，不当作公式。 */
function guardInlineMath(node, source) {
  if (!node.children) return;
  node.children = node.children.map(child => {
    if (child.type !== 'inlineMath' || !child.position) return child;
    const raw = sliceForNode(child, source);
    if (raw.startsWith('$$')) return child;
    if (/^\s|\s$/.test(raw.slice(1, -1)) || /\d/.test(source[endOffset(child)] ?? '')) {
      return { type: 'text', value: raw, position: child.position };
    }
    return child;
  });
  for (const child of node.children) guardInlineMath(child, source);
}

export function anchorFromProjectedRange(projection, projectedStart, projectedEnd, options = {}) {
  assertProjection(projection);
  if (
    !Number.isInteger(projectedStart) ||
    !Number.isInteger(projectedEnd) ||
    projectedStart < 0 ||
    projectedStart >= projectedEnd ||
    projectedEnd > projection.text.length
  ) {
    throw rangeError('Projected range is invalid');
  }
  const selected = projection.units.filter(
    unit => unit.projectedEnd > projectedStart && unit.projectedStart < projectedEnd
  );
  const sourceUnits = selected.filter(unit => unit.sourceStart !== null);
  if (sourceUnits.length === 0) throw rangeError('Projected range has no source content');
  const segments = [];
  for (const unit of sourceUnits) {
    const clipped = clipUnit(unit, projectedStart, projectedEnd);
    const previous = segments.at(-1);
    if (previous && previous.end === clipped.start && previous.path === clipped.path) {
      previous.end = clipped.end;
    } else {
      segments.push(clipped);
    }
  }
  if (options.scopeType === 'section') {
    const index = projection.sections.findIndex(
      section =>
        section.sourceStart <= segments[0].start &&
        projection.headings.find(h => h.path === section.path)?.sourceEnd >= segments[0].start
    );
    if (index < 0) throw rangeError('Selected heading does not exist');
    return anchorForSection(projection, index);
  }
  return buildAnchor(projection, segments, {
    projectedStart,
    projectedEnd,
    scopeType: options.scopeType ?? 'selection',
    structurePath: options.structurePath ?? sourceUnits[0].path
  });
}

export function anchorForSourceRange(projection, sourceStart, sourceEnd, options = {}) {
  assertProjection(projection);
  if (
    !Number.isInteger(sourceStart) ||
    !Number.isInteger(sourceEnd) ||
    sourceStart < 0 ||
    sourceStart >= sourceEnd ||
    sourceEnd > projection.source.length
  ) {
    throw rangeError('Source range is invalid');
  }
  const segments = projection.units
    .filter(unit => unit.sourceStart !== null && unit.sourceEnd > sourceStart && unit.sourceStart < sourceEnd)
    .map(unit => ({
      start: Math.max(unit.sourceStart, sourceStart),
      end: Math.min(unit.sourceEnd, sourceEnd),
      path: unit.path
    }));
  if (segments.length === 0) throw rangeError('Source range has no projected content');
  return buildAnchor(projection, mergeSegments(segments), {
    scopeType: options.scopeType ?? 'selection',
    structurePath: options.structurePath ?? segments[0].path
  });
}

export function anchorForBlock(projection, blockIndex) {
  const block = projection.blocks[blockIndex];
  if (!block) throw rangeError('Markdown block does not exist');
  return anchorForSourceRange(projection, block.sourceStart, block.sourceEnd, {
    scopeType: 'blocks',
    structurePath: block.path
  });
}

export function anchorForSection(projection, headingIndex) {
  const section = projection.sections[headingIndex];
  if (!section) throw rangeError('Markdown heading does not exist');
  const anchor = anchorForSourceRange(projection, section.sourceStart, section.sourceEnd, {
    scopeType: 'section',
    structurePath: section.path
  });
  return {
    ...anchor,
    section: {
      headingLevel: section.level,
      title: section.title,
      sourceStart: section.sourceStart,
      sourceEnd: section.sourceEnd,
      endBoundaryPath: section.endBoundaryPath,
      endBoundaryLevel: section.endBoundaryLevel,
      endBoundaryTitle: section.endBoundaryTitle,
      memberFingerprint: section.memberFingerprint
    }
  };
}

export function headingPathForSourceOffset(projection, sourceOffset) {
  const byLevel = new Map();
  for (const heading of projection.headings) {
    if (heading.sourceStart >= sourceOffset) break;
    byLevel.set(heading.level, heading.title);
    for (const level of [...byLevel.keys()]) if (level > heading.level) byLevel.delete(level);
  }
  return [...byLevel.entries()].sort(([left], [right]) => left - right).map(([, title]) => title);
}

function buildAnchor(projection, segments, options) {
  const quoteText = quoteForSegments(projection, segments);
  const sourceStart = Math.min(...segments.map(segment => segment.start));
  const sourceEnd = Math.max(...segments.map(segment => segment.end));
  const prefixText = projection.text.slice(
    Math.max(0, options.projectedStart ?? projectedIndexAtSource(projection, sourceStart) - 64),
    options.projectedStart ?? projectedIndexAtSource(projection, sourceStart)
  );
  const projectedEnd = options.projectedEnd ?? projectedIndexAtSource(projection, sourceEnd, true);
  const suffixText = projection.text.slice(projectedEnd, projectedEnd + 64);
  return {
    projectionVersion: MARKDOWN_PROJECTION_VERSION,
    scopeType: options.scopeType,
    segments,
    structurePath: options.structurePath ?? null,
    quoteText,
    prefixText,
    suffixText,
    sourceStart,
    sourceEnd,
    projectedStart: options.projectedStart ?? projectedIndexAtSource(projection, sourceStart),
    projectedEnd
  };
}

function appendLeafUnits(units, node, path, source, includeMath = false) {
  if (includeMath && ['code', 'math'].includes(node.type)) {
    appendLiteralBlockUnits(units, node, path, source);
    return;
  }
  if (node.type === 'code') {
    appendCodeUnits(units, node, path, source);
    return;
  }
  walk(node, path, (child, childPath) => {
    if (child !== node && LEAF_BLOCK_TYPES.has(child.type)) return false;
    if (child.type === 'text')
      appendDecodedUnits(units, child.value, sliceForNode(child, source), offset(child), childPath);
    else if (child.type === 'inlineCode') appendInlineCodeUnits(units, child, childPath, source);
    else if (includeMath && child.type === 'inlineMath') {
      const raw = sliceForNode(child, source);
      const delimiter = raw.match(/^\$+/)[0].length;
      appendDecodedUnits(units, child.value, raw.slice(delimiter, -delimiter), offset(child) + delimiter, childPath);
    } else if (child.type === 'break') units.push(separatorUnit('\n', childPath));
    else if (child.type === 'image')
      units.push({
        text: '\uFFFC',
        sourceStart: offset(child),
        sourceEnd: endOffset(child),
        path: childPath,
        atomic: true
      });
    return true;
  });
}

/** GFM+公式模式的字面块：用解析器正文与真实行边界对齐，不把代码/公式再次解释成 Markdown。 */
function appendLiteralBlockUnits(units, node, path, source) {
  const value = node.value ?? '';
  const raw = sliceForNode(node, source);
  const fenced = node.type === 'math' || /^(`{3,}|~{3,})/.test(raw);
  let lineStart = fenced ? source.indexOf('\n', offset(node)) + 1 : source.lastIndexOf('\n', offset(node) - 1) + 1;
  const mapped = [];
  const lines = value.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const next = source.indexOf('\n', lineStart);
    const lineEnd = next < 0 ? source.length : next;
    const logical = lines[index];
    const end = source[lineEnd - 1] === '\r' && !logical.endsWith('\r') ? lineEnd - 1 : lineEnd;
    const original = source.slice(lineStart, end);
    let suffix = 0;
    while (
      suffix < logical.length &&
      suffix < original.length &&
      original[original.length - suffix - 1] === logical[logical.length - suffix - 1]
    )
      suffix += 1;
    const expanded = logical.length - suffix;
    const start = end - suffix;
    if (
      end > endOffset(node) ||
      (expanded && (!/^ +$/.test(logical.slice(0, expanded)) || source[start - 1] !== '\t'))
    ) {
      // 无法细分时仅保留 AST 已知的整个字面块边界，不猜测字符位置。
      units.push({ text: value, sourceStart: offset(node), sourceEnd: endOffset(node), path });
      return;
    }
    for (let cursor = 0; cursor < logical.length; cursor += 1) {
      const from = cursor < expanded ? start - 1 : start + cursor - expanded;
      mapped.push({ text: logical[cursor], sourceStart: from, sourceEnd: from + 1, path });
    }
    if (index < lines.length - 1) mapped.push({ text: '\n', sourceStart: lineEnd, sourceEnd: lineEnd + 1, path });
    lineStart = lineEnd + 1;
  }
  for (const unit of mapped) units.push(unit);
}

function appendDecodedUnits(units, value, raw, rawOffset, path) {
  let rawIndex = 0;
  for (const character of value) {
    let start = raw.indexOf(character, rawIndex);
    let end;
    if (start >= 0) {
      end = start + character.length;
    } else if (raw[rawIndex] === '&') {
      const entityEnd = raw.indexOf(';', rawIndex);
      start = rawIndex;
      end = entityEnd >= 0 ? entityEnd + 1 : rawIndex + 1;
    } else {
      start = rawIndex;
      end = Math.min(raw.length, rawIndex + character.length);
    }
    units.push({ text: character, sourceStart: rawOffset + start, sourceEnd: rawOffset + end, path });
    rawIndex = end;
  }
}

function appendInlineCodeUnits(units, node, path, source) {
  const raw = sliceForNode(node, source);
  const opening = raw.match(/^`+/)?.[0].length ?? 1;
  const closing = raw.match(/`+$/)?.[0].length ?? opening;
  let contentStart = opening;
  let contentEnd = raw.length - closing;
  if (
    raw.slice(contentStart, contentEnd).startsWith(' ') &&
    raw.slice(contentStart, contentEnd).endsWith(' ') &&
    node.value !== ' '
  ) {
    contentStart += 1;
    contentEnd -= 1;
  }
  appendDecodedUnits(units, node.value, raw.slice(contentStart, contentEnd), offset(node) + contentStart, path);
}

function appendCodeUnits(units, node, path, source) {
  const raw = sliceForNode(node, source);
  if (!raw.startsWith('```') && !raw.startsWith('~~~')) {
    appendDecodedUnits(units, node.value, raw, offset(node), path);
    return;
  }
  const firstBreak = raw.indexOf('\n');
  const closingStart = Math.max(firstBreak + 1, raw.lastIndexOf('\n'));
  const contentStart = firstBreak < 0 ? raw.length : firstBreak + 1;
  const contentEnd = closingStart > contentStart ? closingStart : raw.length;
  appendDecodedUnits(units, node.value, raw.slice(contentStart, contentEnd), offset(node) + contentStart, path);
}

export function quoteForSegments(projection, segments) {
  const selected = projection.units.filter(
    unit => unit.sourceStart !== null && segments.some(segment => overlapsUnit(segment, unit))
  );
  if (selected.length === 0) return '';
  const output = [];
  let previous = null;
  for (const unit of selected) {
    if (previous && unit.projectedStart > previous.projectedEnd) {
      output.push(projection.text.slice(previous.projectedEnd, unit.projectedStart));
    }
    output.push(unit.text);
    previous = unit;
  }
  return output.join('');
}

function clipUnit(unit, projectedStart, projectedEnd) {
  const startDelta = Math.max(0, projectedStart - unit.projectedStart);
  const endDelta = Math.max(0, unit.projectedEnd - projectedEnd);
  return {
    start: unit.sourceStart + Math.min(startDelta, unit.sourceEnd - unit.sourceStart),
    end: unit.sourceEnd - Math.min(endDelta, unit.sourceEnd - unit.sourceStart),
    path: unit.path
  };
}

function projectedIndexAtSource(projection, sourceOffset, preferEnd = false) {
  const candidate = projection.units.find(
    unit => unit.sourceStart !== null && (preferEnd ? unit.sourceEnd >= sourceOffset : unit.sourceStart >= sourceOffset)
  );
  return candidate ? (preferEnd ? candidate.projectedEnd : candidate.projectedStart) : projection.text.length;
}

function visibleText(node, source, includeMath = false) {
  const temp = [];
  appendLeafUnits(temp, node, 'heading', source, includeMath);
  return temp.map(unit => unit.text).join('');
}

function fingerprintBlocks(blocks) {
  return calculateContentHash(blocks.map(block => `${block.type}:${block.path}`).join('|'));
}

function buildBlock(node, path) {
  return { type: node.type, path: String(path), sourceStart: offset(node), sourceEnd: endOffset(node) };
}

function walk(node, path, visitor) {
  const pathParts = Array.isArray(path)
    ? path
    : String(path)
        .split('.')
        .filter(Boolean)
        .map(part => Number(part));
  const outcome = visitor(node, pathParts.join('.'));
  if (outcome === false || !Array.isArray(node.children)) return;
  node.children.forEach((child, index) => walk(child, [...pathParts, index], visitor));
}

function separatorUnit(text, path = 'separator') {
  return { text, sourceStart: null, sourceEnd: null, path };
}

function sliceForNode(node, source) {
  return source.slice(offset(node), endOffset(node));
}
function offset(node) {
  return node.position?.start?.offset ?? 0;
}
function endOffset(node) {
  return node.position?.end?.offset ?? offset(node);
}
function hasOffsets(node) {
  return Number.isInteger(node.position?.start?.offset) && Number.isInteger(node.position?.end?.offset);
}
export function overlapsUnit(segment, unit) {
  return unit.sourceStart !== null && segment.start < unit.sourceEnd && segment.end > unit.sourceStart;
}

function mergeSegments(segments) {
  const merged = [];
  for (const segment of segments.sort((left, right) => left.start - right.start)) {
    const previous = merged.at(-1);
    if (previous && previous.end === segment.start && previous.path === segment.path) previous.end = segment.end;
    else merged.push({ ...segment });
  }
  return merged;
}

function assertProjection(projection) {
  if (!projection || projection.version !== MARKDOWN_PROJECTION_VERSION || !Array.isArray(projection.units)) {
    throw new TypeError('Markdown projection is invalid');
  }
}

export function rangeError(message) {
  const error = new RangeError(message);
  error.code = 'ANNOTATION_RANGE_INVALID';
  return error;
}

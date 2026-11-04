import { parseIdentityBlocks } from '@study-accelerator/content-anchor';
import { knowraMarkSpans, parseKnowraMarks } from '@study-accelerator/shared/knowra-marks';

/**
 * 内联重点（v3）在正文中的源码区间，供分析范围与 AI 读取使用：
 * 选区取 `<mark>` 内侧；章节取标题到下一个同级或更高级标题；列表项取整个子树；整块取所在块；
 * 代码范围按缩进换算回源码。最后挖掉所有标记本身占用的位置，切出的原文不含标签且偏移可直接用于来源校验。
 * 标记不在正文中时返回 null。
 */
export function inlineAnnotationSourceRanges(markdown, markId) {
  return createInlineAnnotationSourceResolver(markdown)(markId);
}

/** 同一次正文解析供多个重点复用，避免摘要派生逐个重解析整篇。 */
export function createInlineAnnotationSourceResolver(markdown, { keepWhitespace = false } = {}) {
  const text = String(markdown ?? '');
  const parsed = parseKnowraMarks(text);
  const structure = parseIdentityBlocks(text, { includeContent: true });
  const headings = structure.filter(block => block.type === 'heading');
  const lineStarts = [0];
  for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1)) lineStarts.push(index + 1);
  const lineRange = line => [lineStarts[line] ?? text.length, (lineStarts[line + 1] ?? text.length + 1) - 1];
  const startsOn = (line, item) => {
    const [from, to] = lineRange(line);
    return item.sourceStart >= from && item.sourceStart <= to;
  };
  const depth = item => item.depth;

  const blockRange = marker => {
    const line = marker.targetLine ?? marker.line;
    if (marker.attrs.s === 'section') {
      const index = headings.findIndex(heading => startsOn(line, heading));
      if (index < 0) return null;
      const heading = headings[index];
      const next = headings.slice(index + 1).find(item => item.level <= heading.level);
      return [heading.sourceStart, Math.min(next?.sourceStart ?? text.length, heading.containerEnd)];
    }
    if (marker.attrs.s === 'list') {
      const item = structure
        .filter(candidate => candidate.type === 'listItem' && startsOn(line, candidate))
        .sort((a, b) => depth(a) - depth(b))[0];
      return item ? [item.sourceStart, item.sourceEnd] : null;
    }
    const block = structure
      .filter(candidate => candidate.type !== 'html' && startsOn(line, candidate))
      .sort((a, b) => depth(a) - depth(b))[0];
    return block ? [block.sourceStart, block.sourceEnd] : null;
  };

  /** 按语法树的代码正文逐行回映源码，容器前缀和围栏都不属于代码文字。 */
  const codeRanges = marker => {
    const fenceLine = marker.targetLine;
    if (fenceLine === null || !marker.code?.resolved) return [];
    const block = structure.find(candidate => candidate.type === 'code' && startsOn(fenceLine, candidate));
    if (!block) return [];
    const value = block.value ?? '';
    if (value.slice(marker.code.from, marker.code.to) !== marker.code.text) return [];
    const map = [];
    const lines = value.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = fenceLine + index + 1;
      if (line >= lineStarts.length) return [];
      const [from, lineEnd] = lineRange(line);
      if (lineEnd > block.sourceEnd) return [];
      const logical = lines[index];
      // 围栏前最后一个 CRLF 整体不在 node.value 中，源码行表只去掉了 LF。
      const to = text[lineEnd - 1] === '\r' && !logical.endsWith('\r') ? lineEnd - 1 : lineEnd;
      const raw = text.slice(from, to);
      let suffix = 0;
      // CommonMark 可把缩进边界上的一个 tab 剩余部分展开为空格。
      while (
        suffix < logical.length &&
        suffix < raw.length &&
        raw[raw.length - suffix - 1] === logical[logical.length - suffix - 1]
      )
        suffix += 1;
      const expanded = logical.length - suffix;
      const start = to - suffix;
      if (expanded && (!/^ +$/.test(logical.slice(0, expanded)) || text[start - 1] !== '\t')) return [];
      for (let offset = 0; offset < expanded; offset += 1) map.push([start - 1, start]);
      for (let offset = start; offset < to; offset += 1) map.push([offset, offset + 1]);
      // 按行号补换行，不能依据 map.length：前导空行也占逻辑代码偏移。
      if (index < lines.length - 1) map.push([lineEnd, lineEnd + 1]);
    }
    const ranges = [];
    for (const [from, to] of map.slice(marker.code.from, marker.code.to)) {
      const previous = ranges.at(-1);
      if (previous && from <= previous[1]) previous[1] = Math.max(previous[1], to);
      else ranges.push([from, to]);
    }
    return ranges;
  };

  const spans = knowraMarkSpans(text);
  const clean = ([from, to]) => {
    const pieces = [];
    let cursor = from;
    for (const span of spans) {
      if (span.end <= cursor || span.start >= to) continue;
      if (span.start > cursor) pieces.push({ start: cursor, end: span.start });
      cursor = Math.max(cursor, span.end);
    }
    if (cursor < to) pieces.push({ start: cursor, end: to });
    // 来源变化比较需要这些空白判断连续性；分析范围默认仍去掉纯空白碎片。
    return keepWhitespace ? pieces : pieces.filter(piece => text.slice(piece.start, piece.end).trim());
  };
  const merge = ranges =>
    ranges
      .flatMap(clean)
      .sort((a, b) => a.start - b.start)
      .reduce((list, piece) => {
        const last = list.at(-1);
        if (last && piece.start <= last.end) last.end = Math.max(last.end, piece.end);
        else list.push({ ...piece });
        return list;
      }, []);
  return markId => {
    const inline = parsed.inline.filter(item => item.id === markId);
    const blocks = parsed.blocks.filter(item => item.id === markId);
    if (!inline.length && !blocks.some(item => !item.exclude)) return null;
    const raw = [];
    for (const mark of inline) raw.push([mark.contentStart, mark.contentEnd]);
    const excluded = [];
    for (const marker of blocks) {
      const ranges = marker.attrs.s === 'code' ? codeRanges(marker) : [blockRange(marker)].filter(Boolean);
      (marker.exclude ? excluded : raw).push(...ranges);
    }
    return { ranges: merge(raw), excluded: merge(excluded) };
  };
}

import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { mathFromMarkdown } from 'mdast-util-math';
import { cjkFriendlyEmphasisExtension } from '@study-accelerator/shared/markdown-cjk';
import { gfmStrikethroughCjkFriendly } from 'micromark-extension-cjk-friendly-gfm-strikethrough';
import { gfm } from 'micromark-extension-gfm';
import { math } from 'micromark-extension-math';
import { calculateContentHash } from './hash.js';

/**
 * 稳定身份迁移（S2a 影子阶段）：编辑器块序列与 Markdown 块对齐，并把编辑器身份视角下的重点位置
 * 与旧链路的跟随结果放到同一组块上比较。只产出诊断记录，不改变任何持久化结果。
 */
export const IDENTITY_SHADOW_FORMAT = 2;

/** 编辑器节点名 → Markdown 块类型。表格单元格内部不参与对齐。 */
export const EDITOR_TO_MARKDOWN_BLOCK = Object.freeze({
  paragraph: 'paragraph',
  heading: 'heading',
  blockquote: 'blockquote',
  code_block: 'code',
  hr: 'thematicBreak',
  list_item: 'listItem',
  table: 'table',
  math_block: 'math'
});
// 编辑器的 html 是行内原子节点，不是块；Markdown 块级 HTML 在编辑器里是一个段落（对齐时按段落配对）。
const MARKDOWN_BLOCKS = new Set([...Object.values(EDITOR_TO_MARKDOWN_BLOCK), 'html']);
/** 只有这些容器包含块级内容；段落、标题等只含行内内容，不再向内递归（行内 HTML 不是块）。 */
const FLOW_CONTAINERS = new Set(['root', 'blockquote', 'list', 'listItem', 'footnoteDefinition']);
const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'code', 'math', 'html', 'thematicBreak', 'table']);
const LIMITS = { blocks: 50000, annotations: 5000, id: 128 };
const BR_HTML = /^\s*<br\s*\/?>\s*$/i;

/** 与编辑器相同的块解析：gfm + 公式（单美元行内公式）。 */
export function parseIdentityBlocks(markdown, { includeContent = false } = {}) {
  const source = String(markdown ?? '');
  const tree = fromMarkdown(source, {
    extensions: [gfm(), cjkFriendlyEmphasisExtension(), gfmStrikethroughCjkFriendly(), math({ singleDollarTextMath: true })],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()]
  });
  const blocks = [];
  const walk = (node, depth, containerEnd = source.length) => {
    if (MARKDOWN_BLOCKS.has(node.type) && node.position) {
      blocks.push({
        type: node.type,
        depth,
        sourceStart: node.position.start.offset,
        sourceEnd: node.position.end.offset,
        br: node.type === 'html' && BR_HTML.test(node.value ?? ''),
        ...(includeContent ? { value: node.value, level: node.depth, containerEnd } : {})
      });
    }
    if (!FLOW_CONTAINERS.has(node.type)) return;
    const container = ['blockquote', 'listItem', 'footnoteDefinition'].includes(node.type);
    for (const child of node.children ?? [])
      walk(
        child,
        MARKDOWN_BLOCKS.has(node.type) ? depth + 1 : depth,
        container ? node.position.end.offset : containerEnd
      );
  };
  walk(tree, 0);
  return blocks;
}

/**
 * 按类型顺序对齐。已知差异：Markdown 块级 HTML 对应编辑器段落（`<br />` 即空段落）；无对应的编辑器空段落跳过。
 * 返回 editorIndex → markdownIndex；无法对齐时返回失败位置。
 */
export function alignIdentityBlocks(markdownBlocks, editorBlocks) {
  const pairs = new Map();
  let i = 0,
    j = 0;
  while (i < editorBlocks.length || j < markdownBlocks.length) {
    const editor = editorBlocks[i],
      markdown = markdownBlocks[j];
    if (editor && markdown && editor.type === markdown.type) {
      pairs.set(i++, j++);
      continue;
    }
    if (editor?.type === 'paragraph' && markdown?.type === 'html') {
      pairs.set(i++, j++);
      continue;
    }
    if (editor?.type === 'paragraph' && editor.empty) {
      i++;
      continue;
    }
    return {
      aligned: false,
      editorIndex: i,
      markdownIndex: j,
      editorType: editor?.type ?? null,
      markdownType: markdown?.type ?? null
    };
  }
  return { aligned: true, pairs };
}

function text(value, max) {
  return typeof value === 'string' && value.length <= max;
}
function optionalId(value) {
  return value === undefined || text(value, LIMITS.id);
}
/** 选区块内位置：{ blockId, offset, cell?: [行, 列] }。 */
function optionalPoint(point) {
  if (point === undefined) return true;
  return (
    Boolean(point) &&
    text(point.blockId, LIMITS.id) &&
    Number.isInteger(point.offset) &&
    point.offset >= 0 &&
    (point.cell === undefined ||
      (Array.isArray(point.cell) &&
        point.cell.length === 2 &&
        point.cell.every(value => Number.isInteger(value) && value >= 0)))
  );
}

/** 编辑器状态来自客户端，形状不合法时整体忽略，不能影响保存。 */
export function validIdentityEditorState(state) {
  if (!state || typeof state !== 'object' || state.formatVersion !== IDENTITY_SHADOW_FORMAT) return false;
  if (!text(state.targetContentHash, 128) || !Array.isArray(state.blocks) || !Array.isArray(state.annotations))
    return false;
  if (state.blocks.length > LIMITS.blocks || state.annotations.length > LIMITS.annotations) return false;
  const blocksOk = state.blocks.every(
    block => block && text(block.id, LIMITS.id) && MARKDOWN_BLOCKS.has(block.type) && typeof block.empty === 'boolean'
  );
  return (
    blocksOk &&
    state.annotations.every(
      item =>
        item &&
        text(item.id, LIMITS.id) &&
        typeof item.present === 'boolean' &&
        ['selection', 'blocks', 'section', 'list'].includes(item.scopeType) &&
        optionalId(item.rootBlockId) &&
        optionalId(item.startBlockId) &&
        optionalId(item.endBlockId) &&
        (item.quoteHash === undefined || text(item.quoteHash, 128)) &&
        optionalPoint(item.start) &&
        optionalPoint(item.end)
    )
  );
}

function deepestContaining(blocks, offset, types) {
  let found = -1;
  blocks.forEach((block, index) => {
    if (
      types.has(block.type) &&
      block.sourceStart <= offset &&
      offset < block.sourceEnd &&
      (found < 0 || block.depth >= blocks[found].depth)
    )
      found = index;
  });
  return found;
}

/** 旧链路结果（源码偏移）换算到编辑器块 ID。 */
function oldTargets(annotation, blocks, idByMarkdownIndex) {
  const anchor = annotation.anchor ?? {};
  const start = Number.isInteger(anchor.sourceStart) ? anchor.sourceStart : annotation.fromPosition;
  const end = Number.isInteger(anchor.sourceEnd) ? anchor.sourceEnd : annotation.toPosition;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  const id = index => (index < 0 ? null : (idByMarkdownIndex.get(index) ?? null));
  if (annotation.scopeType === 'section')
    return { rootBlockId: id(deepestContaining(blocks, start, new Set(['heading']))) };
  if (annotation.scopeType === 'list')
    return { rootBlockId: id(deepestContaining(blocks, start, new Set(['listItem']))) };
  return {
    startBlockId: id(deepestContaining(blocks, start, TEXT_BLOCKS)),
    endBlockId: id(deepestContaining(blocks, Math.max(start, end - 1), TEXT_BLOCKS))
  };
}

const normalizeQuote = value => String(value ?? '').replace(/[\s\uFFFC]+/g, '');

/** 摘录只以归一化哈希参与比较：快照大小不随选区长度增长，也不在请求中重复正文。 */
export function identityQuoteHash(value) {
  return calculateContentHash(normalizeQuote(value));
}

/**
 * 比较一次保存后的两边结论。`annotations` 是旧链路完成跟随后的仓库记录。
 * 返回汇总与逐条分歧；记录只含 ID、范围类型和结论，不含正文。
 */
export function compareIdentityShadow({ markdown, editorState, annotations }) {
  if (!validIdentityEditorState(editorState)) return { status: 'invalidState', compared: 0, divergences: [] };
  if (editorState.targetContentHash !== calculateContentHash(markdown))
    return { status: 'stateMismatch', compared: 0, divergences: [] };
  const blocks = parseIdentityBlocks(markdown);
  const alignment = alignIdentityBlocks(blocks, editorState.blocks);
  if (!alignment.aligned) {
    const { editorIndex, markdownIndex, editorType, markdownType } = alignment;
    return {
      status: 'alignFailed',
      compared: 0,
      divergences: [],
      alignment: { editorIndex, markdownIndex, editorType, markdownType }
    };
  }
  const idByMarkdownIndex = new Map(
    [...alignment.pairs].map(([editorIndex, markdownIndex]) => [markdownIndex, editorState.blocks[editorIndex].id])
  );
  const byId = new Map(
    annotations.filter(item => (item.lifecycleStatus ?? 'active') === 'active').map(item => [item.id, item])
  );
  const divergences = [];
  let compared = 0;
  for (const identity of editorState.annotations) {
    const old = byId.get(identity.id);
    if (!old || old.scopeType !== identity.scopeType) continue;
    compared += 1;
    const base = {
      annotationId: identity.id,
      scopeType: identity.scopeType,
      oldStatus: old.anchorStatus ?? null,
      oldReason: old.anchorReason ?? null
    };
    if (old.anchorStatus !== 'resolved') {
      if (identity.present)
        divergences.push({ ...base, kind: old.anchorStatus === 'missing' ? 'trackedLost' : 'oldNeedsReview' });
      continue;
    }
    if (!identity.present) {
      divergences.push({ ...base, kind: 'identityLost' });
      continue;
    }
    const targets = oldTargets(old, blocks, idByMarkdownIndex);
    const keys =
      identity.scopeType === 'section' || identity.scopeType === 'list'
        ? ['rootBlockId']
        : ['startBlockId', 'endBlockId'];
    if (!targets || keys.some(key => targets[key] !== identity[key])) {
      divergences.push({ ...base, kind: 'blockMismatch' });
      continue;
    }
    if (
      identity.scopeType === 'selection' &&
      identity.quoteHash !== identityQuoteHash(old.quoteText ?? old.anchor?.quoteText)
    ) {
      divergences.push({ ...base, kind: 'quoteMismatch' });
    }
  }
  return { status: 'compared', compared, divergences };
}

/**
 * 块身份表（S2b）：按 `parseIdentityBlocks` 的顺序为每个 Markdown 块记录编辑器 ID，
 * 随笔记存放在 `annotationStructure.identity`。旧链路使用的 `annotationStructure.nodes` 不受影响。
 */
export function identityFromEditorState(markdown, editorState) {
  if (!validIdentityEditorState(editorState) || editorState.targetContentHash !== calculateContentHash(markdown))
    return null;
  const blocks = parseIdentityBlocks(markdown);
  const alignment = alignIdentityBlocks(blocks, editorState.blocks);
  if (!alignment.aligned) return null;
  const idByMarkdownIndex = new Map(
    [...alignment.pairs].map(([editorIndex, markdownIndex]) => [markdownIndex, editorState.blocks[editorIndex].id])
  );
  const ids = blocks.map((_, index) => idByMarkdownIndex.get(index));
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) return null;
  return {
    formatVersion: IDENTITY_SHADOW_FORMAT,
    contentHash: calculateContentHash(markdown),
    blocks: blocks.map((block, index) => ({ id: ids[index], type: block.type }))
  };
}

/** 身份表只在与当前正文完全对应时可用；不合法时视为不存在，不能让数据加载失败。 */
export function validIdentityTable(markdown, identity) {
  if (
    !identity ||
    identity.formatVersion !== IDENTITY_SHADOW_FORMAT ||
    identity.contentHash !== calculateContentHash(markdown) ||
    !Array.isArray(identity.blocks)
  )
    return false;
  const blocks = parseIdentityBlocks(markdown);
  if (blocks.length !== identity.blocks.length) return false;
  const ids = new Set();
  return identity.blocks.every((block, index) => {
    const ok =
      block &&
      text(block.id, LIMITS.id) &&
      block.id.length > 0 &&
      !ids.has(block.id) &&
      block.type === blocks[index].type;
    ids.add(block?.id);
    return ok;
  });
}

/** 编辑器加载时沿用身份表：返回 editorIndex → 块 ID；身份表无效或无法对齐时返回 null。 */
export function adoptIdentityIds(markdown, identity, editorBlocks) {
  if (!validIdentityTable(markdown, identity)) return null;
  const alignment = alignIdentityBlocks(parseIdentityBlocks(markdown), editorBlocks);
  if (!alignment.aligned) return null;
  return new Map(
    [...alignment.pairs].map(([editorIndex, markdownIndex]) => [editorIndex, identity.blocks[markdownIndex].id])
  );
}

import { fromMarkdown } from 'mdast-util-from-markdown';
import { cjkFriendlyEmphasisExtension } from '@study-accelerator/shared/markdown-cjk';
import { gfmStrikethroughCjkFriendly } from 'micromark-extension-cjk-friendly-gfm-strikethrough';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';

const LINK_URL = /^knowra:\/\/note\/([^/?#]+)#ref=([a-zA-Z0-9_-]{8,100})$/;

export function parseNoteLinkUrl(url) {
  if (typeof url !== 'string') return null;
  const match = LINK_URL.exec(url);
  if (!match) return null;
  try {
    const targetNoteId = decodeURIComponent(match[1]);
    if (!targetNoteId || targetNoteId.length > 200 || /[\u0000-\u001f\u007f]/.test(targetNoteId)) return null;
    return { targetNoteId, occurrenceId: match[2] };
  } catch {
    return null;
  }
}

export function createNoteLinkUrl(targetNoteId, occurrenceId) {
  const url = `knowra://note/${encodeURIComponent(targetNoteId)}#ref=${occurrenceId}`;
  if (!parseNoteLinkUrl(url)) throw new TypeError('Invalid note link identity');
  return url;
}

/** 只解析真实 Markdown 节点，不把代码示例或标题猜测变成引用。 */
export function extractNoteLinks(markdown) {
  const source = String(markdown ?? '');
  const tree = fromMarkdown(source, { extensions: [gfm(), cjkFriendlyEmphasisExtension(), gfmStrikethroughCjkFriendly()], mdastExtensions: [gfmFromMarkdown()] });
  const definitions = new Map();
  walk(tree, node => {
    if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
  });
  const occurrences = [];
  const targetIds = new Set();
  function visit(node, block = tree, inLink = false) {
    if (['code', 'inlineCode', 'html', 'definition', 'image', 'imageReference'].includes(node.type)) return;
    if (['paragraph', 'heading', 'tableCell'].includes(node.type)) block = node;
    if (node.type === 'link' || node.type === 'linkReference') {
      const url = node.type === 'link' ? node.url : definitions.get(node.identifier);
      const parsed = parseNoteLinkUrl(url);
      if (parsed) {
        targetIds.add(parsed.targetNoteId);
        const label = text(node);
        const { before, after } = visibleContext(block, node);
        occurrences.push({
          ...parsed,
          url,
          sourceStart: node.position.start.offset,
          sourceEnd: node.position.end.offset,
          label,
          context: contextSnippet(before, label, after)
        });
      }
      inLink = true;
    }
    // 历史 [[文本]] 保留原有 ID 提取，不猜标题、不迁移正文；无位置 ID 不参与定位。
    if (!inLink && node.type === 'text') {
      for (const match of node.value.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
        if (match[1].trim()) targetIds.add(match[1].trim());
      }
    }
    for (const child of node.children ?? []) visit(child, block, inLink);
  }
  visit(tree);
  return { targetIds: [...targetIds], occurrences };
}

export function resolveNoteLinkOccurrence(markdown, locator) {
  if (!locator?.occurrenceId || !locator?.targetNoteId) return null;
  const matches = extractNoteLinks(markdown).occurrences.filter(item => item.occurrenceId === locator.occurrenceId);
  return matches.length === 1 && matches[0].targetNoteId === locator.targetNoteId ? matches[0] : null;
}

function walk(node, action) {
  action(node);
  for (const child of node.children ?? []) walk(child, action);
}
function text(node) {
  return node.type === 'html' ? '' : (node.value ?? (node.children ?? []).map(text).join(''));
}
function visibleContext(block, target) {
  let before = '',
    after = '',
    found = false;
  function visit(node) {
    if (node === target) {
      found = true;
      return;
    }
    if (['html', 'definition', 'image', 'imageReference'].includes(node.type)) return;
    if (node.value !== undefined) {
      if (found) after += node.value;
      else before += node.value;
    } else for (const child of node.children ?? []) visit(child);
  }
  visit(block);
  return { before, after };
}
function contextSnippet(before, label, after) {
  const clean = value => value.replace(/\s+/g, ' ').trim();
  const left = [...clean(before)].slice(-40).join('');
  const middle = [...label].slice(0, 80).join('');
  const right = [...clean(after)].slice(0, 40).join('');
  return `${[...clean(before)].length > 40 ? '…' : ''}${left}${middle}${[...label].length > 80 ? '…' : ''}${right}${[...clean(after)].length > 40 ? '…' : ''}`;
}

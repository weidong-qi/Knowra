import { randomId } from '../../browser/randomId';
import { extendListItemSchemaForTask } from '@milkdown/kit/preset/gfm';
import type { Mark, MarkType, Node as ProseNode, NodeSpec, ParseRule } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state';
import { isHistoryTransaction } from '@milkdown/kit/prose/history';
import { Transform } from '@milkdown/kit/prose/transform';
import { $prose } from '@milkdown/kit/utils';
import type { Ctx } from '@milkdown/kit/ctx';
import { KNOWRA_MARK, knowraMarkSchema, parseKnowraClipboardBlocks } from './editorKnowraMarks';
import { createKnowraClipboardIntent, KNOWRA_CLIPBOARD_PLAIN, remapCopiedKnowraMarks } from './editorKnowraClipboard';

/** 只改变块 ID 或重点 mark、不改变正文的事务。 */
export const IDENTITY_META = 'knowraIdentity';
export const IDENTITY_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'code_block',
  'hr',
  'list_item',
  'table',
  'math_block',
  'html'
]);

function withBlockId(spec: NodeSpec, name: string, hasKnowraMark: boolean): NodeSpec {
  const toDOM = spec.toDOM;
  return {
    ...spec,
    // knowraBlocks：块级 Knowra 标记（重点内联化 I1，见 editorKnowraMarks.ts），属于正文内容。
    attrs: { ...spec.attrs, blockId: { default: null }, knowraBlocks: { default: null } },
    ...(name === 'code_block' && hasKnowraMark ? { marks: KNOWRA_MARK } : {}),
    parseDOM: spec.parseDOM?.map((rule: ParseRule) => ({
      ...rule,
      getAttrs: (dom: HTMLElement | string) => {
        const base = rule.getAttrs ? rule.getAttrs(dom as never) : (rule.attrs ?? {});
        if (base === false) return false;
        const blockId = typeof dom === 'string' ? null : (dom.getAttribute?.('data-block-id') ?? null);
        const knowraBlocks =
          typeof dom === 'string' ? null : parseKnowraClipboardBlocks(dom.getAttribute?.('data-knowra-blocks') ?? null);
        return { ...(base ?? {}), blockId, knowraBlocks };
      }
    })) as NodeSpec['parseDOM'],
    toDOM:
      toDOM &&
      ((node: ProseNode) => {
        const out = toDOM(node) as unknown;
        const extra: Record<string, string> = {};
        if (node.attrs.blockId) extra['data-block-id'] = node.attrs.blockId;
        if (node.attrs.knowraBlocks?.length) extra['data-knowra-blocks'] = JSON.stringify(node.attrs.knowraBlocks);
        if (!Array.isArray(out) || !Object.keys(extra).length) return out as never;
        const [tag, attrs, ...rest] = out;
        const isAttrs = attrs && typeof attrs === 'object' && !Array.isArray(attrs) && !(attrs as Node).nodeType;
        return (
          isAttrs
            ? [tag, { ...attrs, ...extra }, ...rest]
            : [tag, extra, ...(attrs === undefined ? [] : [attrs]), ...rest]
        ) as never;
      })
  };
}

/** 在 `.config()` 中调用：给块节点加 `blockId` 与 `knowraBlocks` 属性，并允许代码块携带重点标记。列表项使用 gfm 扩展后的 schema。 */
export function configureBlockIdentitySchema(ctx: Ctx) {
  for (const name of IDENTITY_BLOCK_TYPES) {
    const key = name === 'list_item' ? extendListItemSchemaForTask.key : name;
    try {
      // knowraMark 只在编辑器注册了它时才允许出现在代码块里（mark 插件在初始化阶段同步注入配置槽）。
      ctx.update(
        key as never,
        (previous: (ctx: Ctx) => NodeSpec) => (current: Ctx) =>
          withBlockId(previous(current), name, current.isInjected(knowraMarkSchema.key))
      );
    } catch {
      /* 当前编辑器未注册该节点 */
    }
  }
}

export function createBlockId() {
  return `b${randomId().replace(/-/g, '').slice(0, 15)}`;
}

function insertedRanges(transactions: readonly Transaction[]) {
  let ranges: Array<[number, number]> = [];
  for (const transaction of transactions) {
    for (const map of transaction.mapping.maps) {
      ranges = ranges.map(([from, to]) => [map.map(from, -1), map.map(to, 1)]);
      map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        if (newEnd > newStart) ranges.push([newStart, newEnd]);
      });
    }
  }
  return ranges;
}

/** 整段被同一重点覆盖的代码块：blockId → 重点 ID。 */
function fullyMarkedCodeBlocks(doc: ProseNode, type: MarkType) {
  const result = new Map<string, { marks: Map<string, Mark>; text: string }>();
  doc.descendants(node => {
    if (node.type.name !== 'code_block') return true;
    if (!node.attrs.blockId || !node.content.size) return false;
    let marks: Map<string, Mark> | null = null;
    node.forEach(child => {
      const own = new Map(child.marks.filter(mark => mark.type === type).map(mark => [String(mark.attrs.id), mark]));
      marks = marks ? new Map([...marks].filter(([id]) => own.has(id))) : own;
    });
    if (marks && (marks as Map<string, Mark>).size) result.set(node.attrs.blockId, { marks, text: node.textContent });
    return false;
  });
  return result;
}

/**
 * 块身份与重点标记的事务后规整：
 * - 缺少 ID 的块分配新 ID；重复 ID 中落在本批插入范围之外的保留，其余换新（拆分保前半、复制得新身份、移动保留）。
 * - 粘贴或拖放复制的重点标记换成新 ID，移动则保留。
 * - 事务前整段覆盖代码块的重点，事务后继续覆盖整个代码块。
 */
export function createBlockIdentityBehavior() {
  const clipboardIntent = createKnowraClipboardIntent();
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey('KNOWRA_BLOCK_IDENTITY'),
        props: {
          handleDOMEvents: {
            copy() {
              clipboardIntent.clear();
              return false;
            }
          }
        },
        appendTransaction(transactions, oldState, state) {
          const inserted = insertedRanges(transactions);
          const inside = (position: number) => inserted.some(([from, to]) => position >= from && position < to);
          const positionsById = new Map<string, number[]>();
          const missing: number[] = [];
          state.doc.descendants((node, position) => {
            if (!IDENTITY_BLOCK_TYPES.has(node.type.name) || !('blockId' in node.attrs)) return;
            const id = node.attrs.blockId as string | null;
            if (!id) missing.push(position);
            else positionsById.set(id, [...(positionsById.get(id) ?? []), position]);
          });
          const tr = state.tr;
          for (const positions of positionsById.values()) {
            if (positions.length < 2) continue;
            const keep = positions.find(position => !inside(position)) ?? positions[0];
            for (const position of positions)
              if (position !== keep) tr.setNodeAttribute(position, 'blockId', createBlockId());
          }
          for (const position of missing) tr.setNodeAttribute(position, 'blockId', createBlockId());
          const clipboard = transactions.some(
            transaction =>
              ['paste', 'drop'].includes(transaction.getMeta('uiEvent')) && !transaction.getMeta(KNOWRA_CLIPBOARD_PLAIN)
          );
          const menuMove = clipboardIntent.consume(transactions);
          const moving =
            menuMove ||
            transactions.some(
              transaction =>
                transaction.getMeta('uiEvent') === 'drop' &&
                transaction.mapping.maps.some(map => {
                  let deleted = false;
                  map.forEach((from, to, start, end) => {
                    if (to > from && start === end) deleted = true;
                  });
                  return deleted;
                })
            );
          const copiedMarks = clipboard && remapCopiedKnowraMarks(tr, inserted, moving);
          let extendedInlineMarks = false;
          const markType = state.schema.marks[KNOWRA_MARK];
          // 带重点的复制/移动有自己的独立范围，不能再用目标代码块原重点覆盖副本。
          if (
            markType &&
            !copiedMarks &&
            !(clipboard && moving) &&
            !transactions.some(isHistoryTransaction) &&
            transactions.some(transaction => transaction.docChanged)
          ) {
            const before = fullyMarkedCodeBlocks(oldState.doc, markType);
            const previousSteps = tr.steps.length;
            if (before.size) {
              tr.doc.descendants((node, position) => {
                if (node.type.name !== 'code_block') return true;
                const previous = before.get(node.attrs.blockId);
                // 仅正文变化继承，取消、改级别、重选等纯标记事务必须保留用户意图。
                if (previous?.text === node.textContent) return false;
                if (previous && node.content.size)
                  for (const mark of previous.marks.values())
                    tr.addMark(position + 1, position + 1 + node.content.size, mark);
                return false;
              });
            }
            if (tr.steps.length > previousSteps) extendedInlineMarks = true;
          }
          // 新重点 ID 属于正文，与本次粘贴一起进入撤销历史；纯块身份维护仍不进历史。
          return tr.docChanged
            ? copiedMarks || extendedInlineMarks
              ? tr
              : tr.setMeta('addToHistory', false).setMeta(IDENTITY_META, true)
            : null;
        }
      })
  );
}

/** 去掉块 ID 后的文档，用于和重新解析的 Markdown 比较"正文是否一致"。 */
export function withoutIdentity(doc: ProseNode): ProseNode {
  const tr = new Transform(doc);
  tr.doc.descendants((node, position) => {
    if (node.attrs.blockId) tr.setNodeAttribute(position, 'blockId', null);
  });
  return tr.doc;
}

/** 导出 HTML 时去掉块身份属性与块级重点属性；序列化方式与 imageHtmlWithRenderedSizes 一致。 */
export function stripIdentityFromHtml(html: string): string {
  if (!html.includes('data-block-id') && !html.includes('data-knowra-blocks')) return html;
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.body.querySelectorAll('[data-block-id]').forEach(element => element.removeAttribute('data-block-id'));
  parsed.body
    .querySelectorAll('[data-knowra-blocks]')
    .forEach(element => element.removeAttribute('data-knowra-blocks'));
  return Array.from(parsed.body.childNodes)
    .map(node => new XMLSerializer().serializeToString(node))
    .join('');
}

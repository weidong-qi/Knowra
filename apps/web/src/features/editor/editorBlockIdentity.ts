import { SerializerReady, serializerCtx } from '@milkdown/kit/core';
import { extendListItemSchemaForTask } from '@milkdown/kit/preset/gfm';
import type { Mark, MarkType, Node as ProseNode, NodeSpec, ParseRule } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state';
import { isHistoryTransaction } from '@milkdown/kit/prose/history';
import { Transform } from '@milkdown/kit/prose/transform';
import { $markSchema, $prose } from '@milkdown/kit/utils';
import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx';
import { KNOWRA_MARK, knowraMarkSchema, parseKnowraClipboardBlocks } from './editorKnowraMarks';
import { createKnowraClipboardIntent, KNOWRA_CLIPBOARD_PLAIN, remapCopiedKnowraMarks } from './editorKnowraClipboard';

/** 重点在正文中的身份载体。只用于跟踪位置，不绘制、不进入 Markdown。 */
export const ANNOTATION_MARK = 'knowraAnnotation';
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

export const annotationMarkSchema = $markSchema(ANNOTATION_MARK, () => ({
  attrs: { id: { default: null } },
  excludes: '',
  inclusive: false,
  parseDOM: [
    {
      tag: 'span[data-knowra-annotation]',
      getAttrs: dom => ({ id: (dom as HTMLElement).getAttribute('data-knowra-annotation') })
    }
  ],
  toDOM: mark => ['span', { 'data-knowra-annotation': mark.attrs.id }, 0],
  parseMarkdown: { match: () => false, runner: () => {} },
  // 序列化前已由 annotationSerializerGuard 剥离；这里返回空值时 Milkdown 也会把它当作不存在。
  toMarkdown: { match: mark => mark.type.name === ANNOTATION_MARK, runner: () => undefined as never }
}));

function withBlockId(spec: NodeSpec, name: string, hasKnowraMark: boolean): NodeSpec {
  const toDOM = spec.toDOM;
  return {
    ...spec,
    // knowraBlocks：块级 Knowra 标记（重点内联化 I1，见 editorKnowraMarks.ts），属于正文内容。
    attrs: { ...spec.attrs, blockId: { default: null }, knowraBlocks: { default: null } },
    ...(name === 'code_block' ? { marks: hasKnowraMark ? `${ANNOTATION_MARK} ${KNOWRA_MARK}` : ANNOTATION_MARK } : {}),
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

/** 在 `.config()` 中调用：给块节点加 `blockId` 属性，并允许代码块携带重点 mark。列表项使用 gfm 扩展后的 schema。 */
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
  return `b${crypto.randomUUID().replace(/-/g, '').slice(0, 15)}`;
}

function isAnnotationMark(mark: Mark, type: MarkType) {
  return mark.type === type;
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
      const own = new Map(
        child.marks.filter(mark => isAnnotationMark(mark, type)).map(mark => [String(mark.attrs.id), mark])
      );
      marks = marks ? new Map([...marks].filter(([id]) => own.has(id))) : own;
    });
    if (marks && (marks as Map<string, Mark>).size) result.set(node.attrs.blockId, { marks, text: node.textContent });
    return false;
  });
  return result;
}

/**
 * 块身份与重点 mark 的事务后规整：
 * - 缺少 ID 的块分配新 ID；重复 ID 中落在本批插入范围之外的保留，其余换新（拆分保前半、复制得新身份、移动保留）。
 * - 粘贴或拖放插入的重点 mark：同一重点在插入范围外仍有片段（复制），或不属于本笔记，则从插入内容剥离。
 * - 事务前整段覆盖代码块的重点，事务后继续覆盖整个代码块。
 */
export function createBlockIdentityBehavior(
  knownAnnotationIds: (state: EditorState) => ReadonlySet<string> | null,
  isCutPaste: (state: EditorState) => boolean = () => false
) {
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
          const type = state.schema.marks[ANNOTATION_MARK];
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
            isCutPaste(state) ||
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
          if (type && clipboard) {
            const known = knownAnnotationIds(state);
            const outside = new Set<string>();
            state.doc.descendants((node, position) => {
              if (node.isInline && !inserted.some(([from, to]) => position >= from && position + node.nodeSize <= to)) {
                node.marks.forEach(mark => {
                  if (isAnnotationMark(mark, type)) outside.add(String(mark.attrs.id));
                });
              }
            });
            for (const [from, to] of inserted) {
              state.doc.nodesBetween(from, Math.min(to, state.doc.content.size), (node, position) => {
                if (!node.isInline) return;
                for (const mark of node.marks) {
                  const id = String(mark.attrs.id);
                  if (isAnnotationMark(mark, type) && (outside.has(id) || (known && !known.has(id)))) {
                    tr.removeMark(Math.max(position, from), Math.min(position + node.nodeSize, to), mark);
                  }
                }
              });
            }
          }
          let extendedInlineMarks = false;
          for (const markType of [type, state.schema.marks[KNOWRA_MARK]].filter(Boolean)) {
            // 带重点的复制/移动有自己的独立范围，不能再用目标代码块原重点覆盖副本。
            if (
              markType.name === KNOWRA_MARK &&
              (copiedMarks || (clipboard && moving) || transactions.some(isHistoryTransaction))
            )
              continue;
            if (!transactions.some(transaction => transaction.docChanged)) continue;
            const before = fullyMarkedCodeBlocks(oldState.doc, markType);
            const previousSteps = tr.steps.length;
            if (before.size) {
              tr.doc.descendants((node, position) => {
                if (node.type.name !== 'code_block') return true;
                const previous = before.get(node.attrs.blockId);
                // 仅正文变化继承，取消、改级别、重选等纯标记事务必须保留用户意图。
                if (markType.name === KNOWRA_MARK && previous?.text === node.textContent) return false;
                if (previous && node.content.size)
                  for (const mark of previous.marks.values())
                    tr.addMark(position + 1, position + 1 + node.content.size, mark);
                return false;
              });
            }
            if (markType.name === KNOWRA_MARK && tr.steps.length > previousSteps) extendedInlineMarks = true;
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

export function stripAnnotationMarks(doc: ProseNode): ProseNode {
  const type = doc.type.schema.marks[ANNOTATION_MARK];
  if (!type) return doc;
  let found = false;
  doc.descendants(node => {
    if (!found && node.marks.some(mark => mark.type === type)) found = true;
    return !found;
  });
  return found ? new Transform(doc).removeMark(0, doc.content.size, type).doc : doc;
}

/** 去掉块 ID 与重点 mark 后的文档，用于和重新解析的 Markdown 比较"正文是否一致"。 */
export function withoutIdentity(doc: ProseNode): ProseNode {
  const tr = new Transform(stripAnnotationMarks(doc));
  tr.doc.descendants((node, position) => {
    if (node.attrs.blockId) tr.setNodeAttribute(position, 'blockId', null);
  });
  return tr.doc;
}

/**
 * 所有 Markdown 序列化（自动保存、getMarkdown、复制为 Markdown）都先剥离重点 mark。
 * mark 会把文本拆成多个节点，Milkdown 的代码块、行内代码和软换行序列化对此不安全。
 */
export const annotationSerializerGuard: MilkdownPlugin = ctx => async () => {
  await ctx.wait(SerializerReady);
  ctx.update(serializerCtx, serialize => (doc: ProseNode) => serialize(stripAnnotationMarks(doc)));
};

/** 导出 HTML 时去掉块身份属性与重点载体；序列化方式与 imageHtmlWithRenderedSizes 一致。 */
export function stripIdentityFromHtml(html: string): string {
  if (
    !html.includes('data-block-id') &&
    !html.includes('data-knowra-annotation') &&
    !html.includes('data-knowra-blocks')
  )
    return html;
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.body.querySelectorAll('[data-block-id]').forEach(element => element.removeAttribute('data-block-id'));
  parsed.body
    .querySelectorAll('[data-knowra-blocks]')
    .forEach(element => element.removeAttribute('data-knowra-blocks'));
  parsed.body
    .querySelectorAll('span[data-knowra-annotation]')
    .forEach(element => element.replaceWith(...element.childNodes));
  return Array.from(parsed.body.childNodes)
    .map(node => new XMLSerializer().serializeToString(node))
    .join('');
}

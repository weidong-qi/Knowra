import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { annotationPluginKey } from './editorAnnotations';
import type { TrackedAnnotationRange } from './annotationTransactionRanges';
import { listItemAt } from './editorListAnnotations';
import { ANNOTATION_MARK, IDENTITY_META } from './editorBlockIdentity';
import { adoptIdentityIds, calculateContentHash, EDITOR_TO_MARKDOWN_BLOCK, identityQuoteHash } from '@study-accelerator/content-anchor';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { AnnotationIdentityEditorState } from '@study-accelerator/web-core';
type IdentityPoint = NonNullable<AnnotationIdentityEditorState['annotations'][number]['start']>;

/**
 * 稳定身份迁移 S1（影子阶段）：为已定位的重点建立编辑器内身份，并与现有位置推算逐事务比对。
 * 结果只用于诊断，不改变高亮、保存或服务端跟随。
 */
export interface AnnotationIdentityBinding {
  scopeType: TrackedAnnotationRange['scopeType'];
  rootBlockId?: string;
  startBlockId?: string;
  endBlockId?: string;
}
export interface AnnotationShadowDivergence {
  annotationId: string;
  scopeType: TrackedAnnotationRange['scopeType'];
  /** rangeMismatch：两边都定位到但范围不同；trackedLost：现有推算丢失而身份仍在；identityLost：身份丢失而现有推算仍在。 */
  kind: 'rangeMismatch' | 'trackedLost' | 'identityLost';
  tracked: { from: number; to: number } | null;
  derived: { from: number; to: number } | null;
}
interface ShadowState {
  bindings: ReadonlyMap<string, AnnotationIdentityBinding>;
  divergences: readonly AnnotationShadowDivergence[];
  /** 每条重点最近一次的比对结论，只在结论变化时记录新的分歧。 */
  latest: ReadonlyMap<string, AnnotationShadowDivergence['kind'] | null>;
}
interface ShadowMeta { reset?: boolean; bindings?: Array<[string, AnnotationIdentityBinding]>; divergences?: AnnotationShadowDivergence[]; latest?: Array<[string, AnnotationShadowDivergence['kind'] | null]> }

export const annotationShadowKey = new PluginKey<ShadowState>('KNOWRA_ANNOTATION_SHADOW');
const MAX_DIVERGENCES = 50;

function blockPosition(doc: ProseNode, blockId: string) {
  let found: { node: ProseNode; position: number } | null = null;
  doc.descendants((node, position) => {
    if (found) return false;
    if (node.attrs.blockId === blockId) found = { node, position };
  });
  return found as { node: ProseNode; position: number } | null;
}

function textblockIdAt(doc: ProseNode, position: number, bias: -1 | 1) {
  // 现有推算的块范围端点可能落在块边界外侧一格，向范围内侧找最近的文本块。
  for (const candidate of [position, position + bias]) {
    if (candidate < 0 || candidate > doc.content.size) continue;
    const resolved = doc.resolve(candidate);
    if (resolved.parent.isTextblock) return resolved.parent.attrs.blockId as string | null;
  }
  return null;
}

export function bindingForRange(doc: ProseNode, range: TrackedAnnotationRange): AnnotationIdentityBinding | null {
  if (range.scopeType === 'selection') return { scopeType: 'selection' };
  if (range.scopeType === 'section') {
    const heading = range.from > 0 ? doc.nodeAt(range.from - 1) : null;
    return heading?.type.name === 'heading' && heading.attrs.blockId ? { scopeType: 'section', rootBlockId: heading.attrs.blockId } : null;
  }
  if (range.scopeType === 'list') {
    const id = listItemAt(doc, range.from)?.node.attrs.blockId as string | undefined;
    return id ? { scopeType: 'list', rootBlockId: id } : null;
  }
  const startBlockId = textblockIdAt(doc, range.from, 1), endBlockId = textblockIdAt(doc, range.to, -1);
  return startBlockId && endBlockId ? { scopeType: 'blocks', startBlockId, endBlockId } : null;
}

/** 只依据身份（mark 或块 ID）重新计算范围，规则与现有 `mapAnnotationRange` 的输出口径一致。 */
export function deriveIdentityRange(doc: ProseNode, annotationId: string, binding: AnnotationIdentityBinding): { from: number; to: number } | null {
  if (binding.scopeType === 'selection') {
    let from = -1, to = -1;
    doc.descendants((node, position) => {
      if (!node.isInline || !node.marks.some(mark => mark.type.name === ANNOTATION_MARK && mark.attrs.id === annotationId)) return;
      if (from < 0) from = position;
      to = position + node.nodeSize;
    });
    return from < 0 ? null : { from, to };
  }
  if (binding.scopeType === 'blocks') {
    const start = blockPosition(doc, binding.startBlockId!), end = blockPosition(doc, binding.endBlockId!);
    if (!start || !end || end.position < start.position) return null;
    return { from: start.position + 1, to: end.position + end.node.nodeSize - 1 };
  }
  const root = blockPosition(doc, binding.rootBlockId!);
  if (!root) return null;
  if (binding.scopeType === 'list') return { from: root.position + 1, to: root.position + root.node.nodeSize - 1 };
  if (root.node.type.name !== 'heading') return null;
  const level = Number(root.node.attrs.level);
  let boundary: number | null = null;
  doc.descendants((node, position) => {
    if (boundary === null && position > root.position && node.type.name === 'heading' && Number(node.attrs.level) <= level) boundary = position;
  });
  return { from: root.position + 1, to: boundary ?? doc.content.size };
}

function hasAnnotationMark(doc: ProseNode, annotationId: string) {
  let found = false;
  doc.descendants(node => {
    if (!found && node.marks.some(mark => mark.type.name === ANNOTATION_MARK && mark.attrs.id === annotationId)) found = true;
    return !found;
  });
  return found;
}

/** 选区比较精确位置；块、章节、列表比较两边指向的块 ID，避免端点口径差异。 */
function sameTarget(doc: ProseNode, binding: AnnotationIdentityBinding, tracked: TrackedAnnotationRange, derived: { from: number; to: number }) {
  if (binding.scopeType === 'selection') return tracked.from === derived.from && tracked.to === derived.to;
  const current = bindingForRange(doc, tracked);
  return Boolean(current) && current!.rootBlockId === binding.rootBlockId
    && current!.startBlockId === binding.startBlockId && current!.endBlockId === binding.endBlockId;
}

export function getAnnotationShadowReport(state: EditorState) {
  const shadow = annotationShadowKey.getState(state);
  return { bindings: new Map(shadow?.bindings ?? []), divergences: [...(shadow?.divergences ?? [])] };
}

export const annotationShadowBehavior = $prose(() => new Plugin<ShadowState>({
  key: annotationShadowKey,
  state: {
    init: () => ({ bindings: new Map(), divergences: [], latest: new Map() }),
    apply(transaction, previous) {
      const meta = transaction.getMeta(annotationShadowKey) as ShadowMeta | undefined;
      if (!meta) return previous;
      // 整篇替换或沿用服务端块身份后，旧绑定指向的 ID 已不存在：清空后按新 ID 重新绑定。
      const base = meta.reset ? { ...previous, bindings: new Map(), latest: new Map() } : previous;
      return {
        bindings: meta.bindings ? new Map([...base.bindings, ...meta.bindings]) : base.bindings,
        divergences: meta.divergences ? [...base.divergences, ...meta.divergences].slice(-MAX_DIVERGENCES) : base.divergences,
        latest: meta.latest ? new Map([...base.latest, ...meta.latest]) : base.latest
      };
    }
  },
  appendTransaction(transactions, _oldState, state) {
    const annotations = annotationPluginKey.getState(state);
    const shadow = annotationShadowKey.getState(state);
    if (!annotations || !shadow) return null;
    const markType = state.schema.marks[ANNOTATION_MARK];
    const tr = state.tr;
    const bindings: Array<[string, AnnotationIdentityBinding]> = [];
    for (const annotation of annotations.annotations) {
      const tracked = annotations.ranges.get(annotation.id);
      if (shadow.bindings.has(annotation.id) || !tracked || tracked.missing || tracked.needsReview || tracked.from >= tracked.to) continue;
      const binding = bindingForRange(state.doc, tracked);
      if (!binding) continue;
      if (binding.scopeType === 'selection') {
        if (!markType) continue;
        if (!hasAnnotationMark(tr.doc, annotation.id)) tr.addMark(tracked.from, tracked.to, markType.create({ id: annotation.id }));
      }
      bindings.push([annotation.id, binding]);
    }
    const divergences: AnnotationShadowDivergence[] = [];
    const latest: Array<[string, AnnotationShadowDivergence['kind'] | null]> = [];
    if (transactions.some(transaction => transaction.docChanged && !transaction.getMeta(IDENTITY_META))) {
      for (const [annotationId, binding] of shadow.bindings) {
        const tracked = annotations.ranges.get(annotationId);
        if (!tracked || tracked.needsReview) continue;
        const derived = deriveIdentityRange(state.doc, annotationId, binding);
        const trackedRange = tracked.missing ? null : { from: tracked.from, to: tracked.to };
        const kind = trackedRange && derived
          ? (sameTarget(state.doc, binding, tracked, derived) ? null : 'rangeMismatch')
          : trackedRange ? 'identityLost' : derived ? 'trackedLost' : null;
        if ((shadow.latest.get(annotationId) ?? null) === kind) continue;
        latest.push([annotationId, kind]);
        if (kind) divergences.push({ annotationId, scopeType: binding.scopeType, kind, tracked: trackedRange, derived });
      }
    }
    if (!bindings.length && !latest.length) return null;
    return tr.setMeta(annotationShadowKey, { bindings, divergences, latest } satisfies ShadowMeta)
      .setMeta(IDENTITY_META, true).setMeta('addToHistory', false);
  }
}));

/** 保存时随正文提交的身份快照；捕获不可变文档与绑定，到真正保存时才计算。 */
export interface AnnotationIdentitySnapshot { markdown: string; build(): AnnotationIdentityEditorState }

function editorIdentityEntries(doc: ProseNode) {
  const entries: Array<AnnotationIdentityEditorState['blocks'][number] & { position: number }> = [];
  doc.descendants((node, position) => {
    const type = EDITOR_TO_MARKDOWN_BLOCK[node.type.name];
    if (type && node.attrs.blockId) entries.push({ id: node.attrs.blockId, type, empty: node.type.name === 'paragraph' && node.content.size === 0, position });
    // 与服务端一致：表格整体参与对齐，单元格内部不展开。
    return node.type.name !== 'table';
  });
  return entries;
}

function editorIdentityBlocks(doc: ProseNode): AnnotationIdentityEditorState['blocks'] {
  return editorIdentityEntries(doc).map(({ id, type, empty }) => ({ id, type, empty }));
}

/**
 * 加载笔记或整篇替换正文后调用：身份表与正文对应时沿用服务端块 ID；无论是否沿用，都重置影子绑定。
 * 返回是否沿用了身份表。只改身份，不进入撤销历史，也不触发保存。
 */
export function applyBlockIdentity(view: EditorView, markdown: string, identity: unknown): boolean {
  const entries = editorIdentityEntries(view.state.doc);
  const adopted = identity ? adoptIdentityIds(markdown, identity, entries) : null;
  const tr = view.state.tr;
  for (const [index, id] of adopted ?? []) {
    if (entries[index].id !== id) tr.setNodeAttribute(entries[index].position, 'blockId', id);
  }
  view.dispatch(tr.setMeta(annotationShadowKey, { reset: true } satisfies ShadowMeta).setMeta(IDENTITY_META, true).setMeta('addToHistory', false));
  return Boolean(adopted);
}

/** 服务端把表格作为整体对齐：单元格内的块统一报告为所在表格的 ID。 */
function alignedBlockId(doc: ProseNode, blockId: string | null): string | undefined {
  if (!blockId) return undefined;
  const found = blockPosition(doc, blockId);
  if (!found) return blockId;
  const resolved = doc.resolve(found.position);
  for (let depth = 1; depth <= resolved.depth; depth++) {
    const ancestor = resolved.node(depth);
    if (ancestor.type.name === 'table') return ancestor.attrs.blockId ?? blockId;
  }
  return blockId;
}

/** 块内位置：文本块 ID 与内容偏移；表格内为表格 ID 加单元格 [行, 列]，与服务端块内偏移模型同一口径。 */
function identityPoint(doc: ProseNode, position: number): IdentityPoint | undefined {
  const resolved = doc.resolve(Math.max(0, Math.min(position, doc.content.size)));
  if (!resolved.parent.isTextblock) return undefined;
  for (let depth = 1; depth < resolved.depth; depth += 1) {
    const ancestor = resolved.node(depth);
    if (ancestor.type.name !== 'table') continue;
    const blockId = ancestor.attrs.blockId as string | null;
    // 表格 → 行 → 单元格 → 段落
    if (!blockId || resolved.depth !== depth + 3) return undefined;
    return { blockId, offset: position - resolved.start(), cell: [resolved.index(depth), resolved.index(depth + 1)] };
  }
  const blockId = resolved.parent.attrs.blockId as string | null;
  return blockId ? { blockId, offset: position - resolved.start() } : undefined;
}

export function buildIdentityEditorState(doc: ProseNode, bindings: ReadonlyMap<string, AnnotationIdentityBinding>, markdown: string): AnnotationIdentityEditorState {
  const annotations: AnnotationIdentityEditorState['annotations'] = [];
  for (const [id, binding] of bindings) {
    const derived = deriveIdentityRange(doc, id, binding);
    const item: AnnotationIdentityEditorState['annotations'][number] = { id, scopeType: binding.scopeType, present: Boolean(derived) };
    if (binding.scopeType === 'selection') {
      if (derived) {
        item.startBlockId = alignedBlockId(doc, textblockIdAt(doc, derived.from, 1));
        item.endBlockId = alignedBlockId(doc, textblockIdAt(doc, derived.to, -1));
        item.quoteHash = identityQuoteHash(doc.textBetween(derived.from, derived.to, '\n', '\uFFFC'));
        item.start = identityPoint(doc, derived.from);
        item.end = identityPoint(doc, derived.to);
      }
    } else if (binding.scopeType === 'blocks') {
      item.startBlockId = alignedBlockId(doc, binding.startBlockId ?? null);
      item.endBlockId = alignedBlockId(doc, binding.endBlockId ?? null);
    } else item.rootBlockId = binding.rootBlockId;
    annotations.push(item);
  }
  return { formatVersion: 2, targetContentHash: calculateContentHash(markdown), blocks: editorIdentityBlocks(doc), annotations };
}

export function captureIdentitySnapshot(state: EditorState, markdown: string): AnnotationIdentitySnapshot | undefined {
  // 没有重点时也要捕获：块身份表（S2b）随每次保存持久化，不依赖笔记里是否有重点。
  const bindings = annotationShadowKey.getState(state)?.bindings ?? new Map<string, AnnotationIdentityBinding>();
  const doc = state.doc;
  return { markdown, build: () => buildIdentityEditorState(doc, bindings, markdown) };
}

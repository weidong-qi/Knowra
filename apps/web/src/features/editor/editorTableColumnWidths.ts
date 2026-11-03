import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

/**
 * 列宽只是本机视图状态：Markdown/GFM 没有列宽，因此不写入文档，也不进入撤销历史。
 * 以 笔记 + 唯一表头文字指纹 为键存比例（总和 1）；表头改名后该表恢复自动列宽。
 * 重复表头无法跨加载可靠区分，仅按映射后的文档位置保留本次会话列宽。
 */
export const TABLE_MIN_COLUMN_PX = 56;
const STORAGE_PREFIX = 'knowra:table-column-widths:v1:';
type WidthMap = Record<string, number[]>;
interface AppliedWidth { fingerprint: string; ratios: number[] | null }
interface WidthState { applied: Map<number, AppliedWidth>; committed: WidthMap }
const widthsKey = new PluginKey<WidthState>('knowraTableColumnWidths');

export function tableFingerprint(table: ProseNode): string {
  const header = table.firstChild;
  const labels: string[] = [];
  header?.forEach(cell => labels.push(cell.textContent));
  return `${labels.length}:${labels.join('\u0001')}`;
}

function readStored(noteId: string): WidthMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + noteId);
    const parsed = raw ? JSON.parse(raw) as unknown : null;
    if (!parsed || typeof parsed !== 'object') return {};
    const clean: WidthMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'number' && Number.isFinite(item) && item > 0)) clean[key] = value as number[];
    }
    return clean;
  } catch { return {}; }
}
function writeStored(noteId: string, map: WidthMap) {
  try {
    if (Object.keys(map).length) window.localStorage.setItem(STORAGE_PREFIX + noteId, JSON.stringify(map));
    else window.localStorage.removeItem(STORAGE_PREFIX + noteId);
  } catch { /* 隐私模式或存储不可用时只保留本次会话内的视图状态。 */ }
}

/** 归一化为总和 1，并保证每列不小于最小宽度（按表格当前像素宽度折算）。 */
export function normalizeRatios(widths: number[], tablePx: number): number[] {
  const total = widths.reduce((sum, value) => sum + value, 0);
  const min = Math.min(TABLE_MIN_COLUMN_PX / Math.max(tablePx, 1), 1 / widths.length);
  const ratios = widths.map(value => value / total);
  const pinned = new Set<number>();
  // 低于下限的列固定在下限，其余列按原比例分剩余宽度；重复直到没有新的越界列。
  for (let round = 0; round < widths.length; round++) {
    const free = ratios.map((_, index) => index).filter(index => !pinned.has(index));
    const freeTotal = free.reduce((sum, index) => sum + widths[index], 0);
    const remaining = 1 - pinned.size * min;
    let changed = false;
    for (const index of free) {
      ratios[index] = widths[index] / freeTotal * remaining;
      if (ratios[index] < min) { pinned.add(index); changed = true; }
    }
    for (const index of pinned) ratios[index] = min;
    if (!changed) break;
  }
  return ratios;
}

export interface TableWidthChange { tablePos: number; fingerprint: string; ratios: number[] | null; commit: boolean }

/** 通过事务通知插件更新列宽；commit=false 仅预览，不写入本机存储。 */
export function setTableColumnWidths(view: EditorView, change: TableWidthChange) {
  view.dispatch(view.state.tr.setMeta(widthsKey, change).setMeta('addToHistory', false));
}

export function findTableAtDom(view: EditorView, table: Element): { node: ProseNode; pos: number } | null {
  const $pos = view.state.doc.resolve(view.posAtDOM(table, 0));
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === 'table') return { node, pos: $pos.before(depth) };
  }
  return null;
}

function isUniqueFingerprint(doc: ProseNode, fingerprint: string): boolean {
  let count = 0;
  doc.descendants(node => {
    if (node.type.name !== 'table') return;
    if (tableFingerprint(node) === fingerprint) count++;
    return false;
  });
  return count === 1;
}

function tableAt(doc: ProseNode, pos: number): ProseNode | null {
  if (!Number.isInteger(pos) || pos < 0 || pos >= doc.content.size) return null;
  const node = doc.nodeAt(pos);
  return node?.type.name === 'table' ? node : null;
}

function appliedRatios(state: EditorState, tablePos: number): number[] | null {
  const widths = widthsKey.getState(state);
  const table = tableAt(state.doc, tablePos);
  if (!widths || table?.type.name !== 'table') return null;
  const fingerprint = tableFingerprint(table);
  const applied = widths.applied.get(tablePos);
  const ratios = applied?.fingerprint === fingerprint ? applied.ratios
    : isUniqueFingerprint(state.doc, fingerprint) ? widths.committed[fingerprint] : null;
  return ratios?.length === table.firstChild?.childCount ? ratios : null;
}

/** 读取当前实际应用的比例；null 表示自动列宽。返回副本，供取消预览时恢复。 */
export function getTableColumnWidths(view: Pick<EditorView, 'state'>, tablePos: number): number[] | null {
  return appliedRatios(view.state, tablePos)?.slice() ?? null;
}

/** 原生插件入口，也便于用真实 ProseMirror 状态验证预览和提交。 */
export function createTableColumnWidthsPlugin(noteId: string): Plugin<WidthState> {
  return new Plugin<WidthState>({
    key: widthsKey,
    state: {
      init: () => ({ applied: new Map(), committed: readStored(noteId) }),
      apply(tr, value) {
        let applied = value.applied;
        if (tr.docChanged) {
          applied = new Map();
          for (const [pos, width] of value.applied) {
            const mapped = tr.mapping.mapResult(pos, 1);
            const table = tableAt(tr.doc, mapped.pos);
            if (!mapped.deleted && table?.type.name === 'table' && tableFingerprint(table) === width.fingerprint) {
              applied.set(mapped.pos, width);
            }
          }
        }
        const change = tr.getMeta(widthsKey) as TableWidthChange | undefined;
        if (!change) return applied === value.applied ? value : { ...value, applied };
        const table = tableAt(tr.doc, change.tablePos);
        if (table?.type.name !== 'table' || tableFingerprint(table) !== change.fingerprint) return { ...value, applied };
        applied = new Map(applied);
        applied.set(change.tablePos, { fingerprint: change.fingerprint, ratios: change.ratios?.slice() ?? null });
        // 仅提交目标表格，不把其它表格尚未确认的预览写入存储。
        let committed = value.committed;
        if (change.commit) {
          committed = { ...committed };
          if (change.ratios && isUniqueFingerprint(tr.doc, change.fingerprint)) committed[change.fingerprint] = change.ratios.slice();
          else delete committed[change.fingerprint];
          writeStored(noteId, committed);
        }
        return { applied, committed };
      }
    },
    props: {
      decorations(state: EditorState) {
        const decorations: Decoration[] = [];
        state.doc.descendants((block, offset) => {
          if (block.type.name !== 'table') return;
          const ratios = appliedRatios(state, offset);
          const header = block.firstChild;
          if (!ratios || !header) return;
          decorations.push(Decoration.node(offset, offset + block.nodeSize, { 'data-col-widths': 'true' }));
          const cellPos = offset + 2;
          header.forEach((cell, cellOffset, index) => {
            decorations.push(Decoration.node(cellPos + cellOffset, cellPos + cellOffset + cell.nodeSize, { style: `--col-width: ${(ratios[index] * 100).toFixed(3)}%` }));
          });
          return false;
        });
        return decorations.length ? DecorationSet.create(state.doc, decorations) : null;
      }
    }
  });
}

export function createTableColumnWidths(noteId: string) {
  return $prose(() => createTableColumnWidthsPlugin(noteId));
}

/** 拖动第 index 列右边界 deltaPx：只在相邻两列间转移宽度，各列不小于最小宽度。 */
export function resizeColumns(ratios: number[], index: number, deltaPx: number, tablePx: number): number[] {
  if (index < 0 || index >= ratios.length - 1 || tablePx <= 0) return ratios;
  const pair = (ratios[index] + ratios[index + 1]) * tablePx;
  const min = Math.min(TABLE_MIN_COLUMN_PX, pair / 2);
  const left = Math.min(pair - min, Math.max(min, ratios[index] * tablePx + deltaPx));
  const next = ratios.slice();
  next[index] = left / tablePx;
  next[index + 1] = (pair - left) / tablePx;
  return next;
}

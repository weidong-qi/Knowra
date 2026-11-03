import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorState } from '@milkdown/kit/prose/state';
import { EditorView } from '@milkdown/kit/prose/view';
import { Schema } from '@milkdown/kit/prose/model';
import { createTableColumnWidthsPlugin, getTableColumnWidths, normalizeRatios, resizeColumns, setTableColumnWidths, tableFingerprint, TABLE_MIN_COLUMN_PX } from './editorTableColumnWidths';

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

describe('表格列宽（本机视图状态）', () => {
  it('拖动边界只在相邻两列间转移宽度，总和不变', () => {
    const next = resizeColumns([0.25, 0.25, 0.5], 0, 100, 1000);
    expect(next[0]).toBeCloseTo(0.35);
    expect(next[1]).toBeCloseTo(0.15);
    expect(next[2]).toBe(0.5);
    expect(sum(next)).toBeCloseTo(1);
  });
  it('各列不小于最小宽度，最后一列边界与越界下标不处理', () => {
    const next = resizeColumns([0.5, 0.5], 0, 10_000, 1000);
    expect(next[1] * 1000).toBeCloseTo(TABLE_MIN_COLUMN_PX);
    expect(resizeColumns([0.5, 0.5], 1, 50, 1000)).toEqual([0.5, 0.5]);
    expect(resizeColumns([0.5, 0.5], -1, 50, 1000)).toEqual([0.5, 0.5]);
  });
  it('归一化后总和为 1 且满足最小宽度', () => {
    const ratios = normalizeRatios([1, 1, 200], 600);
    expect(sum(ratios)).toBeCloseTo(1);
    expect(Math.min(...ratios) * 600).toBeGreaterThanOrEqual(TABLE_MIN_COLUMN_PX - 0.001);
  });
  it('指纹由表头文字与列数决定', () => {
    const schema = new Schema({ nodes: {
      doc: { content: 'table' }, table: { content: 'row' }, row: { content: 'cell+' }, cell: { content: 'text*' }, text: {}
    } });
    const table = (...labels: string[]) => schema.node('table', null, [schema.node('row', null, labels.map(label => schema.node('cell', null, label ? schema.text(label) : undefined)))]);
    expect(tableFingerprint(table('名称', '数量'))).toBe(tableFingerprint(table('名称', '数量')));
    expect(tableFingerprint(table('名称', '数量'))).not.toBe(tableFingerprint(table('名称', '单价')));
    expect(tableFingerprint(table('名称'))).not.toBe(tableFingerprint(table('名称', '')));
  });
});

const pluginSchema = new Schema({ nodes: {
  doc: { content: '(table | paragraph | blockquote)+' },
  blockquote: { content: '(table | paragraph)+', toDOM: () => ['blockquote', 0] },
  paragraph: { content: 'text*', toDOM: () => ['p', 0] },
  table: { content: 'row+', toDOM: () => ['table', ['tbody', 0]] },
  row: { content: 'cell+', toDOM: () => ['tr', 0] },
  cell: { content: 'text*', toDOM: () => ['th', 0] },
  text: {}
} });
const makeTable = (...labels: string[]) => pluginSchema.node('table', null, [pluginSchema.node('row', null,
  labels.map(label => pluginSchema.node('cell', null, label ? pluginSchema.text(label) : undefined)))]);
const storageKey = 'knowra:table-column-widths:v1:test-note';
const views: EditorView[] = [];
const makeView = (...tables: ReturnType<typeof makeTable>[]) => {
  const view = new EditorView(document.createElement('div'), {
    state: EditorState.create({ doc: pluginSchema.node('doc', null, tables), plugins: [createTableColumnWidthsPlugin('test-note')] })
  });
  views.push(view);
  return view;
};
const changeWidth = (view: EditorView, tablePos: number, ratios: number[] | null, commit = false) => {
  const table = view.state.doc.nodeAt(tablePos)!;
  setTableColumnWidths(view, { tablePos, fingerprint: tableFingerprint(table), ratios, commit });
};
const readStorage = () => JSON.parse(window.localStorage.getItem(storageKey) ?? '{}');

describe('真实 ProseMirror 列宽插件', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => { for (const view of views.splice(0)) view.destroy(); });

  it('取消预览恢复已保存比例，刷新前后相同，不改变文档', () => {
    const table = makeTable('名称', '数量');
    window.localStorage.setItem(storageKey, JSON.stringify({ [tableFingerprint(table)]: [0.3, 0.7] }));
    const view = makeView(table);
    const originalDoc = view.state.doc;
    const start = getTableColumnWidths(view, 0);
    expect(start).toEqual([0.3, 0.7]);
    changeWidth(view, 0, [0.6, 0.4]);
    expect(view.dom.querySelector('th')?.style.getPropertyValue('--col-width')).toBe('60.000%');
    changeWidth(view, 0, start);
    expect(getTableColumnWidths(view, 0)).toEqual([0.3, 0.7]);
    expect(view.dom.querySelector('th')?.style.getPropertyValue('--col-width')).toBe('30.000%');
    expect(getTableColumnWidths(makeView(table), 0)).toEqual(start);
    expect(view.state.doc).toBe(originalDoc);
  });

  it('自动列宽的预览取消恢复自动布局而非冻结测量值', () => {
    const view = makeView(makeTable('名称', '数量'));
    const start = getTableColumnWidths(view, 0);
    expect(start).toBeNull();
    changeWidth(view, 0, [0.4, 0.6]);
    expect(view.dom.querySelector('table')?.getAttribute('data-col-widths')).toBe('true');
    changeWidth(view, 0, start);
    expect(getTableColumnWidths(view, 0)).toBeNull();
    expect(view.dom.querySelector('table')?.hasAttribute('data-col-widths')).toBe(false);
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it('提交或重置一张表不会持久化其它表的未提交预览', () => {
    const first = makeTable('名称', '数量');
    const second = makeTable('项目', '金额');
    const view = makeView(first, second);
    changeWidth(view, 0, [0.2, 0.8]);
    changeWidth(view, first.nodeSize, [0.6, 0.4], true);
    expect(readStorage()).toEqual({ [tableFingerprint(second)]: [0.6, 0.4] });
    expect(getTableColumnWidths(view, 0)).toEqual([0.2, 0.8]);
    changeWidth(view, first.nodeSize, null, true);
    expect(readStorage()).toEqual({});
    expect(getTableColumnWidths(makeView(first, second), 0)).toBeNull();
  });

  it('同名表头不回读有歧义的保存值，调整只作用于目标表且仅保留本次会话', () => {
    const table = makeTable('名称', '数量');
    window.localStorage.setItem(storageKey, JSON.stringify({ [tableFingerprint(table)]: [0.3, 0.7] }));
    const view = makeView(table, table);
    expect(getTableColumnWidths(view, 0)).toBeNull();
    expect(getTableColumnWidths(view, table.nodeSize)).toBeNull();
    changeWidth(view, table.nodeSize, [0.6, 0.4], true);
    expect(getTableColumnWidths(view, 0)).toBeNull();
    expect(getTableColumnWidths(view, table.nodeSize)).toEqual([0.6, 0.4]);
    expect(view.dom.querySelectorAll('table')[0].hasAttribute('data-col-widths')).toBe(false);
    expect(view.dom.querySelectorAll('table')[1].getAttribute('data-col-widths')).toBe('true');
    expect(readStorage()).toEqual({});
    expect(getTableColumnWidths(makeView(table, table), table.nodeSize)).toBeNull();
  });

  it('前方插入内容后会话列宽跟随原表，删除原表后不转移给另一同名表', () => {
    const table = makeTable('名称', '数量');
    const view = makeView(table, table);
    changeWidth(view, table.nodeSize, [0.6, 0.4]);
    const paragraph = pluginSchema.node('paragraph', null, pluginSchema.text('前言'));
    view.dispatch(view.state.tr.insert(0, paragraph));
    const secondPos = paragraph.nodeSize + table.nodeSize;
    expect(getTableColumnWidths(view, secondPos)).toEqual([0.6, 0.4]);
    expect(getTableColumnWidths(view, paragraph.nodeSize)).toBeNull();
    view.dispatch(view.state.tr.delete(secondPos, secondPos + table.nodeSize));
    expect(getTableColumnWidths(view, paragraph.nodeSize)).toBeNull();
  });

  it('引用块中的表格正常应用列宽，并纳入重复表头判断', () => {
    const table = makeTable('名称', '数量');
    const quote = pluginSchema.node('blockquote', null, table);
    const view = makeView(quote);
    changeWidth(view, 1, [0.3, 0.7], true);
    expect(view.dom.querySelector<HTMLElement>('blockquote th')?.style.getPropertyValue('--col-width')).toBe('30.000%');
    expect(getTableColumnWidths(makeView(quote), 1)).toEqual([0.3, 0.7]);
    const duplicates = makeView(quote, table);
    expect(getTableColumnWidths(duplicates, 1)).toBeNull();
    expect(getTableColumnWidths(duplicates, quote.nodeSize)).toBeNull();
  });

  it('原表删除后的过期通知与越界读取安全忽略', () => {
    const table = makeTable('名称', '数量');
    const view = makeView(pluginSchema.node('paragraph'), table);
    view.dispatch(view.state.tr.delete(2, 2 + table.nodeSize));
    expect(() => setTableColumnWidths(view, { tablePos: 2 + table.nodeSize, fingerprint: tableFingerprint(table), ratios: [0.3, 0.7], commit: true })).not.toThrow();
    expect(getTableColumnWidths(view, 2 + table.nodeSize)).toBeNull();
    expect(readStorage()).toEqual({});
  });

  it('表头改名后丢弃旧预览，读取和写入均隔离外部数组修改', () => {
    const view = makeView(makeTable('名称', '数量'));
    const input = [0.3, 0.7];
    changeWidth(view, 0, input);
    input[0] = 1;
    const snapshot = getTableColumnWidths(view, 0)!;
    snapshot[1] = 1;
    expect(getTableColumnWidths(view, 0)).toEqual([0.3, 0.7]);
    view.dispatch(view.state.tr.insertText('新', 3));
    expect(getTableColumnWidths(view, 0)).toBeNull();
  });
});

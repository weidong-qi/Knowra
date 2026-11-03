import { it, expect, vi } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState } from '@milkdown/kit/prose/state';
import { EditorView } from '@milkdown/kit/prose/view';
import { tableNodes } from '@milkdown/kit/prose/tables';
import { startTableResize } from './editorTableInteractions';
import { createTableColumnWidthsPlugin, getTableColumnWidths, setTableColumnWidths, tableFingerprint } from './editorTableColumnWidths';

it('表格前方插入文字后取消列宽仍恢复原比例', () => {
  const nodes = tableNodes({ tableGroup: 'block', cellContent: 'paragraph', cellAttributes: {} });
  const schema = new Schema({ nodes: {
    doc: { content: 'block+' }, paragraph: { group: 'block', content: 'text*', toDOM: () => ['p', 0] }, text: {}, ...nodes
  } });
  const paragraph = (text: string) => schema.node('paragraph', null, schema.text(text));
  const table = schema.node('table', null, [
    schema.node('table_row', null, ['A', 'B'].map(text => schema.node('table_header', null, paragraph(text)))),
    schema.node('table_row', null, ['a', 'b'].map(text => schema.node('table_cell', null, paragraph(text))))
  ]);
  const root = document.body.appendChild(document.createElement('div'));
  const view = new EditorView(root, {
    state: EditorState.create({ schema, doc: schema.node('doc', null, [paragraph('x'), table]), plugins: [createTableColumnWidthsPlugin('cancel-audit')] }),
    handleScrollToSelection: () => true
  });
  try {
    setTableColumnWidths(view, { tablePos: 3, fingerprint: tableFingerprint(table), ratios: [.5, .5], commit: true });
    const dom = view.dom.querySelector('table')!;
    vi.spyOn(dom, 'getBoundingClientRect').mockReturnValue({ width: 400 } as DOMRect);
    Array.from(dom.rows[0].cells).forEach(cell => vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue({ width: 200 } as DOMRect));
    startTableResize(new PointerEvent('pointerdown', { button: 0, pointerId: 1, clientX: 200 }), {
      getView: () => view, table: dom, index: 0, onEnd: () => {}
    });
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 240 }));
    expect(getTableColumnWidths(view, 3)).toEqual([.6, .4]);
    view.dispatch(view.state.tr.insertText('prefix', 1));
    window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));
    expect(getTableColumnWidths(view, 9)).toEqual([.5, .5]);
  } finally {
    view.destroy(); root.remove(); localStorage.clear();
  }
});

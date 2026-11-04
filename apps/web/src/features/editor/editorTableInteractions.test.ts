import { afterEach, describe, expect, it, vi } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { EditorView } from '@milkdown/kit/prose/view';
import { tableNodes } from '@milkdown/kit/prose/tables';
import { isCurrentTableContext, startTableDrag, trackTablePointer } from './editorTableInteractions';

const nodes = tableNodes({ tableGroup: 'block', cellContent: 'paragraph', cellAttributes: {} });
const schema = new Schema({ nodes: { doc: { content: 'block+' }, paragraph: { group: 'block', content: 'text*', toDOM: () => ['p', 0] }, text: {}, ...nodes } });
const views: EditorView[] = [];
afterEach(() => { views.splice(0).forEach(view => view.destroy()); document.body.innerHTML = ''; });
function fixture() {
  const p = (text: string) => schema.node('paragraph', null, schema.text(text));
  const table = (prefix: string) => schema.node('table', null, ['头', '甲', '乙'].map((label, index) => schema.node('table_row', null, [schema.node(index ? 'table_cell' : 'table_header', null, p(prefix + label))])));
  const host = document.body.appendChild(document.createElement('div'));
  const view = new EditorView(host, { state: EditorState.create({ schema, doc: schema.node('doc', null, [table('A'), table('B')]) }), handleScrollToSelection: () => true });
  views.push(view);
  const tables = Array.from(view.dom.querySelectorAll('table'));
  tables.forEach((table, ti) => Array.from(table.rows).forEach((row, ri) => {
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ top: ti * 200 + ri * 40, bottom: ti * 200 + (ri + 1) * 40 } as DOMRect);
  }));
  return { view, tables };
}
function pointer(type: string, pointerId = 1, clientY = 100) {
  return new PointerEvent(type, { pointerId, clientX: 5, clientY, button: 0 });
}

describe('表格手势身份与生命周期', () => {
  it('跨表松开仍只重排起始表', () => {
    const { view, tables } = fixture();
    const end = vi.fn();
    startTableDrag(pointer('pointerdown', 1, 50), { getView: () => view, table: tables[0], kind: 'row', from: 1, onDrag: vi.fn(), onEnd: end });
    window.dispatchEvent(pointer('pointermove', 1, 280));
    window.dispatchEvent(pointer('pointerup', 1, 280));
    expect(view.state.doc.child(0).textContent).toBe('A头A乙A甲');
    expect(view.state.doc.child(1).textContent).toBe('B头B甲B乙');
    expect(end).toHaveBeenCalledOnce();
  });
  it('拖动期间文档改变或切换视图后不提交', () => {
    const { view, tables } = fixture();
    startTableDrag(pointer('pointerdown', 1, 50), { getView: () => view, table: tables[0], kind: 'row', from: 1, onDrag: vi.fn(), onEnd: vi.fn() });
    window.dispatchEvent(pointer('pointermove', 1, 110));
    view.dispatch(view.state.tr.insertText('新', 4));
    const expected = view.state.doc;
    window.dispatchEvent(pointer('pointerup', 1, 110));
    expect(view.state.doc.eq(expected)).toBe(true);
    const context = { view, state: view.state };
    expect(isCurrentTableContext(() => fixture().view, context)).toBe(false);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 4)));
    expect(isCurrentTableContext(() => view, context)).toBe(false);
  });
  it.each(['pointercancel', 'blur', 'Escape'])('%s 取消手势，忽略其它指针并释放监听', reason => {
    const end = vi.fn(); const move = vi.fn();
    const cancel = trackTablePointer(1, { move, end });
    window.dispatchEvent(pointer('pointermove', 2)); window.dispatchEvent(pointer('pointerup', 2));
    expect(move).not.toHaveBeenCalled(); expect(end).not.toHaveBeenCalled();
    if (reason === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    else window.dispatchEvent(reason === 'blur' ? new Event('blur') : pointer('pointercancel'));
    window.dispatchEvent(pointer('pointermove')); window.dispatchEvent(pointer('pointerup')); cancel();
    expect(move).not.toHaveBeenCalled(); expect(end).toHaveBeenCalledExactlyOnceWith(false);
  });
});

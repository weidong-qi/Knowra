import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Editor, editorViewCtx } from '@milkdown/kit/core';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { EditorView } from '@milkdown/kit/prose/view';
import { runEditorClipboardAction } from './editorClipboard';
import { readClipboardText, writeClipboardText, runDocumentCommand } from '../../browser/clipboard';

vi.mock('../../browser/clipboard', () => ({ writeClipboardText: vi.fn(), readClipboardText: vi.fn(), runDocumentCommand: vi.fn() }));
const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*', toDOM: () => ['p', 0] }, text: {} } });
const views: EditorView[] = [];
afterEach(() => { views.forEach(view => { if (!view.isDestroyed) view.destroy(); }); views.length = 0; vi.resetAllMocks(); });
function fixture() {
  const view = new EditorView(document.body.appendChild(document.createElement('div')), { handleScrollToSelection: () => true, state: EditorState.create({ schema, doc: schema.node('doc', null, [schema.node('paragraph', null, schema.text('AAA BBB'))]) }) });
  views.push(view);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 4)));
  const editor = { ctx: { get: (key: unknown) => { if (key === editorViewCtx) return view; throw new Error('unexpected context'); } } } as unknown as Editor;
  let finish!: (success: boolean) => void;
  vi.mocked(writeClipboardText).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  return { view, editor, finish: (success = true) => finish(success) };
}
describe('真实 ProseMirror 异步剪切', () => {
  it('复制完成后只删除原来的稳定选区', async () => {
    const f = fixture(); const pending = runEditorClipboardAction(f.editor, 'cut');
    expect(writeClipboardText).toHaveBeenCalledWith('AAA'); f.finish();
    expect((await pending).ok).toBe(true); expect(f.view.state.doc.textContent).toBe(' BBB');
  });
  it.each(['selection', 'document', 'destroy', 'readonly'] as const)('等待剪贴板期间 %s 变化则不删除', async change => {
    const f = fixture(); const pending = runEditorClipboardAction(f.editor, 'cut');
    if (change === 'selection') f.view.dispatch(f.view.state.tr.setSelection(TextSelection.create(f.view.state.doc, 5, 8)));
    if (change === 'document') f.view.dispatch(f.view.state.tr.insertText('新', 8));
    if (change === 'destroy') f.view.destroy();
    if (change === 'readonly') f.view.setProps({ editable: () => false });
    const expected = f.view.state.doc.textContent; f.finish();
    expect((await pending).ok).toBe(false); expect(f.view.state.doc.textContent).toBe(expected);
    expect(runDocumentCommand).not.toHaveBeenCalled();
  });
  it('写入剪贴板失败且回退失败时保留原文', async () => {
    const f = fixture(); const pending = runEditorClipboardAction(f.editor, 'cut'); f.finish(false);
    expect((await pending).ok).toBe(false); expect(f.view.state.doc.textContent).toBe('AAA BBB');
  });
  it('笔记切换或权限变化使宿主取消删除，即使旧编辑器暂未销毁', async () => {
    const f = fixture(); let active = true;
    const pending = runEditorClipboardAction(f.editor, 'cut', () => active);
    active = false; f.finish();
    expect((await pending).ok).toBe(false); expect(f.view.state.doc.textContent).toBe('AAA BBB');
  });
  it('失败回退前选区变化也不能执行浏览器剪切命令', async () => {
    const f = fixture(); const pending = runEditorClipboardAction(f.editor, 'cut');
    f.view.dispatch(f.view.state.tr.setSelection(TextSelection.create(f.view.state.doc, 5, 8))); f.finish(false);
    expect((await pending).ok).toBe(false); expect(runDocumentCommand).not.toHaveBeenCalled();
  });
  it('异步读取富文本剪贴板时宿主切换不能粘到旧笔记', async () => {
    const f = fixture(); let active = true;
    let finish!: (value: { ok: true; text: string; html: string }) => void;
    vi.mocked(readClipboardText).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = runEditorClipboardAction(f.editor, 'paste', () => active);
    active = false; finish({ ok: true, text: '旧剪贴板', html: '' });
    expect(await pending).toEqual({ ok: false, reason: 'context-changed' });
    expect(f.view.state.doc.textContent).toBe('AAA BBB');
    expect(runDocumentCommand).not.toHaveBeenCalled();
  });
});

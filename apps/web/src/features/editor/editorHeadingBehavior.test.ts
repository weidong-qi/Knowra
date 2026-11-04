import { afterEach, describe, expect, it } from 'vitest';
import { Editor, defaultValueCtx, editorViewCtx, rootCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { history, undo, redo } from '@milkdown/kit/prose/history';
import { TextSelection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { editorInputBehavior } from './editorInputBehavior';

const editors: Editor[] = [];
afterEach(async () => { await Promise.all(editors.splice(0).map(editor => editor.destroy())); });
async function create(markdown: string) {
  const root = document.createElement('div');
  const editor = await Editor.make().config(ctx => {
    ctx.set(rootCtx, root); ctx.set(defaultValueCtx, markdown);
  }).use(commonmark).use(editorInputBehavior).use($prose(() => history())).create();
  editors.push(editor);
  return editor.ctx.get(editorViewCtx);
}

describe('heading keyboard integration', () => {
  it.each([1, 2, 3, 4, 5, 6])('resets empty H%i with one Backspace and undo restores its level', async level => {
    const view = await create(`${'#'.repeat(level)}\n`);
    const before = view.state.doc;
    const event = new KeyboardEvent('keydown', { key: 'Backspace' });
    expect(view.someProp('handleKeyDown', handler => handler(view, event))).toBe(true);
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
    expect(view.state.selection.from).toBe(1);
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.eq(before)).toBe(true);
    expect(redo(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
  });

  it('resets an empty quoted heading in place without lifting the quote', async () => {
    const view = await create('> ###\n');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    expect(view.someProp('handleKeyDown', handler => handler(view, new KeyboardEvent('keydown', { key: 'Backspace' })))).toBe(true);
    expect(view.state.doc.firstChild?.type.name).toBe('blockquote');
    expect(view.state.doc.firstChild?.firstChild?.type.name).toBe('paragraph');
    view.dispatch(view.state.tr.insertText('正文'));
    expect(view.state.doc.firstChild?.textContent).toBe('正文');
  });

  it('does not intercept nonempty heading or range selection', async () => {
    const view = await create('### 正文\n');
    const plugin = editorInputBehavior.key()?.get(view.state);
    // Call only our boundary handler; the commonmark keymap keeps its existing nonempty behavior.
    const handler = plugin?.props.handleKeyDown;
    expect(handler).toBeDefined();
    const event = new KeyboardEvent('keydown', { key: 'Backspace' });
    expect(handler?.call(plugin!, view, event)).toBe(false);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 2)));
    expect(handler?.call(plugin!, view, event)).toBe(false);
    expect(view.state.doc.firstChild?.attrs.level).toBe(3);
  });
});

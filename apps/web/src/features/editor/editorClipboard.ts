import { type Editor, editorViewCtx, parserCtx, remarkCtx, serializerCtx } from '@milkdown/kit/core';
import { AllSelection } from '@milkdown/kit/prose/state';
import { readClipboardText, runDocumentCommand, writeClipboardText } from '../../browser/clipboard';
import type { EditorClipboardAction, EditorEditResult } from './editorCommands';
import { convertTexMathDelimiters, shouldPasteAsSource } from './editorMathPaste';
import { parseMarkdownSlice } from './editorMarkdownSlice';
import { selectCodeBlockContents } from './editorCodeCommands';
import { expectsNativeKnowraClipboard, hasPastedKnowraMarks, insertKnowraSource, knowraClipboardIntent, KNOWRA_CLIPBOARD_COPY, KNOWRA_CLIPBOARD_CUT, KNOWRA_CLIPBOARD_PASTE, KNOWRA_CLIPBOARD_PLAIN,
  parseKnowraClipboardSlice, recallKnowraClipboard, rememberKnowraClipboard } from './editorKnowraClipboard';

export async function runEditorClipboardAction(editor: Editor, action: EditorClipboardAction, canMutate: () => boolean = () => true): Promise<EditorEditResult> {
  const view = editor.ctx.get(editorViewCtx);
  if (view.isDestroyed) return { ok: false, reason: 'context-changed' };
  view.focus();

  if (action === 'select-all') {
    if (!selectCodeBlockContents(view.state, view.dispatch)) {
      view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
    }
    return { ok: true };
  }

  if (action === 'paste') return pasteClipboardText(editor, canMutate);
  const { from, to } = view.state.selection;
  const selectedText = view.state.doc.textBetween(from, to, '\n\n');
  const slice = view.state.selection.content();
  const marked = hasPastedKnowraMarks(slice);
  if (!selectedText && !marked) return { ok: false, reason: 'empty-selection' };
  // 菜单写入使用 text/plain 后备；含重点时写可往返的 Markdown，避免丢失正文身份。
  const text = marked ? editor.ctx.get(serializerCtx)(view.state.schema.topNodeType.create(null, slice.content)) : selectedText;
  const html = marked ? Array.from(view.serializeForClipboard(slice).dom.childNodes, node => new XMLSerializer().serializeToString(node)).join('') : '';
  const { doc, selection } = view.state;
  const canCut = () => !view.isDestroyed && view.editable && canMutate()
    && view.state.doc === doc && selection.eq(view.state.selection);
  if (action === 'cut' && !canCut()) return { ok: false, reason: 'context-changed' };
  const copied = await writeClipboardText(text);
  if (copied) rememberKnowraClipboard(slice, text, html);
  if (action === 'cut' && !canCut()) return { ok: false, reason: 'context-changed' };
  if (copied) {
    if (action === 'cut') view.dispatch(view.state.tr.deleteSelection().setMeta('uiEvent', 'cut')
      .setMeta(KNOWRA_CLIPBOARD_CUT, marked ? knowraClipboardIntent(text, slice) : null).scrollIntoView());
    else view.dispatch(view.state.tr.setMeta(KNOWRA_CLIPBOARD_COPY, true));
    return { ok: true };
  }
  if (marked) return { ok: false, reason: 'clipboard-denied' };
  return runDocumentCommand(action) ? { ok: true } : { ok: false, reason: 'clipboard-denied' };
}

async function pasteClipboardText(editor: Editor, canMutate: () => boolean): Promise<EditorEditResult> {
  const view = editor.ctx.get(editorViewCtx);
  const { doc, selection } = view.state;
  const stable = () => !view.isDestroyed && view.editable && canMutate() && view.state.doc === doc && selection.eq(view.state.selection);
  if (!stable()) return { ok: false, reason: 'context-changed' };
  const clipboard = await readClipboardText({ includeHtml: true });
  if (!stable()) return { ok: false, reason: 'context-changed' };
  if (!clipboard.ok) {
    return runDocumentCommand('paste') ? { ok: true } : { ok: false, reason: 'clipboard-denied' };
  }
  if (!clipboard.text) return { ok: false, reason: 'clipboard-empty' };
  if (clipboard.html === undefined && expectsNativeKnowraClipboard(clipboard.text)) {
    return runDocumentCommand('paste') ? { ok: true } : { ok: false, reason: 'clipboard-denied' };
  }
  const payload = recallKnowraClipboard(clipboard.text);
  const html = payload?.html ?? clipboard.html ?? '';
  const knownSlice = html.includes('data-knowra-mark') || html.includes('data-knowra-blocks') ? parseKnowraClipboardSlice(view.state.schema, html) : null;
  if (shouldPasteAsSource(view.state)) {
    if (knownSlice) {
      const text = payload?.plain ?? clipboard.text;
      const tr = insertKnowraSource(view.state, knownSlice, text) ?? view.state.tr.insertText(text).setMeta('uiEvent', 'paste').setMeta(KNOWRA_CLIPBOARD_PLAIN, true);
      view.dispatch(tr.setMeta(KNOWRA_CLIPBOARD_PASTE, knowraClipboardIntent(clipboard.text, knownSlice)).scrollIntoView());
      view.focus();
      return { ok: true };
    }
    view.dispatch(view.state.tr.insertText(clipboard.text.replace(/\r\n?/g, '\n')).setMeta('uiEvent', 'paste').setMeta(KNOWRA_CLIPBOARD_PLAIN, true).scrollIntoView());
    view.focus();
    return { ok: true };
  }
  const markdown = knownSlice ? '' : convertTexMathDelimiters(clipboard.text, source => editor.ctx.get(remarkCtx).parse(source));
  const slice = knownSlice ?? parseMarkdownSlice(editor.ctx.get(parserCtx), markdown);
  if (!slice) return { ok: false, reason: 'unsupported' };
  view.dispatch(view.state.tr.replaceSelection(slice).setMeta('uiEvent', 'paste').setMeta(KNOWRA_CLIPBOARD_PASTE, knowraClipboardIntent(clipboard.text, slice)).scrollIntoView());
  view.focus();
  return { ok: true };
}

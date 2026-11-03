import { it, expect } from 'vitest';
import { Editor, rootCtx, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, serializerCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { history, undoCommand, redoCommand } from '@milkdown/kit/plugin/history';
import { callCommand } from '@milkdown/kit/utils';
import { TextSelection } from '@milkdown/kit/prose/state';
import { createNoteLinkUrl, extractNoteLinks } from '@study-accelerator/content-anchor';
import { noteLinkSchema, captureNoteLinkEdit, applyNoteLinkEdit, selectNoteLinkOccurrence, noteLinkRanges } from './editorNoteLinks';
import { createAnnotationHighlightBehavior, getAnnotationSelection } from './editorAnnotations';

async function withEditor(markdown: string, operation: (editor: Editor) => void) {
  const root = document.createElement('div'); document.body.append(root);
  const editor = await Editor.make().config(ctx => { ctx.set(rootCtx, root); ctx.set(defaultValueCtx, markdown); ctx.set(editorViewOptionsCtx, { handleScrollToSelection: () => true }); })
    .use(commonmark).use(noteLinkSchema).use(gfm).use(history).use(createAnnotationHighlightBehavior(() => undefined)).create();
  try { operation(editor); } finally { await editor.destroy(); root.remove(); }
}
it('选区保留格式、绑定目标，编辑目标保留引用身份，撤销重做并重开', async () => {
  let saved = '';
  await withEditor('前文 **显示文字** 后文', editor => {
    const view = editor.ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4, 8)));
    const session = captureNoteLinkEdit(view)!;
    expect(session.label).toBe('显示文字');
    const unchanged = editor.ctx.get(serializerCtx)(view.state.doc);
    expect(editor.ctx.get(serializerCtx)(view.state.doc)).toBe(unchanged); // 取消不写入
    expect(applyNoteLinkEdit(view, session, 'note-target', session.label)).toBe(true);
    const first = extractNoteLinks(editor.ctx.get(serializerCtx)(view.state.doc)).occurrences[0];
    expect(first.label).toBe('显示文字');
    expect(view.state.doc.nodeAt(4)?.marks.some(mark => mark.type.name === 'strong')).toBe(true);
    const edit = captureNoteLinkEdit(view)!;
    expect(applyNoteLinkEdit(view, edit, 'note-other', '修改文字')).toBe(true);
    saved = editor.ctx.get(serializerCtx)(view.state.doc);
    expect(extractNoteLinks(saved).occurrences[0].occurrenceId).toBe(first.occurrenceId);
    editor.action(callCommand(undoCommand.key));
    expect(extractNoteLinks(editor.ctx.get(serializerCtx)(view.state.doc)).occurrences[0].targetNoteId).toBe('note-target');
    editor.action(callCommand(redoCommand.key));
    expect(editor.ctx.get(serializerCtx)(view.state.doc)).toBe(saved);
    const removal = captureNoteLinkEdit(view)!;
    expect(applyNoteLinkEdit(view, removal, null, removal.label)).toBe(true);
    expect(extractNoteLinks(editor.ctx.get(serializerCtx)(view.state.doc)).occurrences).toHaveLength(0);
    expect(view.state.doc.textContent).toContain('修改文字');
  });
  await withEditor(saved, editor => {
    const view = editor.ctx.get(editorViewCtx);
    expect(noteLinkRanges(view)[0].targetNoteId).toBe('note-other');
  });
});
it('弹窗期间正文变化拒绝旧选区，不覆盖新内容', async () => {
  await withEditor('合成正文', editor => {
    const view = editor.ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)));
    const session = captureNoteLinkEdit(view)!;
    view.dispatch(view.state.tr.insertText('新增', 1));
    expect(applyNoteLinkEdit(view, session, 'note-target', session.label)).toBe(false);
    expect(view.state.doc.textContent).toBe('新增合成正文');
  });
});
it('跨硬换行或图片选区不创建重复引用身份，单行仍可创建定位', async () => {
  for (const markdown of ['First  \nSecond', 'First ![图](https://example.test/image.png) Second']) {
    await withEditor(markdown, editor => {
      const view = editor.ctx.get(editorViewCtx);
      const before = editor.ctx.get(serializerCtx)(view.state.doc);
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1)));
      expect(captureNoteLinkEdit(view)).toBeNull();
      expect(editor.ctx.get(serializerCtx)(view.state.doc)).toBe(before);
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
      const session = captureNoteLinkEdit(view)!;
      expect(applyNoteLinkEdit(view, session, 'target-note', session.label)).toBe(true);
      const saved = editor.ctx.get(serializerCtx)(view.state.doc);
      const occurrences = extractNoteLinks(saved).occurrences;
      expect(occurrences).toHaveLength(1);
      expect(selectNoteLinkOccurrence(view, saved, occurrences[0])).toBe(true);
    });
  }
});
it('内部URL以安全hash渲染，外部危险协议仍被上游过滤', async () => {
  const href = createNoteLinkUrl('target-id', 'ref-safe-link');
  await withEditor(`[内部](${href}) [危险](javascript:alert%281%29)`, editor => {
    const links = editor.ctx.get(editorViewCtx).dom.querySelectorAll('a');
    expect(links[0].getAttribute('href')).toBe('#/materials/notes/target-id');
    expect(links[0].getAttribute('data-note-link-url')).toBe(href);
    expect(links[1].getAttribute('href')).toBe('');
  });
});
it('同源同文字逐处定位、前文移动与格式拆分，重复位置失效不搜索文字', async () => {
  const first = createNoteLinkUrl('note-target', 'occ-first');
  const second = createNoteLinkUrl('note-target', 'occ-second');
  await withEditor(`前文\n\n[同**名**](${first}) 第一处\n\n[同名](${second}) 第二处`, editor => {
    const view = editor.ctx.get(editorViewCtx);
    expect(noteLinkRanges(view)).toHaveLength(2);
    const markdown = () => editor.ctx.get(serializerCtx)(view.state.doc);
    expect(selectNoteLinkOccurrence(view, markdown(), { targetNoteId: 'note-target', occurrenceId: 'occ-second' })).toBe(true);
    const position = view.state.selection.from;
    view.dispatch(view.state.tr.insertText('新增前文', 1));
    expect(selectNoteLinkOccurrence(view, markdown(), { targetNoteId: 'note-target', occurrenceId: 'occ-second' })).toBe(true);
    expect(view.state.selection.from).toBe(position + 4);
    expect(getAnnotationSelection(editor, markdown())).not.toBeNull();
  });
  await withEditor(`[同名](${first})\n\n[同名](${first})`, editor => {
    const view = editor.ctx.get(editorViewCtx), selection = view.state.selection;
    expect(selectNoteLinkOccurrence(view, editor.ctx.get(serializerCtx)(view.state.doc), { targetNoteId: 'note-target', occurrenceId: 'occ-first' })).toBe(false);
    expect(view.state.selection).toBe(selection);
  });
});

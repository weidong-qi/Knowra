import { Plugin } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

export const TABLE_CONTEXT_EVENT = 'knowra-table-context';

/** 在 ProseMirror 事务完成后刷新控件，避免 DOM selectionchange 早于状态同步。 */
export const editorTableBehavior = $prose(() => new Plugin({
  view: () => ({
    update(view, previous) {
      if (view.state.doc.eq(previous.doc) && view.state.selection.eq(previous.selection)) return;
      view.dom.dispatchEvent(new Event(TABLE_CONTEXT_EVENT, { bubbles: true }));
    }
  })
}));

import { liftEmptyBlock, setBlockType } from '@milkdown/kit/prose/commands';
import type { ResolvedPos } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, TextSelection, type Command } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

const STRUCTURED_BLOCKS = new Set(['list_item', 'blockquote']);

export interface EditorBoundaryInput {
  key: string;
  selectionEmpty: boolean;
  parentEmpty: boolean;
  parentOffset: number;
  ancestors: string[];
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  viewComposing?: boolean;
}

export type EditorBoundaryAction = 'reset-empty-heading' | 'lift-empty-structured-block' | null;

export interface TrailingBlockClickInput {
  button: number;
  clientY: number;
  lastBlockBottom: number;
  lastNodeType: string | null;
  editable: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export function resolveEditorBoundaryAction(input: EditorBoundaryInput): EditorBoundaryAction {
  if (
    input.isComposing
    || input.keyCode === 229
    || input.viewComposing
    || input.ctrlKey
    || input.metaKey
    || input.altKey
    || input.shiftKey
  ) {
    return null;
  }
  if (input.key !== 'Enter' && input.key !== 'Backspace') return null;
  if (!input.selectionEmpty || !input.parentEmpty || input.parentOffset !== 0) return null;
  if (input.key === 'Backspace' && input.ancestors[0] === 'heading') return 'reset-empty-heading';
  return input.ancestors.some((name) => STRUCTURED_BLOCKS.has(name))
    ? 'lift-empty-structured-block'
    : null;
}

export function shouldInsertParagraphAfterTrailingBlock(
  input: TrailingBlockClickInput
): boolean {
  return input.editable
    && input.button === 0
    && !input.ctrlKey
    && !input.metaKey
    && !input.altKey
    && !input.shiftKey
    && (input.lastNodeType === 'code_block' || input.lastNodeType === 'table')
    && input.clientY > input.lastBlockBottom;
}

/** 删除文首空行，同时保留下一个块的标题格式。 */
export const removeLeadingEmptyParagraph: Command = (state, dispatch) => {
  const { doc, selection } = state;
  const first = doc.firstChild;
  if (
    !selection.empty
    || selection.from !== 1
    || doc.childCount < 2
    || first?.type.name !== 'paragraph'
    || first.content.size !== 0
  ) return false;
  if (dispatch) {
    const transaction = state.tr.delete(0, first.nodeSize);
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(0), 1));
    dispatch(transaction.scrollIntoView());
  }
  return true;
};

export const editorInputBehavior = $prose(() => new Plugin({
  key: new PluginKey('V4_EDITOR_INPUT_BEHAVIOR'),
  props: {
    handleDOMEvents: {
      mousedown(view, event) {
        const lastElement = view.dom.lastElementChild;
        if (!(event instanceof MouseEvent) || !(lastElement instanceof HTMLElement)) return false;
        if (!shouldInsertParagraphAfterTrailingBlock({
          button: event.button,
          clientY: event.clientY,
          lastBlockBottom: lastElement.getBoundingClientRect().bottom,
          lastNodeType: view.state.doc.lastChild?.type.name ?? null,
          editable: view.editable,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey
        })) return false;

        const paragraphNodeType = view.state.schema.nodes.paragraph;
        if (!paragraphNodeType) return false;
        const insertPos = view.state.doc.content.size;
        const transaction = view.state.tr.insert(insertPos, paragraphNodeType.create());
        transaction.setSelection(TextSelection.create(transaction.doc, insertPos + 1));
        view.dispatch(transaction.scrollIntoView());
        view.focus();
        event.preventDefault();
        return true;
      }
    },
    handleKeyDown(view, event) {
      if (
        (event.key === 'Backspace' || event.key === 'Delete')
        && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
        && !event.isComposing && event.keyCode !== 229 && !view.composing
        && removeLeadingEmptyParagraph(view.state, view.dispatch)
      ) return true;
      const { selection } = view.state;
      const action = resolveEditorBoundaryAction({
        key: event.key,
        selectionEmpty: selection.empty,
        parentEmpty: selection.$from.parent.content.size === 0,
        parentOffset: selection.$from.parentOffset,
        ancestors: collectAncestorNames(selection.$from),
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        isComposing: event.isComposing,
        keyCode: event.keyCode,
        viewComposing: view.composing
      });
      if (action === 'reset-empty-heading') {
        const paragraph = view.state.schema.nodes.paragraph;
        return Boolean(paragraph && setBlockType(paragraph)(view.state, view.dispatch));
      }
      if (action !== 'lift-empty-structured-block') return false;
      return liftEmptyBlock(view.state, view.dispatch);
    }
  }
}));

function collectAncestorNames($from: ResolvedPos): string[] {
  const names: string[] = [];
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    names.push($from.node(depth).type.name);
  }
  return names;
}

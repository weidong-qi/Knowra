import { exitCode, setBlockType } from '@milkdown/kit/prose/commands';
import { Fragment } from '@milkdown/kit/prose/model';
import { TextSelection, type Command, type EditorState, type Transaction } from '@milkdown/kit/prose/state';

/** Select only the code node's text; visual soft wraps do not add document breaks. */
export function selectCodeBlockContentsAt(
  state: EditorState,
  from: number,
  to: number,
  dispatch?: (transaction: Transaction) => void
): boolean {
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);
  if (!$from.parent.isBlock || !$from.parent.type.spec.code || !$from.sameParent($to)) return false;
  dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, $from.start(), $from.end())).scrollIntoView());
  return true;
}

export const selectCodeBlockContents: Command = (state, dispatch) => (
  selectCodeBlockContentsAt(state, state.selection.from, state.selection.to, dispatch)
);

export const indentCode: (outdent?: boolean) => Command = (outdent = false) => (state, dispatch) => {
  const { $from, $to, empty } = state.selection;
  if (!$from.parent.isBlock || !$from.parent.type.spec.code || !$from.sameParent($to)) return false;
  if (empty && !outdent) {
    dispatch?.(state.tr.insertText('    ').scrollIntoView());
    return true;
  }
  const text = $from.parent.textContent;
  const start = $from.parentOffset === 0 ? 0 : text.lastIndexOf('\n', $from.parentOffset - 1) + 1;
  const end = $to.parentOffset;
  const changes: { from: number; to: number; text: string }[] = [];
  for (let offset = start; offset <= end;) {
    if (offset === end && !empty && offset !== start) break;
    const count = outdent ? (text.slice(offset).match(/^( {1,4}|\t)/)?.[0].length ?? 0) : 0;
    if (!outdent || count) changes.push({ from: $from.start() + offset, to: $from.start() + offset + count, text: outdent ? '' : '    ' });
    const next = text.indexOf('\n', offset);
    if (next < 0) break;
    offset = next + 1;
  }
  const tr = state.tr;
  for (const change of changes.reverse()) tr.insertText(change.text, change.from, change.to);
  dispatch?.(tr.scrollIntoView());
  return true;
};

export const newlineInCode: Command = (state, dispatch) => {
  const { $from, $to } = state.selection;
  if (!$from.parent.isBlock || !$from.parent.type.spec.code || !$from.sameParent($to)) return false;
  const prefix = $from.parent.textContent.slice(0, $from.parentOffset);
  const line = prefix.slice(prefix.lastIndexOf('\n') + 1);
  const indentation = line.match(/^[\t ]*/)?.[0] ?? '';
  dispatch?.(state.tr.insertText(`\n${indentation}`).scrollIntoView());
  return true;
};

export const moveToCodeLineBoundary: (end: boolean, extend: boolean) => Command = (end, extend) => (state, dispatch) => {
  const { $head, anchor } = state.selection;
  if (!$head.parent.isBlock || !$head.parent.type.spec.code) return false;
  const text = $head.parent.textContent;
  const offset = $head.parentOffset;
  const next = text.indexOf('\n', offset);
  const position = $head.start() + (end ? (next < 0 ? text.length : next) : (offset === 0 ? 0 : text.lastIndexOf('\n', offset - 1) + 1));
  dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, extend ? anchor : position, position)).scrollIntoView());
  return true;
};

export const leaveCode: Command = (state, dispatch, view) => {
  const { $from, $to } = state.selection;
  if (!$from.parent.isBlock || !$from.parent.type.spec.code || !$from.sameParent($to)) return false;
  const after = $from.after();
  const next = state.doc.nodeAt(after);
  if (next?.type.name === 'paragraph' && next.content.size === 0) {
    dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, after + 1)).scrollIntoView());
    return true;
  }
  return exitCode(state, dispatch, view);
};

export const createCodeFromFence: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.name !== 'paragraph' || $from.parentOffset !== $from.parent.content.size) return false;
  const match = $from.parent.textContent.match(/^\s{0,3}(?:`{3,}|~{3,})([^\s`~]*)\s*$/);
  const type = state.schema.nodes.code_block;
  if (!match || !type) return false;
  const tr = state.tr.delete($from.start(), $from.end()).setBlockType($from.before(), $from.before() + 1, type, { language: match[1] });
  dispatch?.(tr.scrollIntoView());
  return true;
};

/** Empty code blocks return to an editable paragraph, including the only block in a note. */
export const removeEmptyCode: Command = (state, dispatch) => {
  const { $from, $to } = state.selection;
  if (!$from.parent.isBlock || !$from.parent.type.spec.code || !$from.sameParent($to) || $from.parent.textContent.trim()) return false;
  const paragraph = state.schema.nodes.paragraph;
  if (!paragraph) return false;
  return setBlockType(paragraph)(state, dispatch ? (tr) => {
    const { $from: caret } = tr.selection;
    tr.delete(caret.start(), caret.end());
    dispatch(tr.scrollIntoView());
  } : undefined);
};

/** Toggle only the touched code lines, preserving the surrounding code and its language. */
export const unwrapCodeLines: Command = (state, dispatch) => {
  const { $from, $to, anchor, head, empty } = state.selection;
  const code = $from.parent;
  const paragraph = state.schema.nodes.paragraph;
  if (!code.isBlock || !code.type.spec.code || !$from.sameParent($to) || !paragraph) return false;
  const text = code.textContent;
  const lines = text.split('\n');
  const lineAt = (offset: number) => text.slice(0, offset).split('\n').length - 1;
  const first = lineAt($from.parentOffset);
  const lastOffset = !empty && text[$to.parentOffset - 1] === '\n' ? $to.parentOffset - 1 : $to.parentOffset;
  const last = lineAt(lastOffset);
  const asText = (value: string) => value ? state.schema.text(value) : undefined;
  const nodes = [];
  if (first > 0) nodes.push(code.type.create(code.attrs, asText(lines.slice(0, first).join('\n'))));
  const start = $from.before();
  let position = start + (nodes[0]?.nodeSize ?? 0);
  const starts: number[] = [];
  for (let index = first; index <= last; index += 1) {
    const node = paragraph.create(null, asText(lines[index]!));
    starts.push(position + 1);
    nodes.push(node);
    position += node.nodeSize;
  }
  if (last < lines.length - 1) nodes.push(code.type.create(code.attrs, asText(lines.slice(last + 1).join('\n'))));
  const fragment = Fragment.fromArray(nodes);
  const container = $from.node(-1);
  const index = $from.index(-1);
  if (!container.canReplace(index, index + 1, fragment)) return false;
  if (!dispatch) return true;
  const mapPosition = (original: number) => {
    const offset = original - $from.start();
    const line = Math.min(last, Math.max(first, lineAt(offset)));
    const lineStart = lines.slice(0, line).reduce((length, value) => length + value.length + 1, 0);
    return starts[line - first]! + Math.min(lines[line]!.length, Math.max(0, offset - lineStart));
  };
  const tr = state.tr.replaceWith(start, $from.after(), fragment);
  tr.setSelection(TextSelection.create(tr.doc, mapPosition(anchor), mapPosition(head)));
  dispatch(tr.scrollIntoView());
  return true;
};

import { describe, expect, it } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import {
  removeLeadingEmptyParagraph,
  resolveEditorBoundaryAction,
  shouldInsertParagraphAfterTrailingBlock,
  type EditorBoundaryInput,
  type TrailingBlockClickInput
} from './editorInputBehavior';

const baseInput: EditorBoundaryInput = {
  key: 'Enter',
  selectionEmpty: true,
  parentEmpty: true,
  parentOffset: 0,
  ancestors: ['paragraph', 'list_item', 'bullet_list']
};

describe('editorInputBehavior', () => {
  it('removes only the blank first paragraph and preserves the next heading', () => {
    const schema = new Schema({
      nodes: {
        doc: { content: 'block+' },
        paragraph: { content: 'text*', group: 'block' },
        heading: { attrs: { level: { default: 1 } }, content: 'text*', group: 'block' },
        text: { group: 'inline' }
      }
    });
    const doc = schema.node('doc', null, [
      schema.node('paragraph'),
      schema.node('heading', { level: 1 }, schema.text('1.0'))
    ]);
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1) });
    let next = state;
    expect(removeLeadingEmptyParagraph(state, transaction => { next = state.apply(transaction); })).toBe(true);
    expect(next.doc.firstChild?.type.name).toBe('heading');
    expect(next.doc.firstChild?.textContent).toBe('1.0');
    expect(next.selection.$from.parent.type.name).toBe('heading');
    expect(removeLeadingEmptyParagraph(next)).toBe(false);
  });

  it.each(['Enter', 'Backspace'])('exits an empty structured block with %s', (key) => {
    expect(resolveEditorBoundaryAction({ ...baseInput, key })).toBe('lift-empty-structured-block');
    expect(resolveEditorBoundaryAction({
      ...baseInput,
      key,
      ancestors: ['paragraph', 'blockquote']
    })).toBe('lift-empty-structured-block');
  });

  it('keeps normal paragraphs and non-empty blocks on the native ProseMirror path', () => {
    expect(resolveEditorBoundaryAction({ ...baseInput, ancestors: ['paragraph'] })).toBeNull();
    expect(resolveEditorBoundaryAction({ ...baseInput, parentEmpty: false })).toBeNull();
    expect(resolveEditorBoundaryAction({ ...baseInput, selectionEmpty: false })).toBeNull();
    expect(resolveEditorBoundaryAction({ ...baseInput, parentOffset: 1 })).toBeNull();
  });

  it('never mutates editor state while an IME composition is active', () => {
    expect(resolveEditorBoundaryAction({ ...baseInput, isComposing: true })).toBeNull();
    expect(resolveEditorBoundaryAction({ ...baseInput, keyCode: 229 })).toBeNull();
    expect(resolveEditorBoundaryAction({ ...baseInput, viewComposing: true })).toBeNull();
  });

  it('does not override modified Enter or Backspace shortcuts', () => {
    expect(resolveEditorBoundaryAction({ ...baseInput, shiftKey: true })).toBeNull();
    expect(resolveEditorBoundaryAction({ ...baseInput, ctrlKey: true })).toBeNull();
    expect(resolveEditorBoundaryAction({ ...baseInput, metaKey: true })).toBeNull();
    expect(resolveEditorBoundaryAction({ ...baseInput, altKey: true })).toBeNull();
  });

  it('creates a paragraph only for a plain click below a trailing code block or table', () => {
    const click: TrailingBlockClickInput = {
      button: 0,
      clientY: 220,
      lastBlockBottom: 180,
      lastNodeType: 'code_block',
      editable: true
    };
    expect(shouldInsertParagraphAfterTrailingBlock(click)).toBe(true);
    expect(shouldInsertParagraphAfterTrailingBlock({ ...click, lastNodeType: 'table' })).toBe(true);
    expect(shouldInsertParagraphAfterTrailingBlock({ ...click, clientY: 170 })).toBe(false);
    expect(shouldInsertParagraphAfterTrailingBlock({ ...click, lastNodeType: 'paragraph' })).toBe(false);
    expect(shouldInsertParagraphAfterTrailingBlock({ ...click, editable: false })).toBe(false);
    expect(shouldInsertParagraphAfterTrailingBlock({ ...click, metaKey: true })).toBe(false);
  });
});

describe('empty heading Backspace', () => {
  it('resets headings before lifting their structured container', () => {
    for (const ancestors of [['heading'], ['heading', 'blockquote'], ['heading', 'list_item', 'bullet_list']]) {
      expect(resolveEditorBoundaryAction({ ...baseInput, key: 'Backspace', ancestors })).toBe('reset-empty-heading');
    }
    expect(resolveEditorBoundaryAction({ ...baseInput, key: 'Enter', ancestors: ['heading'] })).toBeNull();
  });

  it('preserves nonempty headings, selections, modified shortcuts and IME', () => {
    const input: EditorBoundaryInput = { ...baseInput, key: 'Backspace', ancestors: ['heading'] };
    for (const overrides of [{ parentEmpty: false }, { selectionEmpty: false }, { parentOffset: 1 },
      { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true },
      { isComposing: true }, { viewComposing: true }, { keyCode: 229 }]) {
      expect(resolveEditorBoundaryAction({ ...input, ...overrides })).toBeNull();
    }
  });
});

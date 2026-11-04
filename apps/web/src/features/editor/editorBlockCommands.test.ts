import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { describe, expect, it } from 'vitest';
import { applyTyporaCodeBlockCommand } from './editorBlockCommands';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'text*', group: 'block' },
    code_block: {
      attrs: { language: { default: '' } },
      content: 'text*',
      group: 'block',
      code: true
    },
    text: { group: 'inline' }
  }
});

function runCommand(state: EditorState): EditorState {
  let nextState = state;
  expect(applyTyporaCodeBlockCommand(state, (transaction) => {
    nextState = state.apply(transaction);
  })).toBe(true);
  return nextState;
}

describe('applyTyporaCodeBlockCommand', () => {
  it('inserts an empty code block after a non-empty line with a collapsed caret', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('alpha'))
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 3)
    });

    const nextState = runCommand(state);

    expect(nextState.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'alpha' }] },
        { type: 'code_block', attrs: { language: '' } },
        { type: 'paragraph' }
      ]
    });
    expect(nextState.selection.$from.parent.type.name).toBe('code_block');
  });

  it('converts the current empty ordinary line in place and keeps a trailing paragraph', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph')]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1)
    });

    const nextState = runCommand(state);

    expect(nextState.doc.childCount).toBe(2);
    expect(nextState.doc.child(0).type.name).toBe('code_block');
    expect(nextState.doc.child(1).type.name).toBe('paragraph');
    expect(nextState.selection.$from.parent.type.name).toBe('code_block');
  });

  it('preserves a non-empty line even when its text is selected', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('selected text'))
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1, 14)
    });

    const nextState = runCommand(state);

    expect(nextState.doc.child(0).type.name).toBe('paragraph');
    expect(nextState.doc.child(0).textContent).toBe('selected text');
    expect(nextState.doc.child(1).type.name).toBe('code_block');
    expect(nextState.doc.child(1).textContent).toBe('');
    expect(nextState.doc.lastChild?.type.name).toBe('paragraph');
  });
});

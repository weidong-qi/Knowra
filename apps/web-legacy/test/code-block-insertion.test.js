import assert from 'node:assert/strict';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { insertCodeBlockAtTyporaPosition } from '../lib/editor/milkdown/commands/code-block-insertion.js';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    code_block: { content: 'text*', group: 'block', code: true, marks: '' },
    text: { group: 'inline' }
  }
});

const paragraph = schema.nodes.paragraph;
const codeBlock = schema.nodes.code_block;

function createParagraph(text = '') {
  return paragraph.create(null, text ? schema.text(text) : null);
}

function createView(nodes, selectionPosition) {
  const doc = schema.nodes.doc.create(null, nodes);
  const view = {
    state: EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, selectionPosition)
    }),
    focused: false,
    dispatch(transaction) {
      this.state = this.state.apply(transaction);
    },
    focus() {
      this.focused = true;
    }
  };

  return view;
}

function blockTypes(view) {
  return view.state.doc.content.content.map((node) => node.type.name);
}

function assertCodeBlockIsFocused(view) {
  assert.equal(view.state.selection.$from.parent.type.name, 'code_block');
  assert.equal(view.state.selection.$from.parentOffset, 0);
  assert.equal(view.focused, true);
}

assert.equal(
  insertCodeBlockAtTyporaPosition(
    createView([createParagraph()], 1),
    paragraph,
    codeBlock
  ),
  true,
  'an empty current paragraph should be converted into a code block'
);

const emptyCurrent = createView([createParagraph(), createParagraph('next')], 1);
insertCodeBlockAtTyporaPosition(emptyCurrent, paragraph, codeBlock);
assert.deepEqual(blockTypes(emptyCurrent), ['code_block', 'paragraph']);
assert.equal(emptyCurrent.state.doc.child(1).textContent, 'next');
assertCodeBlockIsFocused(emptyCurrent);

const filledCurrent = createView([createParagraph('current')], 3);
insertCodeBlockAtTyporaPosition(filledCurrent, paragraph, codeBlock);
assert.deepEqual(blockTypes(filledCurrent), ['paragraph', 'code_block', 'paragraph']);
assertCodeBlockIsFocused(filledCurrent);

const filledWithNextText = createView(
  [createParagraph('current'), createParagraph('next')],
  3
);
insertCodeBlockAtTyporaPosition(filledWithNextText, paragraph, codeBlock);
assert.deepEqual(
  blockTypes(filledWithNextText),
  ['paragraph', 'code_block', 'paragraph'],
  'existing text on the next line should prevent an extra blank paragraph'
);
assert.equal(filledWithNextText.state.doc.child(2).textContent, 'next');

const filledWithExistingBlank = createView(
  [createParagraph('current'), createParagraph()],
  3
);
insertCodeBlockAtTyporaPosition(filledWithExistingBlank, paragraph, codeBlock);
assert.deepEqual(
  blockTypes(filledWithExistingBlank),
  ['paragraph', 'code_block', 'paragraph'],
  'an existing blank next line should be reused'
);

console.log('ok - code block insertion follows Typora empty-line rules');

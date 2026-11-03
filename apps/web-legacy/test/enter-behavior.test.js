import assert from 'node:assert/strict';
import {
  resolveBackspaceBehavior,
  resolveBlockCommandBehavior,
  resolveEnterBehavior,
  resolveIndentBehavior,
  shouldKeepTrailingBlank
} from '../lib/editor/enter-behavior.js';

function runTest(name, callback) {
  try {
    callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

runTest('shouldKeepTrailingBlank adds a trailing paragraph only at the non-empty document end', () => {
  assert.equal(
    shouldKeepTrailingBlank({
      docIsEmpty: false,
      atDocEnd: true,
      currentBlockIsBlank: false,
      trailingBlankCount: 0
    }),
    true
  );

  assert.equal(
    shouldKeepTrailingBlank({
      docIsEmpty: false,
      atDocEnd: true,
      currentBlockIsBlank: true,
      trailingBlankCount: 1
    }),
    false
  );

  assert.equal(
    shouldKeepTrailingBlank({
      docIsEmpty: false,
      atDocEnd: false,
      currentBlockIsBlank: false,
      trailingBlankCount: 0
    }),
    false
  );
});

runTest('resolveEnterBehavior exits empty structured blocks', () => {
  assert.equal(
    resolveEnterBehavior({
      parentType: 'list_item',
      parentIsBlank: true,
      previousSiblingType: null
    }),
    'exit-structured-block'
  );

  assert.equal(
    resolveEnterBehavior({
      parentType: 'blockquote',
      parentIsBlank: true,
      previousSiblingType: null
    }),
    'exit-structured-block'
  );
});

runTest('resolveEnterBehavior keeps continuing non-empty structured blocks', () => {
  assert.equal(
    resolveEnterBehavior({
      parentType: 'list_item',
      parentIsBlank: false,
      previousSiblingType: null
    }),
    'continue-structured-block'
  );

});

runTest('resolveEnterBehavior stays normal in ordinary paragraphs', () => {
  assert.equal(
    resolveEnterBehavior({
      parentType: 'paragraph',
      parentIsBlank: false,
      previousSiblingType: 'paragraph'
    }),
    'default'
  );
});

runTest('resolveIndentBehavior routes Tab by Typora block context', () => {
  assert.equal(
    resolveIndentBehavior({
      direction: 'in',
      inTable: true,
      inListItem: false,
      inBlockquote: false,
      parentType: 'paragraph'
    }),
    'table-navigation'
  );

  assert.equal(
    resolveIndentBehavior({
      direction: 'in',
      inTable: false,
      inListItem: true,
      inBlockquote: true,
      parentType: 'paragraph'
    }),
    'sink-list-item'
  );

  assert.equal(
    resolveIndentBehavior({
      direction: 'out',
      inTable: false,
      inListItem: true,
      inBlockquote: true,
      parentType: 'paragraph'
    }),
    'lift-list-item'
  );

  assert.equal(
    resolveIndentBehavior({
      direction: 'in',
      inTable: false,
      inListItem: false,
      inBlockquote: true,
      parentType: 'paragraph'
    }),
    'deepen-blockquote'
  );

  assert.equal(
    resolveIndentBehavior({
      direction: 'out',
      inTable: false,
      inListItem: false,
      inBlockquote: true,
      parentType: 'paragraph'
    }),
    'lift-block'
  );

  assert.equal(
    resolveIndentBehavior({
      direction: 'in',
      inTable: false,
      inListItem: false,
      inBlockquote: false,
      parentType: 'paragraph'
    }),
    'indent-textblock'
  );
});

runTest('resolveBlockCommandBehavior separates conversion blocks from insertion blocks', () => {
  assert.equal(resolveBlockCommandBehavior('heading-2'), 'convert-current-block');
  assert.equal(resolveBlockCommandBehavior('bullet'), 'convert-current-block');
  assert.equal(resolveBlockCommandBehavior('ordered'), 'convert-current-block');
  assert.equal(resolveBlockCommandBehavior('quote'), 'convert-current-block');

  assert.equal(resolveBlockCommandBehavior('table'), 'insert-below-current-block');
  assert.equal(resolveBlockCommandBehavior('codeblock'), 'insert-below-current-block');
  assert.equal(resolveBlockCommandBehavior('hr'), 'insert-below-current-block');
  assert.equal(resolveBlockCommandBehavior('image'), 'insert-below-current-block');
});

runTest('resolveBackspaceBehavior exits empty list items at the line start', () => {
  assert.equal(
    resolveBackspaceBehavior({
      atLineStart: true,
      parentType: 'list_item',
      parentIsBlank: true
    }),
    'exit-structured-block'
  );

  assert.equal(
    resolveBackspaceBehavior({
      atLineStart: true,
      parentType: 'blockquote',
      parentIsBlank: true
    }),
    'exit-structured-block'
  );
});

runTest('resolveBackspaceBehavior leaves ordinary text deletion to the editor default', () => {
  assert.equal(
    resolveBackspaceBehavior({
      atLineStart: false,
      parentType: 'list_item',
      parentIsBlank: true
    }),
    'default'
  );

  assert.equal(
    resolveBackspaceBehavior({
      atLineStart: true,
      parentType: 'paragraph',
      parentIsBlank: true
    }),
    'default'
  );
});

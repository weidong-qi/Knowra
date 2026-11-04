const STRUCTURED_BLOCK_TYPES = new Set(['list_item', 'blockquote']);
const TRAILING_BLANK_ELIGIBLE_TYPES = new Set(['paragraph', 'heading']);
const INSERT_BELOW_BLOCK_COMMANDS = new Set(['table', 'codeblock', 'hr', 'image']);
const CONVERT_CURRENT_BLOCK_COMMANDS = new Set([
  'paragraph',
  'heading-1',
  'heading-2',
  'heading-3',
  'heading-4',
  'bullet',
  'ordered',
  'task-list',
  'quote'
]);

export function shouldKeepTrailingBlank({
  docIsEmpty,
  atDocEnd,
  currentBlockIsBlank,
  trailingBlankCount,
  parentType = 'paragraph'
}) {
  if (docIsEmpty || !atDocEnd || currentBlockIsBlank) {
    return false;
  }

  if (!TRAILING_BLANK_ELIGIBLE_TYPES.has(parentType)) {
    return false;
  }

  return Number(trailingBlankCount ?? 0) === 0;
}

export function resolveEnterBehavior({
  parentType,
  parentIsBlank
}) {
  if (!STRUCTURED_BLOCK_TYPES.has(parentType)) {
    return 'default';
  }

  return parentIsBlank ? 'exit-structured-block' : 'continue-structured-block';
}

export function resolveIndentBehavior({
  direction = 'in',
  inTable = false,
  inListItem = false,
  inBlockquote = false,
  parentType = 'paragraph'
} = {}) {
  if (inTable) {
    return 'table-navigation';
  }

  if (inListItem) {
    return direction === 'out' ? 'lift-list-item' : 'sink-list-item';
  }

  if (inBlockquote) {
    return direction === 'out' ? 'lift-block' : 'deepen-blockquote';
  }

  return direction === 'out' ? 'outdent-textblock' : 'indent-textblock';
}

export function resolveBlockCommandBehavior(commandKey) {
  if (INSERT_BELOW_BLOCK_COMMANDS.has(commandKey)) {
    return 'insert-below-current-block';
  }

  if (CONVERT_CURRENT_BLOCK_COMMANDS.has(commandKey)) {
    return 'convert-current-block';
  }

  return 'inline-or-command';
}

export function resolveBackspaceBehavior({
  atLineStart = false,
  parentType = 'paragraph',
  parentIsBlank = false
} = {}) {
  if (!atLineStart || !parentIsBlank) {
    return 'default';
  }

  if (parentType === 'list_item' || parentType === 'blockquote') {
    return 'exit-structured-block';
  }

  return 'default';
}

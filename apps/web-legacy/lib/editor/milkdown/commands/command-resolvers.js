import { redoCommand, undoCommand } from '@milkdown/kit/plugin/history';
import {
  createCodeBlockCommand,
  insertHrCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand
} from '@milkdown/kit/preset/commonmark';
import {
  addColAfterCommand,
  addColBeforeCommand,
  addRowAfterCommand,
  addRowBeforeCommand,
  deleteSelectedCellsCommand,
  insertTableCommand,
  setAlignCommand,
  toggleStrikethroughCommand
} from '@milkdown/kit/preset/gfm';
import { normalizeTableDimension } from '../table/table-dimensions.js';

export function createCommandResolvers({
  insertImageBlockCommand,
  insertInternalLinkCommand,
  insertLinkCommand,
  toggleHighlightCommand,
  turnIntoTaskListCommand
}) {
  return {
    'paragraph': () => ({ key: turnIntoTextCommand.key }),
    'heading-1': () => ({ key: wrapInHeadingCommand.key, payload: 1 }),
    'heading-2': () => ({ key: wrapInHeadingCommand.key, payload: 2 }),
    'heading-3': () => ({ key: wrapInHeadingCommand.key, payload: 3 }),
    'heading-4': () => ({ key: wrapInHeadingCommand.key, payload: 4 }),
    bold: () => ({ key: toggleStrongCommand.key }),
    italic: () => ({ key: toggleEmphasisCommand.key }),
    quote: () => ({ key: wrapInBlockquoteCommand.key }),
    bullet: () => ({ key: wrapInBulletListCommand.key }),
    ordered: () => ({ key: wrapInOrderedListCommand.key }),
    code: () => ({ key: toggleInlineCodeCommand.key }),
    codeblock: () => ({ key: createCodeBlockCommand.key, payload: '' }),
    hr: () => ({ key: insertHrCommand.key }),
    'task-list': () => ({ key: turnIntoTaskListCommand.key }),
    strikethrough: () => ({ key: toggleStrikethroughCommand.key }),
    highlight: () => ({ key: toggleHighlightCommand.key }),
    link: () => ({ key: insertLinkCommand.key }),
    image: () => ({ key: insertImageBlockCommand.key }),
    'internal-link': () => ({ key: insertInternalLinkCommand.key }),
    table: (options = {}) => ({
      key: insertTableCommand.key,
      payload: {
        row: normalizeTableDimension(options.row ?? options.rows ?? 3, 3),
        col: normalizeTableDimension(options.col ?? options.cols ?? 3, 3)
      }
    }),
    'table-add-row-before': () => ({ key: addRowBeforeCommand.key }),
    'table-add-row-after': () => ({ key: addRowAfterCommand.key }),
    'table-add-col-before': () => ({ key: addColBeforeCommand.key }),
    'table-add-col-after': () => ({ key: addColAfterCommand.key }),
    'table-delete-row': () => ({ key: deleteSelectedCellsCommand.key }),
    'table-delete-col': () => ({ key: deleteSelectedCellsCommand.key }),
    'table-delete-selection': () => ({ key: deleteSelectedCellsCommand.key }),
    'table-align-left': () => ({ key: setAlignCommand.key, payload: 'left' }),
    'table-align-center': () => ({ key: setAlignCommand.key, payload: 'center' }),
    'table-align-right': () => ({ key: setAlignCommand.key, payload: 'right' }),
    undo: () => ({ key: undoCommand.key }),
    redo: () => ({ key: redoCommand.key })
  };
}

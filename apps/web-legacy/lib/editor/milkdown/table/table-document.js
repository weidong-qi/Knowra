import { editorViewCtx, schemaCtx } from '@milkdown/kit/core';
import { findAncestorOfType } from '../utils/prosemirror-ranges.js';

function resolveTableMatchAtPos(doc, pos) {
  if (!doc || typeof pos !== 'number') {
    return null;
  }

  const maxPos = Math.max(0, doc.content.size);
  const safePos = Math.min(Math.max(0, pos), maxPos);
  return findAncestorOfType(doc.resolve(safePos), ['table']);
}

export function ensureTableHasHeaderRowAtPos(editor, tablePos) {
  if (!editor || typeof tablePos !== 'number') {
    return false;
  }

  const view = editor.ctx.get(editorViewCtx);
  const schema = editor.ctx.get(schemaCtx);
  const tableMatch = resolveTableMatchAtPos(view.state.doc, tablePos);
  if (!tableMatch?.node?.childCount) {
    return false;
  }

  const firstRow = tableMatch.node.firstChild;
  const headerRowType = schema.nodes.table_header_row;
  const headerCellType = schema.nodes.table_header;
  if (!firstRow || firstRow.type.name !== 'table_row' || !headerRowType || !headerCellType) {
    return false;
  }

  const headerCells = [];
  firstRow.forEach((cell) => {
    if (cell.type === headerCellType) {
      headerCells.push(cell);
      return;
    }

    headerCells.push(headerCellType.create(cell.attrs, cell.content, cell.marks));
  });

  const replacement = headerRowType.create(firstRow.attrs, headerCells, firstRow.marks);
  const firstRowPos = tableMatch.pos + 1;
  view.dispatch(view.state.tr.replaceWith(firstRowPos, firstRowPos + firstRow.nodeSize, replacement));
  return true;
}


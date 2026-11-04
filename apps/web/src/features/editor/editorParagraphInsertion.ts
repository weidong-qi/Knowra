import { NodeSelection, TextSelection, type Command } from '@milkdown/kit/prose/state';

/** 在当前块外插入正文；单元格内的操作始终作用于整张表的外部。 */
export function insertParagraphOutsideBlock(direction: 'above' | 'below'): Command {
  return (state, dispatch) => {
    const paragraph = state.schema.nodes.paragraph;
    if (!paragraph) return false;
    const { selection } = state;
    const { $from } = selection;
    let blockDepth = 0;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth);
      if (!blockDepth && node.isTextblock) blockDepth = depth;
      // 不在单元格中创建第二个 paragraph，也不依赖 replace 的自动结构拟合。
      if (node.type.spec.tableRole === 'table') blockDepth = depth;
    }
    let position: number;
    if (selection instanceof NodeSelection && selection.node.type.spec.tableRole === 'table') {
      position = direction === 'above' ? selection.from : selection.to;
    } else {
      if (!blockDepth) return false;
      position = direction === 'above' ? $from.before(blockDepth) : $from.after(blockDepth);
    }
    const $position = state.doc.resolve(position);
    const index = $position.index();
    if (!$position.parent.canReplaceWith(index, index, paragraph)) return false;
    if (dispatch) {
      const transaction = state.tr.insert(position, paragraph.create());
      transaction.setSelection(TextSelection.create(transaction.doc, position + 1));
      dispatch(transaction.scrollIntoView());
    }
    return true;
  };
}

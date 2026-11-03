import { TextSelection } from '@milkdown/kit/prose/state';

function findTextblockDepth(resolvedPosition) {
  for (let depth = resolvedPosition.depth; depth > 0; depth -= 1) {
    if (resolvedPosition.node(depth).isTextblock) {
      return depth;
    }
  }

  return null;
}

function getNextSibling(resolvedPosition, textblockDepth) {
  const parentDepth = textblockDepth - 1;
  const parent = resolvedPosition.node(parentDepth);
  const currentIndex = resolvedPosition.index(parentDepth);
  return {
    parent,
    currentIndex,
    nextSibling: parent.maybeChild(currentIndex + 1)
  };
}

function hasFollowingLine(nextSibling) {
  if (!nextSibling) {
    return false;
  }

  if (nextSibling.type.name === 'paragraph') {
    return true;
  }

  return nextSibling.textContent.trim().length > 0;
}

function appendTrailingParagraph({
  transaction,
  codeBlockPosition,
  codeBlockNode,
  parent,
  nextSiblingIndex,
  nextSibling,
  paragraphNodeType
}) {
  if (
    hasFollowingLine(nextSibling)
    || !parent.canReplaceWith(nextSiblingIndex, nextSiblingIndex, paragraphNodeType)
  ) {
    return;
  }

  transaction.insert(
    codeBlockPosition + codeBlockNode.nodeSize,
    paragraphNodeType.create()
  );
}

export function insertCodeBlockAtTyporaPosition(
  view,
  paragraphNodeType,
  codeBlockNodeType,
  language = ''
) {
  if (
    !view?.state?.selection
    || !paragraphNodeType
    || !codeBlockNodeType
  ) {
    return false;
  }

  const { state } = view;
  const { $from } = state.selection;
  const textblockDepth = findTextblockDepth($from);

  if (!Number.isInteger(textblockDepth) || textblockDepth <= 0) {
    return false;
  }

  const currentNode = $from.node(textblockDepth);
  const { parent, currentIndex, nextSibling } = getNextSibling($from, textblockDepth);
  const codeBlockNode = codeBlockNodeType.create({ language });
  const transaction = state.tr;
  const currentPosition = $from.before(textblockDepth);
  const currentIsCodeBlock = currentNode.type.name === 'code_block';
  const currentLineIsBlank = currentNode.textContent.trim().length === 0;

  if (
    !currentIsCodeBlock
    && currentLineIsBlank
    && parent.canReplaceWith(currentIndex, currentIndex + 1, codeBlockNodeType)
  ) {
    transaction.replaceWith(
      currentPosition,
      currentPosition + currentNode.nodeSize,
      codeBlockNode
    );
    appendTrailingParagraph({
      transaction,
      codeBlockPosition: currentPosition,
      codeBlockNode,
      parent,
      nextSiblingIndex: currentIndex + 1,
      nextSibling,
      paragraphNodeType
    });
    transaction.setSelection(TextSelection.create(transaction.doc, currentPosition + 1));
  } else {
    const insertPosition = $from.after(textblockDepth);
    const insertionIndex = currentIndex + 1;

    if (!parent.canReplaceWith(insertionIndex, insertionIndex, codeBlockNodeType)) {
      return false;
    }

    transaction.insert(insertPosition, codeBlockNode);
    appendTrailingParagraph({
      transaction,
      codeBlockPosition: insertPosition,
      codeBlockNode,
      parent,
      nextSiblingIndex: insertionIndex,
      nextSibling,
      paragraphNodeType
    });
    transaction.setSelection(TextSelection.create(transaction.doc, insertPosition + 1));
  }

  view.dispatch(transaction.scrollIntoView());
  view.focus?.();
  return true;
}

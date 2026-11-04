import { getNodeFromSchema } from '@milkdown/kit/prose';
import { TextSelection } from '@milkdown/kit/prose/state';
import { findAncestorOfType } from '../utils/prosemirror-ranges.js';

export function isContinuationParagraph($from, listItemAncestor) {
  const listItemNode = listItemAncestor?.node;
  const parent = $from.parent;
  return Boolean(
    listItemNode
    && parent.type.name === 'paragraph'
    && listItemNode.firstChild !== parent
    && listItemNode.childCount > 1
  );
}

export function indentContinuationParagraph(view, schema, $from, listItemAncestor) {
  const bulletListNodeType = getNodeFromSchema('bullet_list', schema);
  const listItemNodeType = getNodeFromSchema('list_item', schema);
  const paragraphNodeType = getNodeFromSchema('paragraph', schema);
  if (!bulletListNodeType || !listItemNodeType || !paragraphNodeType) {
    return false;
  }

  const listItemNode = listItemAncestor.node;
  const listItemPos = listItemAncestor.pos;

  let childIndex = -1;
  listItemNode.forEach((child, offset, index) => {
    if (child === $from.parent) {
      childIndex = index;
    }
  });
  if (childIndex <= 0) {
    return false;
  }

  let existingNestedList = null;
  let existingNestedIndex = -1;
  listItemNode.forEach((child, offset, index) => {
    if (index > childIndex && (child.type.name === 'bullet_list' || child.type.name === 'ordered_list')) {
      if (!existingNestedList) {
        existingNestedList = child;
        existingNestedIndex = index;
      }
    }
  });

  const newChildren = [];
  let cursorTarget = -1;
  listItemNode.forEach((child, offset, index) => {
    if (index < childIndex) {
      newChildren.push(child);
    } else if (index === childIndex) {
      const newContParagraph = paragraphNodeType.create(null, child.content);
      const newContItem = listItemNodeType.create({}, [newContParagraph]);

      if (existingNestedList) {
        const extendedChildren = [];
        existingNestedList.forEach((nestedChild) => extendedChildren.push(nestedChild));
        extendedChildren.push(newContItem);
        const extendedList = existingNestedList.type.create(existingNestedList.attrs, extendedChildren);
        newChildren.push(extendedList);
        cursorTarget = newChildren.length - 1;
      } else {
        const newBulletList = bulletListNodeType.create(null, [newContItem]);
        newChildren.push(newBulletList);
        cursorTarget = newChildren.length - 1;
      }
    } else if (index !== existingNestedIndex) {
      newChildren.push(child);
    }
  });

  const newListItem = listItemNodeType.create(listItemNode.attrs, newChildren);
  const listItemEnd = listItemPos + listItemNode.nodeSize;

  let tr = view.state.tr.replaceRangeWith(listItemPos, listItemEnd, newListItem);

  let accumulated = listItemPos + 1;
  for (let i = 0; i < cursorTarget; i += 1) {
    accumulated += newListItem.child(i).nodeSize;
  }
  accumulated += 1;

  tr = tr.setSelection(TextSelection.create(tr.doc, accumulated)).scrollIntoView();
  view.dispatch(tr);
  view.focus();
  return true;
}

export function outdentContinuationParagraph(view, schema, $from, listItemAncestor) {
  const listItemNodeType = getNodeFromSchema('list_item', schema);
  const paragraphNodeType = getNodeFromSchema('paragraph', schema);
  if (!listItemNodeType || !paragraphNodeType) {
    return false;
  }

  const listItemNode = listItemAncestor.node;

  let childIndex = -1;
  listItemNode.forEach((child, offset, index) => {
    if (child === $from.parent) {
      childIndex = index;
    }
  });
  if (childIndex <= 0) {
    return false;
  }

  const parentList = findAncestorOfType($from, new Set(['bullet_list', 'ordered_list']));
  if (!parentList) {
    return false;
  }

  const parentListChildren = [];
  let cursorTarget = -1;

  parentList.node.forEach((child) => {
    if (child === listItemNode) {
      const keptChildren = [];
      child.forEach((grandchild, offset, index) => {
        if (index < childIndex) {
          keptChildren.push(grandchild);
        }
      });
      parentListChildren.push(listItemNodeType.create(child.attrs, keptChildren));

      const contContent = [paragraphNodeType.create(null, $from.parent.content)];
      parentListChildren.push(listItemNodeType.create({}, contContent));
      cursorTarget = parentListChildren.length - 1;
    } else {
      parentListChildren.push(child);
    }
  });

  const newParentList = parentList.node.type.create(parentList.node.attrs, parentListChildren);
  const parentListEnd = parentList.pos + parentList.node.nodeSize;

  let tr = view.state.tr.replaceRangeWith(parentList.pos, parentListEnd, newParentList);

  let cursorPos = parentList.pos + 1;
  for (let i = 0; i < cursorTarget; i += 1) {
    cursorPos += newParentList.child(i).nodeSize;
  }
  cursorPos += 1;

  tr = tr.setSelection(TextSelection.create(tr.doc, cursorPos)).scrollIntoView();
  view.dispatch(tr);
  view.focus();
  return true;
}

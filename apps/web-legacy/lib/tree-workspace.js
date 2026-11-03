function cloneFolderNode(node) {
  return {
    ...node,
    children: Array.isArray(node.children) ? node.children.map(cloneFolderNode) : []
  };
}

export function cloneFolderTree(tree = []) {
  return Array.isArray(tree) ? tree.map(cloneFolderNode) : [];
}

export function buildTreeFromFlatFolders(folders = []) {
  const byId = new Map();

  folders.forEach((folder) => {
    byId.set(folder.id, {
      ...folder,
      children: []
    });
  });

  const roots = [];
  byId.forEach((folder) => {
    if (folder.parentId && byId.has(folder.parentId)) {
      byId.get(folder.parentId).children.push(folder);
      return;
    }
    roots.push(folder);
  });

  return roots;
}

export function flattenFolderTree(nodes = [], result = {}) {
  nodes.forEach((node) => {
    result[node.id] = {
      id: node.id,
      name: node.name,
      parentId: node.parentId ?? null,
      spaceId: node.spaceId ?? null
    };
    flattenFolderTree(node.children ?? [], result);
  });

  return result;
}

export function findFolderNode(nodes = [], folderId) {
  for (const node of nodes) {
    if (node.id === folderId) {
      return node;
    }

    const childMatch = findFolderNode(node.children ?? [], folderId);
    if (childMatch) {
      return childMatch;
    }
  }

  return null;
}

export function collectFolderSubtreeIds(nodes = [], targetId, result = new Set()) {
  nodes.forEach((node) => {
    if (node.id === targetId) {
      collectNestedFolderIds(node, result);
      return;
    }
    collectFolderSubtreeIds(node.children ?? [], targetId, result);
  });

  return result;
}

function collectNestedFolderIds(node, result) {
  result.add(node.id);
  (node.children ?? []).forEach((child) => collectNestedFolderIds(child, result));
}

export function removeFolderNode(nodes = [], folderId) {
  return nodes
    .filter((node) => node.id !== folderId)
    .map((node) => ({
      ...node,
      children: removeFolderNode(node.children ?? [], folderId)
    }));
}

export function insertFolder(tree = [], folder) {
  const nextTree = cloneFolderTree(tree);
  const nextFolder = {
    ...folder,
    children: []
  };

  if (!nextFolder.parentId) {
    nextTree.push(nextFolder);
    return nextTree;
  }

  const parentNode = findFolderNode(nextTree, nextFolder.parentId);
  if (!parentNode) {
    nextTree.push(nextFolder);
    return nextTree;
  }

  parentNode.children = parentNode.children ?? [];
  parentNode.children.push(nextFolder);
  return nextTree;
}

export function renameFolder(tree = [], folderId, nextName) {
  const nextTree = cloneFolderTree(tree);
  const target = findFolderNode(nextTree, folderId);

  if (target) {
    target.name = nextName;
  }

  return nextTree;
}

export function moveFolder(tree = [], folderId, nextParentId) {
  if (folderId === nextParentId) {
    throw new Error('Folder cannot be moved into itself');
  }

  const currentTree = cloneFolderTree(tree);
  const target = findFolderNode(currentTree, folderId);
  if (!target) {
    return currentTree;
  }

  if (nextParentId) {
    const subtreeIds = collectFolderSubtreeIds(currentTree, folderId, new Set());
    if (subtreeIds.has(nextParentId)) {
      throw new Error('Folder cannot move under its descendant');
    }
  }

  const detachedTree = removeFolderNode(currentTree, folderId);
  const movedFolder = {
    ...target,
    parentId: nextParentId ?? null
  };

  if (!nextParentId) {
    detachedTree.push(movedFolder);
    return detachedTree;
  }

  const nextParent = findFolderNode(detachedTree, nextParentId);
  if (!nextParent) {
    detachedTree.push(movedFolder);
    return detachedTree;
  }

  nextParent.children = nextParent.children ?? [];
  nextParent.children.push(movedFolder);
  return detachedTree;
}

export function deleteFolder(tree = [], notes = [], folderId) {
  const deletedIds = collectFolderSubtreeIds(tree, folderId, new Set());
  const nextTree = removeFolderNode(cloneFolderTree(tree), folderId);
  const nextNotes = notes.map((note) => (
    deletedIds.has(note.folderId)
      ? { ...note, folderId: null }
      : note
  ));

  return {
    tree: nextTree,
    notes: nextNotes,
    deletedIds
  };
}

export function insertNote(notes = [], note) {
  return [...notes, { ...note }];
}

export function renameNote(notes = [], noteId, nextTitle) {
  return notes.map((note) => (
    note.id === noteId
      ? { ...note, title: nextTitle }
      : note
  ));
}

export function deleteNote(notes = [], noteId) {
  return notes.filter((note) => note.id !== noteId);
}

export function moveNote(notes = [], noteId, nextFolderId) {
  return notes.map((note) => (
    note.id === noteId
      ? { ...note, folderId: nextFolderId ?? null }
      : note
  ));
}

export function resolveNoteVisualType(note = {}) {
  const title = String(note.title ?? '').toLowerCase();
  const sourceType = String(note.sourceType ?? '').toLowerCase();

  if (title.endsWith('.pdf') || sourceType.includes('pdf')) {
    return 'pdf';
  }

  if (
    title.endsWith('.md')
    || title.endsWith('.markdown')
    || sourceType === 'manual'
    || sourceType === 'markdown-import'
  ) {
    return 'markdown';
  }

  return 'resource';
}

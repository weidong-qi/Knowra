import { buildTreeFromFlatFolders, flattenFolderTree } from './tree-workspace.js';

export function buildMockWorkspaceState(seed, {
  spaceId = 'space-local-preview',
  spaceName = '本地演示空间'
} = {}) {
  const mockSpace = {
    id: spaceId,
    name: spaceName
  };
  const folders = (seed.folders ?? []).map((folder) => ({
    ...folder,
    spaceId: mockSpace.id
  }));
  const notes = (seed.notes ?? []).map((note) => ({
    ...note,
    spaceId: mockSpace.id,
    tagIds: [...(note.tagIds ?? [])],
    internalLinks: [...(note.internalLinks ?? [])]
  }));
  const folderTree = buildTreeFromFlatFolders(folders);
  const foldersById = flattenFolderTree(folderTree);

  return {
    spaces: [mockSpace],
    currentSpaceId: mockSpace.id,
    folderTree,
    foldersById,
    tags: [...(seed.tags ?? [])],
    allNotes: notes,
    openFolders: Object.fromEntries(Object.keys(foldersById).map((folderId) => [folderId, true]))
  };
}

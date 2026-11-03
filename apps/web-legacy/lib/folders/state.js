export function createLocalFolderInput({
  name,
  parentId = null,
  spaceId = null,
  id = `folder-${Date.now().toString(36)}`
}) {
  return {
    id,
    name,
    parentId,
    spaceId
  };
}

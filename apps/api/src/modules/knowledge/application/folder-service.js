import { Folder } from '../domain/folder.ts';
import { buildCreateFolderDto, buildUpdateFolderDto } from './dto/folder.dto.ts';
import { createInMemoryFolderRepository } from '../infrastructure/folder-repository.js';
import { conflictError, notFoundError } from './knowledge-errors.js';

export function createFolderService({
  repository = createInMemoryFolderRepository(),
  validateSiblingNameConflict = null,
  validateSpaceReference = null
} = {}) {
  function requireFolder(folderId) {
    const folder = repository.findById(folderId);

    if (!folder) {
      throw notFoundError('FOLDER_NOT_FOUND', 'Folder not found');
    }

    return folder;
  }

  function requireActiveFolder(folderId) {
    const folder = requireFolder(folderId);
    if (folder.deletedAt) throw conflictError('FOLDER_IN_TRASH', '文件夹位于回收站');
    return folder;
  }

  function normalizeSegment(name) {
    return (
      String(name ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'folder'
    );
  }

  function buildPathCache({ name, parentFolder }) {
    const segment = normalizeSegment(name);

    if (!parentFolder) {
      return `/${segment}`;
    }

    return `${parentFolder.pathCache}/${segment}`.replace(/\/+/g, '/');
  }

  function validateParent(spaceId, parentId, currentFolderId = null) {
    if (!parentId) {
      return null;
    }

    if (currentFolderId && parentId === currentFolderId) {
      throw conflictError('FOLDER_PARENT_CONFLICT', 'Folder cannot be its own parent');
    }

    const parentFolder = requireActiveFolder(parentId);

    if (parentFolder.spaceId !== spaceId) {
      throw conflictError('FOLDER_SPACE_MISMATCH', 'Parent folder must belong to the same space');
    }

    if (currentFolderId) {
      let cursor = parentFolder;
      while (cursor) {
        if (cursor.id === currentFolderId) {
          throw conflictError('FOLDER_DESCENDANT_CONFLICT', 'Folder cannot move under its descendant');
        }
        cursor = cursor.parentId ? repository.findById(cursor.parentId) : null;
      }
    }

    return parentFolder;
  }

  function reindexDescendants(parentFolder) {
    const descendants = repository
      .list({ spaceId: parentFolder.spaceId })
      .filter(folder => folder.parentId === parentFolder.id);

    descendants.forEach(folder => {
      const updatedFolder = new Folder({
        ...folder,
        pathCache: buildPathCache({
          name: folder.name,
          parentFolder
        })
      });
      repository.save(updatedFolder);
      reindexDescendants(updatedFolder);
    });
  }

  function collectSubtreeIds(folderId) {
    const allFolders = repository.list({ includeDeleted: true });
    const ids = new Set([folderId]);
    const queue = [folderId];

    while (queue.length) {
      const currentId = queue.shift();
      allFolders
        .filter(folder => folder.parentId === currentId)
        .forEach(folder => {
          if (!ids.has(folder.id)) {
            ids.add(folder.id);
            queue.push(folder.id);
          }
        });
    }

    return [...ids];
  }

  return {
    createFolder(input) {
      const dto = buildCreateFolderDto(input);
      if (repository.findById(dto.id)) {
        throw conflictError('FOLDER_ID_CONFLICT', 'A folder with the same id already exists');
      }
      validateSpaceReference?.(dto.spaceId);
      validateSiblingNameConflict?.({
        spaceId: dto.spaceId,
        parentId: dto.parentId ?? null,
        name: dto.name,
        currentFolderId: null
      });
      const parentFolder = validateParent(dto.spaceId, dto.parentId);
      const folder = new Folder({
        ...dto,
        pathCache: buildPathCache({
          name: dto.name,
          parentFolder
        })
      });
      repository.save(folder);
      return folder;
    },
    updateFolder(folderId, updates) {
      const currentFolder = requireActiveFolder(folderId);
      const dto = buildUpdateFolderDto(updates);
      const nextParentId = dto.parentId !== undefined ? dto.parentId : currentFolder.parentId;
      validateSiblingNameConflict?.({
        spaceId: currentFolder.spaceId,
        parentId: nextParentId ?? null,
        name: dto.name ?? currentFolder.name,
        currentFolderId: currentFolder.id
      });
      const parentFolder = validateParent(currentFolder.spaceId, nextParentId, currentFolder.id);
      const updatedFolder = new Folder({
        ...currentFolder,
        ...dto,
        id: currentFolder.id,
        spaceId: currentFolder.spaceId,
        pathCache: buildPathCache({
          name: dto.name ?? currentFolder.name,
          parentFolder
        })
      });

      repository.save(updatedFolder);
      reindexDescendants(updatedFolder);
      return updatedFolder;
    },
    trashFolder(folderId, deletionPackage) {
      requireActiveFolder(folderId);
      const deletedIds = collectSubtreeIds(folderId);
      const deletedAt = new Date().toISOString();
      return deletedIds.map(id =>
        repository.save(
          new Folder({
            ...requireActiveFolder(id),
            deletedAt,
            deletionPackage: id === folderId ? deletionPackage : null,
            updatedAt: deletedAt
          })
        )
      );
    },
    restoreDeletedFolder(folderId) {
      const root = requireFolder(folderId);
      if (!root.deletedAt || !root.deletionPackage) throw conflictError('FOLDER_NOT_IN_TRASH', '文件夹不在回收站中');
      const folders = root.deletionPackage.folderIds.map(id => requireFolder(id));
      for (const folder of folders)
        validateSiblingNameConflict?.({
          spaceId: folder.spaceId,
          parentId: folder.parentId,
          name: folder.name,
          currentFolderId: folder.id
        });
      return folders.map(folder =>
        repository.save(
          new Folder({ ...folder, deletedAt: null, deletionPackage: null, updatedAt: new Date().toISOString() })
        )
      );
    },
    listFolders(options = {}) {
      return repository.list(options);
    },
    listFolderTree(options = {}) {
      const folders = repository.list(options);
      const byParent = new Map();

      folders.forEach(folder => {
        const key = folder.parentId ?? '__root__';
        const list = byParent.get(key) ?? [];
        list.push(folder);
        byParent.set(key, list);
      });

      function buildNodes(parentId = null) {
        const key = parentId ?? '__root__';
        return (byParent.get(key) ?? [])
          .sort((left, right) => left.name.localeCompare(right.name))
          .map(folder => ({
            ...folder,
            children: buildNodes(folder.id)
          }));
      }

      return buildNodes();
    },
    getFolderSubtreeIds(folderId) {
      requireFolder(folderId);
      return collectSubtreeIds(folderId);
    }
  };
}

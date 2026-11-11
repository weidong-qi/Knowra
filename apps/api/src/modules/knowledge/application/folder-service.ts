import { Folder } from '../domain/folder.ts';
import { buildCreateFolderDto, buildUpdateFolderDto } from './dto/folder.dto.ts';
import { createInMemoryFolderRepository } from '../infrastructure/folder-repository.ts';
import { conflictError, notFoundError } from './knowledge-errors.ts';

import type { FolderDeletionPackage } from '../domain/folder.ts';
import type { FolderDtoInput } from './dto/folder.dto.ts';
import type { FolderRecord, FolderRepository, FolderListOptions } from '../infrastructure/folder-repository.ts';

export interface FolderSiblingNameInput {
  spaceId: string;
  parentId?: string | null;
  name: string;
  currentFolderId: string | null;
}

export interface FolderServiceDependencies {
  repository?: Pick<FolderRepository, 'findById' | 'list' | 'save'>;
  validateSiblingNameConflict?: ((input: FolderSiblingNameInput) => void) | null;
  validateSpaceReference?: ((spaceId: string) => void) | null;
}

export type FolderTreeNode<Record = FolderRecord> = Record & { children: FolderTreeNode<Record>[] };

export function createFolderService({
  repository = createInMemoryFolderRepository(),
  validateSiblingNameConflict = null,
  validateSpaceReference = null
}: FolderServiceDependencies = {}) {
  function requireFolder(folderId: string | null | undefined) {
    const folder = repository.findById(folderId);

    if (!folder) {
      throw notFoundError('FOLDER_NOT_FOUND', 'Folder not found');
    }

    return folder;
  }

  function requireActiveFolder(folderId: string | null | undefined) {
    const folder = requireFolder(folderId);
    if (folder.deletedAt) throw conflictError('FOLDER_IN_TRASH', '文件夹位于回收站');
    return folder;
  }

  function normalizeSegment(name: string) {
    return (
      String(name ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'folder'
    );
  }

  function buildPathCache({ name, parentFolder }: { name: string; parentFolder: FolderRecord | null }) {
    const segment = normalizeSegment(name);

    if (!parentFolder) {
      return `/${segment}`;
    }

    return `${parentFolder.pathCache}/${segment}`.replace(/\/+/g, '/');
  }

  function validateParent(spaceId: string, parentId: string | null | undefined, currentFolderId: string | null = null) {
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
      let cursor: FolderRecord | null = parentFolder;
      while (cursor) {
        if (cursor.id === currentFolderId) {
          throw conflictError('FOLDER_DESCENDANT_CONFLICT', 'Folder cannot move under its descendant');
        }
        cursor = cursor.parentId ? repository.findById(cursor.parentId) : null;
      }
    }

    return parentFolder;
  }

  function reindexDescendants(parentFolder: FolderRecord): void {
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

  function collectSubtreeIds<Id extends string | null | undefined>(folderId: Id) {
    const allFolders = repository.list({ includeDeleted: true });
    const ids = new Set<Id | string>([folderId]);
    const queue: (Id | string)[] = [folderId];

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
    createFolder(input?: FolderDtoInput) {
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
    updateFolder(folderId: string | null | undefined, updates?: FolderDtoInput) {
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
    trashFolder(folderId: string, deletionPackage: FolderDeletionPackage | null) {
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
    restoreDeletedFolder(folderId: string | null | undefined) {
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
    listFolders(options: FolderListOptions = {}) {
      return repository.list(options);
    },
    listFolderTree(options: FolderListOptions = {}) {
      const folders = repository.list(options);
      const byParent = new Map<string, FolderRecord[]>();

      folders.forEach(folder => {
        const key = folder.parentId ?? '__root__';
        const list = byParent.get(key) ?? [];
        list.push(folder);
        byParent.set(key, list);
      });

      function buildNodes(parentId: string | null = null): FolderTreeNode[] {
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
    getFolderSubtreeIds<Id extends string | null | undefined>(folderId: Id) {
      requireFolder(folderId);
      return collectSubtreeIds(folderId);
    }
  };
}

import { Folder } from '../../domain/folder.ts';
import { buildCreateFolderDto, buildUpdateFolderDto } from '../dto/folder.dto.ts';
import { conflictError, notFoundError } from '../knowledge-errors.ts';

import type { Prisma } from '@prisma/client';
import type { FolderDeletionPackage } from '../../domain/folder.ts';
import type { FolderDtoInput } from '../dto/folder.dto.ts';
import type { FolderRecord, FolderListOptions } from '../../infrastructure/folder-repository.ts';
import type { FolderSiblingNameInput, FolderTreeNode } from '../folder-service.ts';

type MaybePromise<Value> = Value | PromiseLike<Value>;
// PostgreSQL 原始 JSON 由恢复流程按原有 folderIds 形状读取，不在类型迁移中补做校验。
export type AsyncFolderRecord = Omit<FolderRecord, 'deletionPackage'> & {
  deletionPackage?: FolderDeletionPackage | Prisma.JsonValue;
};
export interface AsyncFolderServiceDependencies {
  repository?: {
    findById: (id: string | null | undefined) => MaybePromise<AsyncFolderRecord | null>;
    list: (options?: FolderListOptions) => MaybePromise<AsyncFolderRecord[]>;
    save: (folder: AsyncFolderRecord) => MaybePromise<AsyncFolderRecord>;
  };
  validateSiblingNameConflict?: ((input: FolderSiblingNameInput) => void | PromiseLike<void>) | null;
  validateSpaceReference?: ((spaceId: string) => void | PromiseLike<void>) | null;
}
export function createAsyncFolderService({
  repository,
  validateSiblingNameConflict = null,
  validateSpaceReference = null
}: AsyncFolderServiceDependencies = {}) {
  if (!repository) throw new TypeError('Async folder service requires a repository');

  async function requireFolder(folderId: string | null | undefined) {
    const folder = await repository!.findById(folderId);
    if (!folder) throw notFoundError('FOLDER_NOT_FOUND', 'Folder not found');
    return folder;
  }
  async function requireActiveFolder(folderId: string | null | undefined) {
    const folder = await requireFolder(folderId);
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

  function buildPathCache({ name, parentFolder }: { name: string; parentFolder: AsyncFolderRecord | null }) {
    const segment = normalizeSegment(name);
    if (!parentFolder) return `/${segment}`;
    return `${parentFolder.pathCache}/${segment}`.replace(/\/+/g, '/');
  }

  async function validateParent(
    spaceId: string,
    parentId: string | null | undefined,
    currentFolderId: string | null = null
  ) {
    if (!parentId) return null;
    if (currentFolderId && parentId === currentFolderId) {
      throw conflictError('FOLDER_PARENT_CONFLICT', 'Folder cannot be its own parent');
    }
    const parentFolder = await requireActiveFolder(parentId);
    if (parentFolder.spaceId !== spaceId) {
      throw conflictError('FOLDER_SPACE_MISMATCH', 'Parent folder must belong to the same space');
    }
    if (currentFolderId) {
      let cursor: AsyncFolderRecord | null = parentFolder;
      while (cursor) {
        if (cursor.id === currentFolderId) {
          throw conflictError('FOLDER_DESCENDANT_CONFLICT', 'Folder cannot move under its descendant');
        }
        cursor = cursor.parentId ? await repository!.findById(cursor.parentId) : null;
      }
    }
    return parentFolder;
  }

  async function reindexDescendants(parentFolder: AsyncFolderRecord): Promise<void> {
    const descendants = (await repository!.list({ spaceId: parentFolder.spaceId })).filter(
      folder => folder.parentId === parentFolder.id
    );
    for (const folder of descendants) {
      const updatedFolder = new Folder({
        ...folder,
        pathCache: buildPathCache({ name: folder.name, parentFolder })
      });
      const saved = await repository!.save(updatedFolder);
      await reindexDescendants(saved);
    }
  }

  async function collectSubtreeIds<Id extends string | null | undefined>(folderId: Id) {
    const allFolders = await repository!.list({ includeDeleted: true });
    const ids = new Set<string | Id>([folderId]);
    const queue: (string | Id)[] = [folderId];
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
    async createFolder(input?: FolderDtoInput) {
      const dto = buildCreateFolderDto(input);
      if (await repository.findById(dto.id)) {
        throw conflictError('FOLDER_ID_CONFLICT', 'A folder with the same id already exists');
      }
      await validateSpaceReference?.(dto.spaceId);
      await validateSiblingNameConflict?.({
        spaceId: dto.spaceId,
        parentId: dto.parentId ?? null,
        name: dto.name,
        currentFolderId: null
      });
      const parentFolder = await validateParent(dto.spaceId, dto.parentId);
      return repository.save(
        new Folder({
          ...dto,
          pathCache: buildPathCache({ name: dto.name, parentFolder })
        })
      );
    },
    async updateFolder(folderId: string | null | undefined, updates?: FolderDtoInput) {
      const currentFolder = await requireActiveFolder(folderId);
      const dto = buildUpdateFolderDto(updates);
      const nextParentId = dto.parentId !== undefined ? dto.parentId : currentFolder.parentId;
      await validateSiblingNameConflict?.({
        spaceId: currentFolder.spaceId,
        parentId: nextParentId ?? null,
        name: dto.name ?? currentFolder.name,
        currentFolderId: currentFolder.id
      });
      const parentFolder = await validateParent(currentFolder.spaceId, nextParentId, currentFolder.id);
      const updatedFolder = await repository.save(
        new Folder({
          ...currentFolder,
          ...dto,
          id: currentFolder.id,
          spaceId: currentFolder.spaceId,
          pathCache: buildPathCache({
            name: dto.name ?? currentFolder.name,
            parentFolder
          })
        })
      );
      await reindexDescendants(updatedFolder);
      return updatedFolder;
    },
    async trashFolder(folderId: string, deletionPackage: FolderDeletionPackage | null) {
      await requireActiveFolder(folderId);
      const deletedIds = await collectSubtreeIds(folderId);
      const deletedAt = new Date().toISOString();
      const result = [];
      for (const id of deletedIds)
        result.push(
          await repository.save(
            new Folder({
              ...(await requireActiveFolder(id)),
              deletedAt,
              deletionPackage: id === folderId ? deletionPackage : null,
              updatedAt: deletedAt
            })
          )
        );
      return result;
    },
    async restoreDeletedFolder(folderId: string | null | undefined) {
      const root = await requireFolder(folderId);
      if (!root.deletedAt || !root.deletionPackage) throw conflictError('FOLDER_NOT_IN_TRASH', '文件夹不在回收站中');
      const folders = await Promise.all(
        (root.deletionPackage as { folderIds: string[] }).folderIds.map(id => requireFolder(id))
      );
      for (const folder of folders)
        await validateSiblingNameConflict?.({
          spaceId: folder.spaceId,
          parentId: folder.parentId,
          name: folder.name,
          currentFolderId: folder.id
        });
      const result = [];
      for (const folder of folders)
        result.push(
          await repository.save(
            new Folder({ ...folder, deletedAt: null, deletionPackage: null, updatedAt: new Date().toISOString() })
          )
        );
      return result;
    },
    listFolders(options: FolderListOptions = {}) {
      return repository.list(options);
    },
    async listFolderTree(options: FolderListOptions = {}) {
      const folders = await repository.list(options);
      const byParent = new Map<string, AsyncFolderRecord[]>();
      folders.forEach(folder => {
        const key = folder.parentId ?? '__root__';
        const list = byParent.get(key) ?? [];
        list.push(folder);
        byParent.set(key, list);
      });
      function buildNodes(parentId: string | null = null): FolderTreeNode<AsyncFolderRecord>[] {
        const key = parentId ?? '__root__';
        return (byParent.get(key) ?? [])
          .sort((left, right) => left.name.localeCompare(right.name))
          .map(folder => ({ ...folder, children: buildNodes(folder.id) }));
      }
      return buildNodes();
    },
    async getFolderSubtreeIds<Id extends string | null | undefined>(folderId: Id) {
      await requireFolder(folderId);
      return collectSubtreeIds(folderId);
    }
  };
}

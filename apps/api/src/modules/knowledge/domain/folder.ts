export interface FolderDeletionPackage {
  id: string;
  mode: 'keep' | 'with-content';
  folderIds: string[];
  noteIds: string[];
  destinationId: string | null;
}

export interface FolderConstructorInput<DeletionPackage = FolderDeletionPackage> {
  id: string;
  spaceId: string;
  name: string;
  parentId?: string | null;
  pathCache?: string | null;
  sortOrder?: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  deletedAt?: string | null;
  deletionPackage?: DeletionPackage | null;
}

export class Folder<DeletionPackage = FolderDeletionPackage> {
  declare id: string;
  declare spaceId: string;
  declare name: string;
  declare parentId: string | null;
  declare pathCache: string | null;
  declare sortOrder: number;
  declare createdAt: string | null;
  declare updatedAt: string | null;
  declare deletedAt: string | null;
  declare deletionPackage: DeletionPackage | null;

  constructor({
    id,
    spaceId,
    name,
    parentId = null,
    pathCache = '/',
    sortOrder = 0,
    createdAt = new Date().toISOString(),
    updatedAt = createdAt,
    deletedAt = null,
    deletionPackage = null
  }: FolderConstructorInput<DeletionPackage>) {
    if (!id?.trim()) {
      throw new Error('Folder id is required');
    }
    if (!spaceId?.trim()) {
      throw new Error('Folder spaceId is required');
    }
    if (!name?.trim()) {
      throw new Error('Folder name is required');
    }

    this.id = id;
    this.spaceId = spaceId;
    this.name = name.trim();
    this.parentId = parentId;
    this.pathCache = pathCache;
    this.sortOrder = sortOrder;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.deletedAt = deletedAt;
    this.deletionPackage = deletionPackage;
  }
}

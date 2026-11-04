import type * as Models from '@prisma/client';

export interface NavigationDates {
  createdAt?: unknown;
  updatedAt?: unknown;
}
export interface SpaceWriteInput extends NavigationDates {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  defaultFlag?: boolean | null;
}
export interface FolderWriteInput extends NavigationDates {
  id: string;
  spaceId: string;
  name: string;
  parentId?: string | null;
  pathCache?: string | null;
  sortOrder?: unknown;
  deletedAt?: unknown;
  deletionPackage?: unknown;
}
export interface TagWriteInput extends NavigationDates {
  id: string;
  spaceId: string;
  name: string;
  color?: unknown;
  groupId?: string | null;
  code?: string | null;
  isSystem?: unknown;
  sortOrder?: unknown;
}
export interface TagGroupWriteInput extends NavigationDates {
  id: string;
  spaceId: string;
  name: string;
  code?: string | null;
  selectionMode?: unknown;
  isSystem?: unknown;
  sortOrder?: unknown;
}
type StoredDates = { createdAt: Date; updatedAt: Date };
export type SpaceWriteData = StoredDates & {
  id: string;
  userId: string;
  name: string;
  description: string;
  defaultFlag: boolean;
};
export type FolderWriteData = StoredDates & {
  id: string;
  spaceId: string;
  name: string;
  parentId: string | null;
  pathCache: string;
  sortOrder: number;
  deletedAt: Date | null;
  deletionPackage: unknown;
};
export type TagWriteData = StoredDates & {
  id: string;
  spaceId: string;
  name: string;
  color: unknown;
  groupId: string | null;
  code: string | null;
  isSystem: boolean;
  sortOrder: number;
};
export type TagGroupWriteData = StoredDates & {
  id: string;
  spaceId: string;
  name: string;
  code: string | null;
  selectionMode: unknown;
  isSystem: boolean;
  sortOrder: number;
};
export interface NavigationOrder {
  updatedAt?: 'desc';
  sortOrder?: 'asc';
  name?: 'asc';
}
export interface SpaceListOptions {
  userId?: unknown;
}
export interface NavigationListOptions {
  spaceId?: unknown;
}
export interface FolderListOptions extends NavigationListOptions {
  includeDeleted?: unknown;
}
export interface SpaceWhere {
  userId?: unknown;
}
export interface FolderWhere {
  spaceId?: unknown;
  deletedAt?: null;
}
export interface TagWhere {
  spaceId?: unknown;
  id?: { in: unknown[] };
}
export interface GroupWhere {
  spaceId?: unknown;
}

/** 写入保留原投影；实际 SDK 仍验证这些值，并可能原样拒绝。 */
export interface NavigationDelegate<Row, Data, Where> {
  upsert(input: { where: { id: string }; create: Data; update: Partial<Data> }): PromiseLike<Row>;
  findUnique(input: { where: { id: unknown } }): PromiseLike<Row | null>;
  delete(input: { where: { id: unknown } }): PromiseLike<Row>;
  findMany(input: { where: Where; orderBy?: NavigationOrder | NavigationOrder[] }): PromiseLike<Row[]>;
}
export interface TagGroupDelegate extends NavigationDelegate<Models.TagGroup, TagGroupWriteData, GroupWhere> {
  create(input: { data: TagGroupWriteData }): PromiseLike<Models.TagGroup>;
  update(input: { where: { id: unknown }; data: { spaceId: unknown } }): PromiseLike<Models.TagGroup>;
}
export interface SpaceRepositoryOptions {
  db: { knowledgeSpace: NavigationDelegate<Models.KnowledgeSpace, SpaceWriteData, SpaceWhere> };
}
export interface FolderRepositoryOptions {
  db: { folder: NavigationDelegate<Models.Folder, FolderWriteData, FolderWhere> };
}
export interface TagRepositoryOptions {
  db: { tag: NavigationDelegate<Models.Tag, TagWriteData, TagWhere> };
}
export interface TagGroupRepositoryOptions {
  db: { tagGroup: TagGroupDelegate };
}

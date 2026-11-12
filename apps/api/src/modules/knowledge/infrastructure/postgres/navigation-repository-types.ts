import type * as Models from '@prisma/client';
import type { Prisma } from '@prisma/client';

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
  deletionPackage: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
};
export type TagWriteData = StoredDates & {
  id: string;
  spaceId: string;
  name: string;
  color: string;
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
  selectionMode: string | undefined;
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
  userId?: string;
}
export interface FolderWhere {
  spaceId?: string;
  deletedAt?: null;
}
export interface TagWhere {
  spaceId?: string;
  id?: { in: string[] };
}
export interface GroupWhere {
  spaceId?: string;
}

/** 数据库端口只接受 Prisma 可写字段；原始输入在调用边界保留 SDK 校验时序。 */
export interface NavigationDelegate<Row, Data, Where> {
  upsert(input: { where: { id: string }; create: Data; update: Partial<Data> }): PromiseLike<Row>;
  findUnique(input: { where: { id: string } }): PromiseLike<Row | null>;
  delete(input: { where: { id: string } }): PromiseLike<Row>;
  findMany(input: { where: Where; orderBy?: NavigationOrder | NavigationOrder[] }): PromiseLike<Row[]>;
}
export interface TagGroupDelegate extends NavigationDelegate<Models.TagGroup, TagGroupWriteData, GroupWhere> {
  create(input: { data: TagGroupWriteData }): PromiseLike<Models.TagGroup>;
  update(input: { where: { id: string }; data: { spaceId: string } }): PromiseLike<Models.TagGroup>;
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

import { validationError } from '../knowledge-errors.ts';
import type { NavigationReferenceRecord } from '../navigation-reference-policy.ts';
export type MaybePromise<T> = T | PromiseLike<T>;
export interface AsyncNavigationReferenceReader {
  findById: (id: unknown) => MaybePromise<NavigationReferenceRecord | null | undefined>;
}
export interface AsyncNavigationReferencePolicyOptions {
  knowledgeSpaceRepository: { findById: (id: unknown) => unknown };
  folderRepository: AsyncNavigationReferenceReader;
  tagRepository: {
    findByIds: (ids: Iterable<unknown>) => MaybePromise<Pick<ReadonlyArray<NavigationReferenceRecord>, 'map'>>;
  };
  tagGroupRepository: AsyncNavigationReferenceReader;
}
export interface AsyncNoteReferenceInput {
  spaceId?: unknown;
  folderId?: unknown;
  tagIds?: Iterable<unknown> | null | undefined;
}
export interface AsyncNavigationReferencePolicy {
  assertSpaceReference(spaceId: unknown, entityName: unknown): Promise<void>;
  assertNoteReferences(input: AsyncNoteReferenceInput): Promise<void>;
  assertTagGroupReference(groupId: unknown, spaceId: unknown): Promise<void>;
  normalizeTagIds(tagIds?: Iterable<unknown> | null): Promise<unknown[]>;
}

// 保留 PostgreSQL 批量读取与异步校验顺序。
export function createAsyncNavigationReferencePolicy({
  knowledgeSpaceRepository,
  folderRepository,
  tagRepository,
  tagGroupRepository
}: AsyncNavigationReferencePolicyOptions): AsyncNavigationReferencePolicy {
  async function assertSpaceReference(spaceId: unknown, entityName: unknown): Promise<void> {
    if (!spaceId || !(await knowledgeSpaceRepository.findById(spaceId))) {
      throw validationError(`${entityName}_SPACE_NOT_FOUND`, 'The referenced knowledge space does not exist');
    }
  }

  async function assertNoteReferences({ spaceId, folderId, tagIds }: AsyncNoteReferenceInput): Promise<void> {
    await assertSpaceReference(spaceId, 'NOTE');
    if (folderId) {
      const folder = await folderRepository.findById(folderId);
      if (!folder) throw validationError('NOTE_FOLDER_NOT_FOUND', 'The referenced folder does not exist');
      if (folder.spaceId !== spaceId)
        throw validationError('NOTE_FOLDER_SPACE_MISMATCH', 'The referenced folder belongs to another knowledge space');
    }
    const tags = await tagRepository.findByIds(tagIds ?? []);
    const tagMap = new Map<unknown, NavigationReferenceRecord>(tags.map(tag => [tag.id, tag]));
    for (const tagId of tagIds ?? []) {
      const tag = tagMap.get(tagId);
      if (!tag) throw validationError('NOTE_TAG_NOT_FOUND', 'A referenced tag does not exist');
      if (tag.spaceId !== spaceId)
        throw validationError('NOTE_TAG_SPACE_MISMATCH', 'A referenced tag belongs to another knowledge space');
    }
  }

  async function normalizeTagIds(tagIds?: Iterable<unknown> | null): Promise<unknown[]> {
    const uniqueIds = [...new Set(tagIds)];
    const tags = await tagRepository.findByIds(uniqueIds);
    const byId = new Map<unknown, NavigationReferenceRecord>(tags.map(tag => [tag.id, tag]));
    const normalized: unknown[] = [];
    const singleIndexes = new Map<unknown, number>();
    for (const tagId of uniqueIds) {
      const tag = byId.get(tagId);
      const group = tag?.groupId ? await tagGroupRepository.findById(tag.groupId) : null;
      if (group?.selectionMode === 'single') {
        const previous = singleIndexes.get(group.id);
        if (previous !== undefined) normalized[previous] = null;
        singleIndexes.set(group.id, normalized.length);
      }
      normalized.push(tagId);
    }
    return normalized.filter(Boolean);
  }

  async function assertTagGroupReference(groupId: unknown, spaceId: unknown): Promise<void> {
    if (!groupId) return;
    const group = await tagGroupRepository.findById(groupId);
    if (!group) throw validationError('TAG_GROUP_NOT_FOUND', 'The referenced tag group does not exist');
    if (group.spaceId !== spaceId)
      throw validationError('TAG_GROUP_SPACE_MISMATCH', 'The referenced tag group belongs to another knowledge space');
  }

  return { assertSpaceReference, assertNoteReferences, assertTagGroupReference, normalizeTagIds };
}

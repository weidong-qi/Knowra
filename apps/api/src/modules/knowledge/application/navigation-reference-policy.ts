import { validationError } from './knowledge-errors.ts';

/** 策略只读取引用字段，不把仓库返回值声明为完整领域模型。 */
export interface NavigationReferenceRecord {
  id?: unknown;
  spaceId?: unknown;
  groupId?: unknown;
  selectionMode?: unknown;
}

export interface NavigationReferenceReader {
  findById(id: unknown): NavigationReferenceRecord | null | undefined;
}

export interface NavigationReferencePolicyOptions {
  knowledgeSpaceRepository: { findById(id: unknown): unknown };
  folderRepository: NavigationReferenceReader;
  tagRepository: NavigationReferenceReader;
  tagGroupRepository: NavigationReferenceReader;
  enforceReferences?: unknown;
}

export interface NoteReferenceInput {
  spaceId?: unknown;
  folderId?: unknown;
  tagIds: Pick<ReadonlyArray<unknown>, 'forEach'>;
}

export interface NavigationReferencePolicy {
  assertSpaceReference(spaceId: unknown, entityName: unknown): void;
  assertNoteReferences(input: NoteReferenceInput): void;
  assertTagGroupReference(groupId: unknown, spaceId: unknown): void;
  /** 不提升 Set/迭代器的元素类型；Boolean 过滤也不证明元素为字符串。 */
  normalizeTagIds(tagIds?: Iterable<unknown> | null): unknown[];
}

// 保留本地可选引用校验；标签组校验与标签规范化始终执行。
export function createNavigationReferencePolicy({
  knowledgeSpaceRepository,
  folderRepository,
  tagRepository,
  tagGroupRepository,
  enforceReferences = false
}: NavigationReferencePolicyOptions): NavigationReferencePolicy {
  function assertSpaceReference(spaceId: unknown, entityName: unknown): void {
    if (!enforceReferences) {
      return;
    }

    if (!spaceId || !knowledgeSpaceRepository.findById(spaceId)) {
      throw validationError(`${entityName}_SPACE_NOT_FOUND`, 'The referenced knowledge space does not exist');
    }
  }

  function assertNoteReferences({ spaceId, folderId, tagIds }: NoteReferenceInput): void {
    if (!enforceReferences) {
      return;
    }

    assertSpaceReference(spaceId, 'NOTE');

    if (folderId) {
      const folder = folderRepository.findById(folderId);
      if (!folder) {
        throw validationError('NOTE_FOLDER_NOT_FOUND', 'The referenced folder does not exist');
      }
      if (folder.spaceId !== spaceId) {
        throw validationError('NOTE_FOLDER_SPACE_MISMATCH', 'The referenced folder belongs to another knowledge space');
      }
    }

    tagIds.forEach(tagId => {
      const tag = tagRepository.findById(tagId);
      if (!tag) {
        throw validationError('NOTE_TAG_NOT_FOUND', 'A referenced tag does not exist');
      }
      if (tag.spaceId !== spaceId) {
        throw validationError('NOTE_TAG_SPACE_MISMATCH', 'A referenced tag belongs to another knowledge space');
      }
    });
    const grouped = new Map<unknown, unknown[]>();
    tagIds.forEach(tagId => {
      const tag = tagRepository.findById(tagId);
      if (!tag?.groupId) return;
      const ids = grouped.get(tag.groupId) ?? [];
      ids.push(tagId);
      grouped.set(tag.groupId, ids);
    });
    grouped.forEach((ids, groupId) => {
      if (tagGroupRepository.findById(groupId)?.selectionMode === 'single' && ids.length > 1) {
        throw validationError('TAG_GROUP_SINGLE_SELECTION', 'Only one tag may be selected from this group');
      }
    });
  }

  function normalizeTagIds(tagIds?: Iterable<unknown> | null): unknown[] {
    const normalized: unknown[] = [];
    const singleGroupIndexes = new Map<unknown, number>();
    [...new Set(tagIds)].forEach(tagId => {
      const tag = tagRepository.findById(tagId);
      const group = tag?.groupId ? tagGroupRepository.findById(tag.groupId) : null;
      if (group?.selectionMode !== 'single') {
        normalized.push(tagId);
        return;
      }
      const previousIndex = singleGroupIndexes.get(group.id);
      if (previousIndex !== undefined) normalized[previousIndex] = null;
      singleGroupIndexes.set(group.id, normalized.length);
      normalized.push(tagId);
    });
    return normalized.filter(Boolean);
  }

  function assertTagGroupReference(groupId: unknown, spaceId: unknown): void {
    if (!groupId) return;
    const group = tagGroupRepository.findById(groupId);
    if (!group) throw validationError('TAG_GROUP_NOT_FOUND', 'The referenced tag group does not exist');
    if (group.spaceId !== spaceId)
      throw validationError('TAG_GROUP_SPACE_MISMATCH', 'The referenced tag group belongs to another knowledge space');
  }

  return { assertSpaceReference, assertNoteReferences, assertTagGroupReference, normalizeTagIds };
}

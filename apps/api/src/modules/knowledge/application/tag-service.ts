import { Tag } from '../domain/tag.ts';
import { buildCreateTagDto, buildUpdateTagDto } from './dto/tag.dto.ts';
import { createInMemoryTagRepository } from '../infrastructure/tag-repository.ts';
import { conflictError, notFoundError } from './knowledge-errors.js';

import type { TagDtoInput } from './dto/tag.dto.ts';
import type { TagListOptions, TagRecord } from '../infrastructure/tag-repository.ts';

/** 只约束实际读写；函数属性严格检查未知颜色入参与可空 ID，不使用方法双变。 */
export interface TagServiceRepository<Record extends TagRecord = TagRecord, Saved = unknown> {
  findById: (id: string | null | undefined) => Record | null | undefined;
  list: (options?: TagListOptions) => Record[];
  save: (tag: Tag<unknown>) => Saved;
  delete: (id: string | null | undefined) => unknown;
}

export interface TagServiceOptions<Record extends TagRecord = TagRecord, Saved = unknown> {
  repository?: TagServiceRepository<Record, Saved>;
  validateSpaceReference?: ((spaceId: string) => unknown) | null;
  validateGroupReference?: ((groupId: string | null, spaceId: string) => unknown) | null;
}

export interface TagService<Record extends TagRecord = TagRecord, Saved = unknown> {
  createTag(input?: TagDtoInput): Tag<unknown>;
  updateTag(id: string | null | undefined, updates?: TagDtoInput): Tag<unknown>;
  deleteTag(id: string | null | undefined): Record;
  reorderTags(ids?: (string | null | undefined)[]): Saved[];
  listTags(options?: TagListOptions): Record[];
}

// 省略仓库时才承诺默认仓库返回记录；注入端口则逐项保留原返回类型。
export function createTagService(
  options?: Omit<TagServiceOptions, 'repository'> & { repository?: undefined }
): TagService<TagRecord, TagRecord>;
export function createTagService<Record extends TagRecord, Saved>(
  options: TagServiceOptions<Record, Saved> & { repository: TagServiceRepository<Record, Saved> }
): TagService<Record, Saved>;
export function createTagService(options?: TagServiceOptions): TagService;

export function createTagService({
  repository = createInMemoryTagRepository(),
  validateSpaceReference = null,
  validateGroupReference = null
}: TagServiceOptions = {}): TagService {
  function requireTag(tagId: string | null | undefined) {
    const tag = repository.findById(tagId);

    if (!tag) {
      throw notFoundError('TAG_NOT_FOUND', 'Tag not found');
    }

    return tag;
  }

  function assertNameAvailable(spaceId: string, name: string, currentId: string | null | undefined = null) {
    const normalized = name.trim().toLocaleLowerCase();
    if (
      repository
        .list({ spaceId })
        .some(tag => tag.id !== currentId && tag.name.trim().toLocaleLowerCase() === normalized)
    ) {
      throw conflictError('TAG_NAME_CONFLICT', 'A tag with the same name already exists');
    }
  }

  return {
    createTag(input) {
      const dto = buildCreateTagDto(input);
      if (repository.findById(dto.id)) {
        throw conflictError('TAG_ID_CONFLICT', 'A tag with the same id already exists');
      }
      validateSpaceReference?.(dto.spaceId);
      validateGroupReference?.(dto.groupId, dto.spaceId);
      assertNameAvailable(dto.spaceId, dto.name);
      const tag = new Tag(dto);
      repository.save(tag);
      return tag;
    },
    updateTag(tagId, updates) {
      const currentTag = requireTag(tagId);
      const dto = buildUpdateTagDto(updates);
      if (dto.name) assertNameAvailable(currentTag.spaceId, dto.name, currentTag.id);
      if (currentTag.isSystem && dto.groupId !== undefined && dto.groupId !== currentTag.groupId) {
        throw conflictError('SYSTEM_TAG_PROTECTED', 'System tags cannot be moved to another group');
      }
      if (dto.groupId !== undefined) validateGroupReference?.(dto.groupId, currentTag.spaceId);
      const updatedTag = new Tag({
        ...currentTag,
        ...dto,
        id: currentTag.id,
        spaceId: currentTag.spaceId
      });

      repository.save(updatedTag);
      return updatedTag;
    },
    deleteTag(tagId) {
      const tag = requireTag(tagId);
      if (tag.isSystem) throw conflictError('SYSTEM_TAG_PROTECTED', 'System tags cannot be deleted');
      repository.delete(tagId);
      return tag;
    },
    reorderTags(tagIds = []) {
      const tags = tagIds.map(requireTag);
      if (new Set(tags.map(tag => tag.groupId)).size > 1) {
        throw conflictError('TAG_REORDER_GROUP_MISMATCH', 'Tags can only be reordered within the same group');
      }
      return tags.map((tag, index) => {
        return repository.save(new Tag({ ...tag, sortOrder: index + 1, updatedAt: new Date().toISOString() }));
      });
    },
    listTags(options = {}) {
      return repository.list(options);
    }
  };
}

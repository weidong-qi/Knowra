import { TagGroup } from '../domain/tag-group.ts';
import { createInMemoryTagGroupRepository } from '../infrastructure/tag-group-repository.js';
import { buildCreateTagGroupDto, buildUpdateTagGroupDto } from './dto/tag-group.dto.ts';
import { conflictError, notFoundError } from './knowledge-errors.js';

import type { TagGroupDtoInput } from './dto/tag-group.dto.ts';
import type { TagGroupListOptions, TagGroupRecord } from '../infrastructure/tag-group-repository.ts';

/** 读取记录、create/save 结果分别建模；函数属性防止未知模式或可空 ID 被窄端口吞掉。 */
export interface TagGroupServiceRepository<
  Record extends TagGroupRecord = TagGroupRecord,
  Created = unknown,
  Saved = unknown
> {
  findById: (id: string | null | undefined) => Record | null | undefined;
  list: (options?: TagGroupListOptions) => Record[];
  create: (group: TagGroup<unknown>) => Created;
  save: (group: TagGroup<unknown>) => Saved;
  delete: (id: string | null | undefined) => unknown;
}

export interface TagGroupServiceOptions<
  Record extends TagGroupRecord = TagGroupRecord,
  Created = unknown,
  Saved = unknown
> {
  repository?: TagGroupServiceRepository<Record, Created, Saved>;
  tagRepository?: { list: (options: { spaceId: string }) => { groupId?: unknown }[] } | null;
  validateSpaceReference?: ((spaceId: string) => unknown) | null;
}

export interface TagGroupService<Record extends TagGroupRecord = TagGroupRecord, Created = unknown, Saved = unknown> {
  createTagGroup(input?: TagGroupDtoInput): Created;
  updateTagGroup(id: string | null | undefined, updates?: TagGroupDtoInput): Saved;
  deleteTagGroup(id: string | null | undefined): Record;
  listTagGroups(options?: TagGroupListOptions): Record[];
}

export function createTagGroupService(
  options?: Omit<TagGroupServiceOptions, 'repository'> & { repository?: undefined }
): TagGroupService<TagGroupRecord, TagGroupRecord, TagGroupRecord>;
export function createTagGroupService<Record extends TagGroupRecord, Created, Saved>(
  options: TagGroupServiceOptions<Record, Created, Saved> & {
    repository: TagGroupServiceRepository<Record, Created, Saved>;
  }
): TagGroupService<Record, Created, Saved>;
export function createTagGroupService(options?: TagGroupServiceOptions): TagGroupService;

export function createTagGroupService({
  repository = createInMemoryTagGroupRepository(),
  tagRepository,
  validateSpaceReference
}: TagGroupServiceOptions = {}): TagGroupService {
  const requireGroup = (id: string | null | undefined) => {
    const group = repository.findById(id);
    if (!group) throw notFoundError('TAG_GROUP_NOT_FOUND', 'Tag group not found');
    return group;
  };
  const assertName = (spaceId: string, name: string, currentId: string | null | undefined = null) => {
    if (
      repository
        .list({ spaceId })
        .some(
          group => group.id !== currentId && group.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase()
        )
    ) {
      throw conflictError('TAG_GROUP_NAME_CONFLICT', 'A tag group with the same name already exists');
    }
  };
  return {
    createTagGroup(input) {
      const dto = buildCreateTagGroupDto(input);
      if (repository.findById(dto.id)) {
        throw conflictError('TAG_GROUP_ID_CONFLICT', 'A tag group with the same id already exists');
      }
      validateSpaceReference?.(dto.spaceId);
      assertName(dto.spaceId, dto.name);
      return repository.create(new TagGroup(dto));
    },
    updateTagGroup(id, updates) {
      const current = requireGroup(id);
      const dto = buildUpdateTagGroupDto(updates);
      if (dto.name) assertName(current.spaceId, dto.name, id);
      if (
        dto.selectionMode &&
        dto.selectionMode !== current.selectionMode &&
        tagRepository?.list({ spaceId: current.spaceId }).some(tag => tag.groupId === id)
      ) {
        throw conflictError('TAG_GROUP_IN_USE', 'Remove or move tags before changing selection mode');
      }
      return repository.save(
        new TagGroup({
          ...current,
          ...dto,
          id: current.id,
          spaceId: current.spaceId,
          updatedAt: new Date().toISOString()
        })
      );
    },
    deleteTagGroup(id) {
      const current = requireGroup(id);
      if (current.isSystem) throw conflictError('SYSTEM_TAG_GROUP_PROTECTED', 'System tag groups cannot be deleted');
      if (tagRepository?.list({ spaceId: current.spaceId }).some(tag => tag.groupId === id)) {
        throw conflictError('TAG_GROUP_NOT_EMPTY', 'Move or delete tags before deleting this group');
      }
      repository.delete(id);
      return current;
    },
    listTagGroups(options = {}) {
      return repository.list(options);
    }
  };
}

import { Tag } from '../../domain/tag.ts';
import { buildCreateTagDto, buildUpdateTagDto } from '../dto/tag.dto.ts';
import { conflictError, notFoundError } from '../knowledge-errors.js';

/** @param {import('./service-dependencies.ts').TagDependencies} dependencies */
export function createAsyncTagService({
  repository,
  validateSpaceReference = null,
  validateGroupReference = null
} = {}) {
  if (!repository) throw new TypeError('Async tag service requires a repository');

  async function requireTag(tagId) {
    const tag = await repository.findById(tagId);
    if (!tag) throw notFoundError('TAG_NOT_FOUND', 'Tag not found');
    return tag;
  }

  return {
    async createTag(input) {
      const dto = buildCreateTagDto(input);
      if (await repository.findById(dto.id)) {
        throw conflictError('TAG_ID_CONFLICT', 'A tag with the same id already exists');
      }
      await validateSpaceReference?.(dto.spaceId);
      await validateGroupReference?.(dto.groupId, dto.spaceId);
      if (
        (await repository.list({ spaceId: dto.spaceId })).some(
          tag => tag.name.trim().toLocaleLowerCase() === dto.name.trim().toLocaleLowerCase()
        )
      )
        throw conflictError('TAG_NAME_CONFLICT', 'A tag with the same name already exists');
      return repository.save(new Tag(dto));
    },
    async updateTag(tagId, updates) {
      const currentTag = await requireTag(tagId);
      const dto = buildUpdateTagDto(updates);
      if (
        dto.name &&
        (await repository.list({ spaceId: currentTag.spaceId })).some(
          tag => tag.id !== tagId && tag.name.trim().toLocaleLowerCase() === dto.name.trim().toLocaleLowerCase()
        )
      )
        throw conflictError('TAG_NAME_CONFLICT', 'A tag with the same name already exists');
      if (currentTag.isSystem && dto.groupId !== undefined && dto.groupId !== currentTag.groupId)
        throw conflictError('SYSTEM_TAG_PROTECTED', 'System tags cannot be moved to another group');
      if (dto.groupId !== undefined) await validateGroupReference?.(dto.groupId, currentTag.spaceId);
      return repository.save(
        new Tag({
          ...currentTag,
          ...dto,
          id: currentTag.id,
          spaceId: currentTag.spaceId
        })
      );
    },
    async deleteTag(tagId) {
      const tag = await requireTag(tagId);
      if (tag.isSystem) throw conflictError('SYSTEM_TAG_PROTECTED', 'System tags cannot be deleted');
      await repository.delete(tagId);
      return tag;
    },
    async reorderTags(tagIds = []) {
      const tags = await Promise.all(tagIds.map(requireTag));
      if (new Set(tags.map(tag => tag.groupId)).size > 1)
        throw conflictError('TAG_REORDER_GROUP_MISMATCH', 'Tags can only be reordered within the same group');
      return Promise.all(tags.map((tag, index) => repository.save(new Tag({ ...tag, sortOrder: index + 1 }))));
    },
    listTags(options = {}) {
      return repository.list(options);
    }
  };
}

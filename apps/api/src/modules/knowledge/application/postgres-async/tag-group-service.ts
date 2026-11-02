import { TagGroup } from '../../domain/tag-group.ts';
import { buildCreateTagGroupDto, buildUpdateTagGroupDto } from '../dto/tag-group.dto.ts';
import { conflictError, notFoundError } from '../knowledge-errors.js';

import type { TagGroupDtoInput } from '../dto/tag-group.dto.ts';
import type { TagGroupListOptions, TagGroupRecord } from '../../infrastructure/tag-group-repository.ts';

/** 只声明读取所需视图；同步值和原生/自定义 thenable 均由原 await 处理。 */
export type MaybePromise<T> = T | PromiseLike<T>;
export interface AsyncTagGroupRepository<
  Record extends TagGroupRecord = TagGroupRecord,
  Created = unknown,
  Saved = unknown,
  Listed extends MaybePromise<readonly Record[]> = MaybePromise<readonly Record[]>
> {
  findById: (id: string | null | undefined) => MaybePromise<Record | null | undefined>;
  list: (options?: TagGroupListOptions) => Listed;
  create: (group: TagGroup<unknown>) => Created;
  save: (group: TagGroup<unknown>) => Saved;
  delete: (id: string | null | undefined) => unknown;
}
export interface AsyncTagGroupServiceOptions<
  Record extends TagGroupRecord = TagGroupRecord,
  Created = unknown,
  Saved = unknown,
  Listed extends MaybePromise<readonly Record[]> = MaybePromise<readonly Record[]>
> {
  repository: AsyncTagGroupRepository<Record, Created, Saved, Listed>;
  tagRepository: { list: (options: { spaceId: string }) => MaybePromise<readonly { groupId?: unknown }[]> };
  validateSpaceReference?: ((spaceId: string) => unknown) | null | undefined;
}
export interface AsyncTagGroupService<
  Record extends TagGroupRecord = TagGroupRecord,
  Created = unknown,
  Saved = unknown,
  Listed extends MaybePromise<readonly Record[]> = MaybePromise<readonly Record[]>
> {
  createTagGroup(input?: TagGroupDtoInput): Promise<Awaited<Created>>;
  updateTagGroup(id: string | null | undefined, updates?: TagGroupDtoInput): Promise<Awaited<Saved>>;
  deleteTagGroup(id: string | null | undefined): Promise<Awaited<Record>>;
  listTagGroups(options?: TagGroupListOptions): Listed;
}

/** 公共泛型保留 async 的 Awaited 结果与普通 list 的原始返回类型。 */
export function createAsyncTagGroupService<
  Record extends TagGroupRecord = TagGroupRecord,
  Created = unknown,
  Saved = unknown,
  Listed extends MaybePromise<readonly Record[]> = MaybePromise<readonly Record[]>
>(
  options: AsyncTagGroupServiceOptions<Record, Created, Saved, Listed>
): AsyncTagGroupService<Record, Created, Saved, Listed>;
// 具体实现使用最小端口，不通过断言或额外 await 改写运行表达式。
export function createAsyncTagGroupService({
  repository,
  tagRepository,
  validateSpaceReference
}: AsyncTagGroupServiceOptions): AsyncTagGroupService {
  async function requireGroup(id: string | null | undefined) {
    const group = await repository.findById(id);
    if (!group) throw notFoundError('TAG_GROUP_NOT_FOUND', 'Tag group not found');
    return group;
  }
  async function assertName(spaceId: string, name: string, currentId: string | null | undefined = null) {
    if (
      (await repository.list({ spaceId })).some(
        group => group.id !== currentId && group.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase()
      )
    )
      throw conflictError('TAG_GROUP_NAME_CONFLICT', 'A tag group with the same name already exists');
  }
  return {
    async createTagGroup(input) {
      const dto = buildCreateTagGroupDto(input);
      if (await repository.findById(dto.id))
        throw conflictError('TAG_GROUP_ID_CONFLICT', 'A tag group with the same id already exists');
      await validateSpaceReference?.(dto.spaceId);
      await assertName(dto.spaceId, dto.name);
      return repository.create(new TagGroup(dto));
    },
    async updateTagGroup(id, updates) {
      const current = await requireGroup(id);
      const dto = buildUpdateTagGroupDto(updates);
      if (dto.name) await assertName(current.spaceId, dto.name, id);
      if (
        dto.selectionMode &&
        dto.selectionMode !== current.selectionMode &&
        (await tagRepository.list({ spaceId: current.spaceId })).some(tag => tag.groupId === id)
      )
        throw conflictError('TAG_GROUP_IN_USE', 'Remove or move tags before changing selection mode');
      return repository.save(new TagGroup({ ...current, ...dto, id: current.id, spaceId: current.spaceId }));
    },
    async deleteTagGroup(id) {
      const current = await requireGroup(id);
      if (current.isSystem) throw conflictError('SYSTEM_TAG_GROUP_PROTECTED', 'System tag groups cannot be deleted');
      if ((await tagRepository.list({ spaceId: current.spaceId })).some(tag => tag.groupId === id))
        throw conflictError('TAG_GROUP_NOT_EMPTY', 'Move or delete tags before deleting this group');
      await repository.delete(id);
      return current;
    },
    listTagGroups(options = {}) {
      return repository.list(options);
    }
  };
}

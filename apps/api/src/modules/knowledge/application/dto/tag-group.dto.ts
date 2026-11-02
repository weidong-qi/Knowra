import { createPrefixedId, normalizeOptionalId, requireText } from './_shared.ts';
import { validationError } from '../knowledge-errors.js';

export interface TagGroupDtoInput {
  id?: unknown;
  spaceId?: unknown;
  code?: unknown;
  name?: unknown;
  selectionMode?: unknown;
  isSystem?: unknown;
  sortOrder?: unknown;
}

export interface CreateTagGroupDto {
  id: string;
  spaceId: string;
  code: string | null;
  name: string;
  selectionMode: unknown;
  isSystem: boolean;
  sortOrder: number;
}

export interface UpdateTagGroupDto {
  name?: string;
  selectionMode?: unknown;
  sortOrder?: number;
}

// includes 是动态调用；只扩大搜索参数视图，不把返回值断言为已验证枚举。
function selectionMode(value: unknown = 'multiple'): unknown {
  if (!(['single', 'multiple'] as unknown[]).includes(value)) {
    throw validationError('TAG_GROUP_SELECTION_MODE_INVALID', 'Tag group selectionMode must be single or multiple');
  }
  return value;
}

export function buildCreateTagGroupDto<Input extends TagGroupDtoInput>(
  input: Input
): Omit<CreateTagGroupDto, 'selectionMode'> & { selectionMode: NonNullable<Input['selectionMode']> | 'multiple' };
export function buildCreateTagGroupDto(input?: TagGroupDtoInput): CreateTagGroupDto;
export function buildCreateTagGroupDto(input: TagGroupDtoInput = {}): CreateTagGroupDto {
  const name = requireText(input.name, 'TAG_GROUP_NAME_REQUIRED', 'Tag group name is required');
  return {
    id: input.id
      ? requireText(input.id, 'TAG_GROUP_ID_INVALID', 'Tag group id is invalid')
      : createPrefixedId('tag-group', name),
    spaceId: requireText(input.spaceId, 'TAG_GROUP_SPACE_REQUIRED', 'Tag group spaceId is required'),
    code: normalizeOptionalId(input.code, 'TAG_GROUP_CODE_INVALID', 'Tag group code is invalid'),
    name,
    selectionMode: selectionMode(input.selectionMode),
    isSystem: Boolean(input.isSystem),
    sortOrder: Number(input.sortOrder) || 0
  };
}

export function buildUpdateTagGroupDto(input: TagGroupDtoInput = {}): UpdateTagGroupDto {
  const dto: UpdateTagGroupDto = {};
  if (input.name !== undefined)
    dto.name = requireText(input.name, 'TAG_GROUP_NAME_REQUIRED', 'Tag group name is required');
  if (input.selectionMode !== undefined) dto.selectionMode = selectionMode(input.selectionMode);
  if (input.sortOrder !== undefined) dto.sortOrder = Number(input.sortOrder) || 0;
  return dto;
}

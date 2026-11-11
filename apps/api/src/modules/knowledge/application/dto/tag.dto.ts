import { createPrefixedId, normalizeOptionalId, requireText } from './_shared.ts';
import { validationError } from '../knowledge-errors.ts';
import { parseTagColor, type TagColor } from '@study-accelerator/shared/tag-colors';

export interface TagDtoInput {
  id?: unknown;
  spaceId?: unknown;
  name?: unknown;
  color?: unknown;
  groupId?: unknown;
  code?: unknown;
  isSystem?: unknown;
  sortOrder?: unknown;
}

export interface CreateTagDto {
  id: string;
  spaceId: string;
  name: string;
  color: TagColor;
  groupId: string | null;
  code: string | null;
  isSystem: boolean;
  sortOrder: number;
}

export interface UpdateTagDto {
  name?: string;
  color?: TagColor;
  groupId?: string | null;
  sortOrder?: number;
}

function normalizeName(value: unknown): string {
  const name = requireText(value, 'TAG_NAME_REQUIRED', 'Tag name is required');
  if (name.length > 30 || /[\r\n]/.test(name))
    throw validationError('TAG_NAME_INVALID', 'Tag name must contain 1 to 30 characters without line breaks');
  return name;
}

function normalizeColor(value: unknown = 'neutral'): TagColor {
  const color = parseTagColor(value);
  if (!color) throw validationError('TAG_COLOR_INVALID', '颜色须为预设色或 #RRGGBB 格式的不透明颜色');
  return color;
}

export function buildCreateTagDto(input: TagDtoInput = {}): CreateTagDto {
  const name = normalizeName(input.name);
  return {
    id:
      input.id === undefined || input.id === null
        ? createPrefixedId('tag', name)
        : requireText(input.id, 'TAG_ID_INVALID', 'Tag id is invalid'),
    spaceId: requireText(input.spaceId, 'TAG_SPACE_REQUIRED', 'Tag spaceId is required'),
    name,
    color: normalizeColor(input.color),
    groupId: normalizeOptionalId(input.groupId, 'TAG_GROUP_ID_INVALID', 'Tag group id is invalid'),
    code: normalizeOptionalId(input.code, 'TAG_CODE_INVALID', 'Tag code is invalid'),
    isSystem: Boolean(input.isSystem),
    sortOrder: Number(input.sortOrder) || 0
  };
}

export function buildUpdateTagDto(input: TagDtoInput = {}): UpdateTagDto {
  const dto: UpdateTagDto = {};

  if (input.name !== undefined) {
    dto.name = normalizeName(input.name);
  }
  if (input.color !== undefined) {
    dto.color = normalizeColor(input.color);
  }
  if (input.groupId !== undefined)
    dto.groupId = normalizeOptionalId(input.groupId, 'TAG_GROUP_ID_INVALID', 'Tag group id is invalid');
  if (input.sortOrder !== undefined) dto.sortOrder = Number(input.sortOrder) || 0;

  return dto;
}

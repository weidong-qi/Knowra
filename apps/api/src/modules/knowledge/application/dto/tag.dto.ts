import { createPrefixedId, normalizeOptionalId, requireText } from './_shared.js';
import { validationError } from '../knowledge-errors.js';

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
  color: unknown;
  groupId: string | null;
  code: string | null;
  isSystem: boolean;
  sortOrder: number;
}

export interface UpdateTagDto {
  name?: string;
  color?: unknown;
  groupId?: string | null;
  sortOrder?: number;
}

// 别名字典保留普通原型查找；动态 has 不证明值是字符串或颜色枚举。
const TAG_COLORS = new Set<unknown>(['neutral', 'blue', 'green', 'orange', 'red', 'violet']);

function normalizeName(value: unknown): string {
  const name = requireText(value, 'TAG_NAME_REQUIRED', 'Tag name is required');
  if (name.length > 30 || /[\r\n]/.test(name))
    throw validationError('TAG_NAME_INVALID', 'Tag name must contain 1 to 30 characters without line breaks');
  return name;
}

function normalizeColor(value: unknown = 'neutral'): unknown {
  const aliases: Record<string, unknown> = {
    slate: 'neutral',
    cyan: 'blue',
    amber: 'orange',
    mastery: 'green',
    importance: 'orange',
    purpose: 'blue',
    '#3c68ff': 'blue'
  };
  const color = aliases[String(value).toLowerCase()] ?? String(value).toLowerCase();
  if (!TAG_COLORS.has(color)) throw validationError('TAG_COLOR_INVALID', 'Tag color is invalid');
  return color;
}

export function buildCreateTagDto(
  input: TagDtoInput & { color?: string | null }
): Omit<CreateTagDto, 'color'> & { color: string };
export function buildCreateTagDto(input?: TagDtoInput): CreateTagDto;
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

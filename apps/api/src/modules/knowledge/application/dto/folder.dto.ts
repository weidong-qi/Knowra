import { createPrefixedId, normalizeOptionalId, requireText } from './_shared.ts';

export interface FolderDtoInput {
  id?: unknown;
  spaceId?: unknown;
  parentId?: unknown;
  name?: unknown;
  pathCache?: unknown;
}

export interface CreateFolderDto {
  id: string;
  spaceId: string;
  parentId: string | null;
  name: string;
  // 原 DTO 不校验 pathCache；服务在构造领域对象前自行重建路径。
  pathCache: unknown;
}

export interface UpdateFolderDto {
  name?: string;
  parentId?: string | null;
  pathCache?: unknown;
}

function createFolderId({ id, name }: { id?: unknown; name: string }): string {
  if (id !== undefined && id !== null) {
    return requireText(id, 'FOLDER_ID_INVALID', 'Folder id is invalid');
  }

  return createPrefixedId('folder', name || 'item');
}

export function buildCreateFolderDto<Input extends FolderDtoInput>(
  input: Input
): Omit<CreateFolderDto, 'pathCache'> & { pathCache: NonNullable<Input['pathCache']> | '/' };
export function buildCreateFolderDto(input?: FolderDtoInput): CreateFolderDto;
export function buildCreateFolderDto(input: FolderDtoInput = {}): CreateFolderDto {
  const name = requireText(input.name, 'FOLDER_NAME_REQUIRED', 'Folder name is required');

  return {
    id: createFolderId({
      id: input.id,
      name
    }),
    spaceId: requireText(input.spaceId, 'FOLDER_SPACE_REQUIRED', 'Folder spaceId is required'),
    parentId: normalizeOptionalId(input.parentId, 'FOLDER_PARENT_INVALID', 'Folder parentId is invalid'),
    name,
    pathCache: input.pathCache ?? '/'
  };
}

export function buildUpdateFolderDto(input: FolderDtoInput = {}): UpdateFolderDto {
  const dto: UpdateFolderDto = {};

  if (input.name !== undefined) {
    dto.name = requireText(input.name, 'FOLDER_NAME_REQUIRED', 'Folder name is required');
  }
  if (input.parentId !== undefined) {
    dto.parentId = normalizeOptionalId(input.parentId, 'FOLDER_PARENT_INVALID', 'Folder parentId is invalid');
  }
  if (input.pathCache !== undefined) {
    dto.pathCache = input.pathCache;
  }

  return dto;
}

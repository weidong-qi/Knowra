import { createPrefixedId, normalizeIdList, normalizeOptionalId, requireText, trimIfString } from './_shared.ts';
import { assertNoInsecureImageUrls } from '../note-content-policy.ts';
import { validationError } from '../knowledge-errors.js';

export interface NoteDtoInput {
  id?: unknown;
  title?: unknown;
  rawMarkdown?: unknown;
  spaceId?: unknown;
  folderId?: unknown;
  contentKind?: unknown;
  pdfSource?: unknown;
  status?: unknown;
  sourceType?: unknown;
  favorite?: unknown;
  aiVisibility?: unknown;
  tagIds?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  expectedUpdatedAt?: unknown;
}
type Field<Input, Key extends PropertyKey> = Key extends keyof Input ? Input[Key] : unknown;
type Trimmed<Value> = Value extends string ? string : Value;
export interface CreateNoteDto<Input extends NoteDtoInput = NoteDtoInput> {
  id: string;
  title: NonNullable<Trimmed<Field<Input, 'title'>>> | string;
  rawMarkdown: Field<Input, 'rawMarkdown'>;
  contentKind: NonNullable<Field<Input, 'contentKind'>> | 'markdown';
  pdfSource: NonNullable<Field<Input, 'pdfSource'>> | null;
  spaceId: string | null;
  folderId: string | null;
  status: NonNullable<Field<Input, 'status'>> | 'draft';
  sourceType: NonNullable<Field<Input, 'sourceType'>> | 'manual';
  favorite: NonNullable<Field<Input, 'favorite'>> | false;
  aiVisibility: Field<Input, 'aiVisibility'> | 'normal';
  tagIds: unknown[];
  createdAt: Field<Input, 'createdAt'>;
  updatedAt: Field<Input, 'updatedAt'>;
}
export interface UpdateNoteDto<Input extends NoteDtoInput = NoteDtoInput> {
  expectedUpdatedAt?: string;
  title?: Trimmed<Field<Input, 'title'>>;
  rawMarkdown?: Field<Input, 'rawMarkdown'>;
  spaceId?: string | null;
  folderId?: string | null;
  status?: Field<Input, 'status'>;
  sourceType?: Field<Input, 'sourceType'>;
  favorite?: Field<Input, 'favorite'>;
  aiVisibility?: Field<Input, 'aiVisibility'>;
  tagIds?: unknown[];
  updatedAt?: Field<Input, 'updatedAt'>;
}

function aiVisibility<Value>(value: Value): Value {
  if (!(['normal', 'private'] as readonly unknown[]).includes(value)) {
    throw validationError('NOTE_AI_VISIBILITY_INVALID', '笔记 AI 可读性只能为普通或私密。');
  }
  return value;
}

function deriveTitleFromMarkdown(markdown: unknown) {
  if (typeof markdown !== 'string') {
    return null;
  }

  const headingMatch = markdown.match(/^\s*#\s+(.+)$/m);
  if (headingMatch?.[1]?.trim()) {
    return headingMatch[1].trim();
  }

  const firstLine = markdown
    .split('\n')
    .map(line => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return null;
  }

  return (
    firstLine
      .replace(/^[-*>\d.\s]+/, '')
      .trim()
      .slice(0, 80) || null
  );
}

function createNoteId({ id, title, rawMarkdown }: Pick<NoteDtoInput, 'id' | 'title' | 'rawMarkdown'>) {
  if (id !== undefined && id !== null) {
    return requireText(id, 'NOTE_ID_INVALID', 'Note id is invalid');
  }

  return createPrefixedId('note', title || deriveTitleFromMarkdown(rawMarkdown) || 'item');
}

export function buildCreateNoteDto<Input extends NoteDtoInput>(input: Input): CreateNoteDto<Input>;
export function buildCreateNoteDto(input?: NoteDtoInput): CreateNoteDto;
export function buildCreateNoteDto(input: NoteDtoInput = {}): CreateNoteDto {
  if (typeof input.rawMarkdown !== 'string') {
    throw validationError('NOTE_CONTENT_REQUIRED', 'Note rawMarkdown is required');
  }
  if (input.title !== undefined && typeof input.title !== 'string') {
    throw validationError('NOTE_TITLE_INVALID', 'Note title is invalid');
  }

  const title = trimIfString(input.title) || deriveTitleFromMarkdown(input.rawMarkdown) || 'Untitled Note';
  assertNoInsecureImageUrls(input.rawMarkdown);

  return {
    id: createNoteId({
      id: input.id,
      title,
      rawMarkdown: input.rawMarkdown
    }),
    title,
    rawMarkdown: input.rawMarkdown,
    contentKind: input.contentKind ?? 'markdown',
    pdfSource: input.pdfSource ?? null,
    spaceId: normalizeOptionalId(input.spaceId, 'NOTE_SPACE_INVALID', 'Note spaceId is invalid'),
    folderId: normalizeOptionalId(input.folderId, 'NOTE_FOLDER_INVALID', 'Note folderId is invalid'),
    status: input.status ?? 'draft',
    sourceType: input.sourceType ?? 'manual',
    favorite: input.favorite ?? false,
    aiVisibility: aiVisibility(input.aiVisibility === undefined ? 'normal' : input.aiVisibility),
    tagIds: normalizeIdList(input.tagIds ?? [], 'NOTE_TAGS_INVALID', 'Note tagIds must contain valid ids'),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
}

export function buildUpdateNoteDto<Input extends NoteDtoInput>(input: Input): UpdateNoteDto<Input>;
export function buildUpdateNoteDto(input?: NoteDtoInput): UpdateNoteDto;
export function buildUpdateNoteDto(input: NoteDtoInput = {}): UpdateNoteDto {
  const dto: UpdateNoteDto = {};

  if (input.expectedUpdatedAt !== undefined) {
    const expectedUpdatedAt = new Date(input.expectedUpdatedAt as string);
    if (typeof input.expectedUpdatedAt !== 'string' || Number.isNaN(expectedUpdatedAt.getTime())) {
      throw validationError('NOTE_EXPECTED_UPDATED_AT_INVALID', 'Note expectedUpdatedAt is invalid');
    }
    dto.expectedUpdatedAt = expectedUpdatedAt.toISOString();
  }

  if (input.title !== undefined) {
    if (typeof input.title !== 'string') {
      throw validationError('NOTE_TITLE_INVALID', 'Note title is invalid');
    }
    dto.title = trimIfString(input.title);
    if (!dto.title) {
      throw validationError('NOTE_TITLE_REQUIRED', 'Note title is required');
    }
  }
  if (input.rawMarkdown !== undefined) {
    if (typeof input.rawMarkdown !== 'string') {
      throw validationError('NOTE_CONTENT_INVALID', 'Note rawMarkdown is invalid');
    }
    assertNoInsecureImageUrls(input.rawMarkdown);
    dto.rawMarkdown = input.rawMarkdown;
  }
  if (input.spaceId !== undefined) {
    dto.spaceId = normalizeOptionalId(input.spaceId, 'NOTE_SPACE_INVALID', 'Note spaceId is invalid');
  }
  if (input.folderId !== undefined) {
    dto.folderId = normalizeOptionalId(input.folderId, 'NOTE_FOLDER_INVALID', 'Note folderId is invalid');
  }
  if (input.status !== undefined) {
    dto.status = input.status;
  }
  if (input.sourceType !== undefined) {
    dto.sourceType = input.sourceType;
  }
  if (input.favorite !== undefined) {
    dto.favorite = input.favorite;
  }
  if (input.tagIds !== undefined) {
    dto.tagIds = normalizeIdList(input.tagIds, 'NOTE_TAGS_INVALID', 'Note tagIds must contain valid ids');
  }
  if (input.aiVisibility !== undefined) dto.aiVisibility = aiVisibility(input.aiVisibility);
  if (input.updatedAt !== undefined) {
    dto.updatedAt = input.updatedAt;
  }

  return dto;
}

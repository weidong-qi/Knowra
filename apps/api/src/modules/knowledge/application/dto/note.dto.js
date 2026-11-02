import { createPrefixedId, normalizeIdList, normalizeOptionalId, requireText, trimIfString } from './_shared.js';
import { assertNoInsecureImageUrls } from '../note-content-policy.js';
import { validationError } from '../knowledge-errors.js';

function aiVisibility(value) {
  if (!['normal', 'private'].includes(value)) {
    throw validationError('NOTE_AI_VISIBILITY_INVALID', '笔记 AI 可读性只能为普通或私密。');
  }
  return value;
}

function deriveTitleFromMarkdown(markdown) {
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

function createNoteId({ id, title, rawMarkdown }) {
  if (id !== undefined && id !== null) {
    return requireText(id, 'NOTE_ID_INVALID', 'Note id is invalid');
  }

  return createPrefixedId('note', title || deriveTitleFromMarkdown(rawMarkdown) || 'item');
}

/** @param {Partial<Omit<import('../../domain/note.ts').Note, 'tagIds'>> & {tagIds?: unknown}} input */
export function buildCreateNoteDto(input = {}) {
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

export function buildUpdateNoteDto(input = {}) {
  const dto = {};

  if (input.expectedUpdatedAt !== undefined) {
    const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
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

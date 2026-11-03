export function upsertTag(tags, updatedTag) {
  if (!updatedTag?.id) {
    return tags;
  }

  if (!tags.some((tag) => tag.id === updatedTag.id)) {
    return [...tags, updatedTag];
  }

  return tags.map((tag) => (tag.id === updatedTag.id ? updatedTag : tag));
}

export function removeTagFromCollections({ tags, allNotes, selectedTagIds }, tagId) {
  return {
    tags: tags.filter((tag) => tag.id !== tagId),
    allNotes: allNotes.map((note) => ({
      ...note,
      tagIds: (note.tagIds ?? []).filter((currentTagId) => currentTagId !== tagId)
    })),
    selectedTagIds: selectedTagIds.filter((currentTagId) => currentTagId !== tagId)
  };
}

export function buildUniqueTagId(name, tags, { fallbackSuffix = Date.now } = {}) {
  const normalized = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const baseId = normalized || `tag-${fallbackSuffix()}`;
  let candidateId = `tag-${baseId}`;
  let counter = 2;

  while (tags.some((tag) => tag.id === candidateId)) {
    candidateId = `tag-${baseId}-${counter}`;
    counter += 1;
  }

  return candidateId;
}

export function normalizeTagName(name) {
  return String(name ?? '').trim();
}

export function findTagByName(tags, name) {
  const normalizedName = normalizeTagName(name).toLowerCase();
  if (!normalizedName) {
    return null;
  }

  return (tags ?? []).find((tag) => normalizeTagName(tag?.name).toLowerCase() === normalizedName) ?? null;
}

export function buildTagInput({
  name,
  tags,
  spaceId,
  color = RUNTIME_COLOR_FALLBACKS.accent
}) {
  const normalizedName = normalizeTagName(name);
  if (!normalizedName) {
    return null;
  }

  return {
    id: buildUniqueTagId(normalizedName, tags),
    spaceId,
    name: normalizedName,
    color: normalizeTagColor(color)
  };
}
import { RUNTIME_COLOR_FALLBACKS, normalizeTagColor } from '../theme/runtime-colors.js';

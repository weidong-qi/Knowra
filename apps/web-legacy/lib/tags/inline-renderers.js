import { escapeHtml } from '../../src/app/formatting.js';

export function resolveNoteTags(note, tags = []) {
  return (note?.tagIds ?? [])
    .map((tagId) => tags.find((tag) => tag.id === tagId))
    .filter(Boolean);
}

export function renderTagList(tags = []) {
  if (!tags.length) {
    return '<span class="tag-empty">暂无标签</span>';
  }

  return tags.map((tag) => `<span>${escapeHtml(tag.name)}</span>`).join('');
}

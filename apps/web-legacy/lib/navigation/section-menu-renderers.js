import { escapeHtml, escapeAttribute } from '../../src/app/formatting.js';
import { renderIcon } from '../icons/icon-map.js';

export const SECONDARY_SECTION_ITEMS = [
  { key: 'favorites', label: '收藏' },
  { key: 'recent', label: '最近' },
  { key: 'recycle', label: '回收站' }
];

export function renderSectionMenuItems({
  items = SECONDARY_SECTION_ITEMS,
  sections = {}
} = {}) {
  return items
    .map((item) => `
      <button
        type="button"
        class="library-context-item library-check-item"
        data-section-toggle="${escapeAttribute(item.key)}"
        data-active="${String(Boolean(sections[item.key]))}"
        aria-pressed="${String(Boolean(sections[item.key]))}"
      >
        <span class="library-checkmark">${sections[item.key] ? renderIcon('confirm', { className: 'library-checkmark-icon' }) : ''}</span>
        <span>${escapeHtml(item.label)}</span>
      </button>
    `)
    .join('');
}

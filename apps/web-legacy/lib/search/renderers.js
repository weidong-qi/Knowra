import { escapeHtml, escapeAttribute } from '../../src/app/formatting.js';
import { renderIcon } from '../icons/icon-map.js';

export function renderSearchShell() {
  return `
      <div class="top-bar-search-control" data-open="false">
        <span class="top-bar-search-icon" aria-hidden="true">
          ${renderIcon('search', { className: 'top-bar-search-icon-glyph' })}
        </span>
        <div class="top-search-chip-track" data-search-chip-track></div>
        <input
          id="global-search"
          data-search-input
          type="text"
          aria-label="全局搜索"
          placeholder="搜索笔记、标签、附件、AI 结果"
          autocomplete="off"
          spellcheck="false"
        />
        <kbd class="top-bar-search-shortcut" aria-hidden="true">⌘K</kbd>
        <button type="button" class="top-search-clear" data-search-clear hidden>清空</button>
      </div>
      <div class="search-panel-host"></div>
    `;
}

export function renderSelectedSearchChips(selectedTags, { inlineLimit = 2 } = {}) {
  const visibleInlineTags = selectedTags.slice(0, inlineLimit);
  const overflowTagCount = Math.max(0, selectedTags.length - visibleInlineTags.length);
  const chips = visibleInlineTags
    .map(
      (tag) => `
        <button type="button" class="top-search-chip" data-search-chip-remove="${escapeAttribute(tag.id)}" title="移除标签：${escapeAttribute(tag.name)}">
          <span class="top-search-chip-dot"></span>
          <span class="top-search-chip-label">${escapeHtml(tag.name)}</span>
          <span class="top-search-chip-remove" aria-hidden="true">${renderIcon('cancel', { className: 'top-search-chip-remove-icon' })}</span>
        </button>
      `
    )
    .join('');

  if (overflowTagCount <= 0) {
    return chips;
  }

  return `${chips}
    <span class="top-search-chip top-search-chip-summary" title="还有 ${overflowTagCount} 个已选标签">+${overflowTagCount}</span>
  `;
}

export function renderSearchTagOption(tag, selected = false) {
  return `
    <button
      type="button"
      class="search-tag-option"
      data-search-tag-id="${escapeAttribute(tag.id)}"
      data-selected="${String(selected)}"
      title="筛选标签：${escapeAttribute(tag.name)}"
    >
      <span class="search-tag-dot"></span>
      <span>${escapeHtml(tag.name)}</span>
      <span class="search-tag-count">${tag.usageCount ?? 0}</span>
    </button>
  `;
}

export function renderSearchPanel({ selectedTags, visibleTags, selectedTagIds, hasFilters, isOpen = true }) {
  if (!isOpen) {
    return '';
  }

  return `
    <div class="search-panel">
      <div class="search-panel-header">
        <div class="search-panel-title">标签筛选</div>
        ${hasFilters ? '<button type="button" class="top-search-clear" data-search-clear>清空筛选</button>' : ''}
      </div>
      ${selectedTags.length ? `
        <section class="search-panel-section">
          <div class="search-panel-title">已选标签</div>
          <div class="search-panel-chips">
            ${selectedTags.map((tag) => renderSearchTagOption(tag, true)).join('')}
          </div>
        </section>
      ` : ''}
      <section class="search-panel-section">
        <div class="search-panel-title">全部标签</div>
        <div class="search-panel-chips">
          ${visibleTags.length
            ? visibleTags.map((tag) => renderSearchTagOption(tag, selectedTagIds.includes(tag.id))).join('')
            : '<div class="search-panel-empty">没有匹配标签</div>'}
        </div>
      </section>
    </div>
  `;
}

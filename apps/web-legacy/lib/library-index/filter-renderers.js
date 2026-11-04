import {
  getLibraryFilterLabel,
  getLibraryFilterOptions,
  getLibraryTabCounts,
  resolveLibraryFilters
} from './model.js';
import { escapeAttribute } from '../../src/app/formatting.js';
import { renderIcon } from '../icons/icon-map.js';

const FILTER_LABELS = {
  type: '类型',
  status: '状态',
  time: '时间'
};

const LIBRARY_INDEX_CONTENT_ID = 'library-index-content';

export function renderLibraryIndexTabs({ state }) {
  const counts = getLibraryTabCounts(state.allNotes);
  const tabs = [
    ['all', '全部条目'],
    ['recent', '最近'],
    ['favorites', '已收藏'],
    ['recycle', '回收站']
  ];

  return tabs.map(([key, label]) => {
    const isActive = state.libraryIndex.tab === key;
    return `
    <button
      type="button"
      id="library-index-tab-${key}"
      role="tab"
      data-index-tab="${key}"
      data-active="${String(isActive)}"
      aria-selected="${String(isActive)}"
      aria-controls="${LIBRARY_INDEX_CONTENT_ID}"
      tabindex="${isActive ? '0' : '-1'}"
    >
      ${label}<b>${counts[key]}</b>
    </button>
  `;
  }).join('');
}

export function renderLibraryIndexFilters({ state }) {
  const filters = resolveLibraryFilters(state.libraryIndex.filters);
  const controls = Object.keys(FILTER_LABELS)
    .map((kind) => renderFilterControl({
      kind,
      value: filters[kind],
      isOpen: state.libraryIndex.filterMenu === kind
    }))
    .join('');
  const keyword = String(state.libraryIndex?.localKeyword ?? '');
  return `${controls}
    <label class="index-local-search">
      ${renderIcon('search', { className: 'index-local-search-icon' })}
      <input type="search" data-index-local-search value="${escapeAttribute(keyword)}" placeholder="在当前范围内筛选…" aria-label="在当前范围内筛选资料" />
    </label>`;
}

function renderFilterControl({ kind, value, isOpen }) {
  const label = FILTER_LABELS[kind];
  const menuId = `library-index-filter-menu-${kind}`;
  const options = getLibraryFilterOptions(kind);
  const valueLabel = getLibraryFilterLabel(kind, value);
  return `
    <div class="index-filter-shell" data-index-filter-shell="${kind}">
      <button
        type="button"
        class="index-filter-trigger"
        data-index-filter="${kind}"
        aria-expanded="${String(isOpen)}"
        aria-haspopup="menu"
        aria-controls="${menuId}"
      >
        <span>${label}</span><b>${valueLabel}</b>
        ${renderIcon('filterChevron', { className: 'index-filter-chevron' })}
      </button>
      <div
        id="${menuId}"
        class="index-filter-menu"
        role="menu"
        aria-label="${label}筛选"
        ${isOpen ? '' : 'hidden'}
      >
        ${options.map((option) => `
          <button
            type="button"
            role="menuitemradio"
            aria-checked="${String(option.value === value)}"
            data-index-filter-option
            data-filter-kind="${kind}"
            data-filter-value="${option.value}"
          >${option.label}</button>
        `).join('')}
      </div>
    </div>
  `;
}

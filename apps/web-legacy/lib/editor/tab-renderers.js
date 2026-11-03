import { escapeHtml, escapeAttribute } from '../../src/app/formatting.js';
import { renderIcon } from '../icons/icon-map.js';
const DIRTY_SAVE_STATES = new Set(['pending', 'saving', 'error']);

export function buildNoteTabId(noteId) {
  const encodedNoteId = encodeURIComponent(String(noteId ?? ''))
    .replace(/%/g, '-');
  return `note-tab-${encodedNoteId || 'empty'}`;
}

export function renderEmptyNoteTabs() {
  return `
      <div class="note-tabs-empty">
        <span class="note-tabs-empty-label">暂无打开的资料</span>
      </div>
    `;
}

export function renderNoteTabs({
  notes,
  selectedNoteId,
  saveState,
  tabDragState,
  foldersById,
  buildNoteTabPath,
  panelId = 'editor-scroll-region'
}) {
  const dragState = tabDragState ?? {};

  return notes
    .map((note) => {
      const isActive = note.id === selectedNoteId;
      const isDirty = isActive && DIRTY_SAVE_STATES.has(saveState);
      const isDragging = dragState.activeId === note.id;
      const isDropTarget = dragState.overId === note.id;
      const title = note.title || '未命名资料';
      const notePath = buildNoteTabPath(note, foldersById);
      const accessibleTitle = `${title}${isDirty ? '（有未保存修改）' : ''}`;
      const tabId = buildNoteTabId(note.id);

      return `
        <div
          class="note-tab"
          role="presentation"
          data-tab-note-id="${escapeAttribute(note.id)}"
          data-active="${String(isActive)}"
          data-dirty="${String(isDirty)}"
          data-dragging="${String(isDragging)}"
          data-drop-target="${String(isDropTarget)}"
          title="${escapeAttribute(notePath)}"
          draggable="true"
        >
          <button
            type="button"
            class="note-tab-select"
            id="${escapeAttribute(tabId)}"
            role="tab"
            aria-selected="${String(isActive)}"
            tabindex="${isActive ? '0' : '-1'}"
            aria-controls="${escapeAttribute(panelId)}"
            aria-label="${escapeAttribute(accessibleTitle)}"
            title="${escapeAttribute(notePath)}"
          >
            ${renderIcon('noteMarkdown', { className: 'note-tab-file-icon' })}
            <span class="note-tab-label">${escapeHtml(title)}</span>
            <span class="note-tab-dirty" aria-hidden="true">${isDirty ? '●' : ''}</span>
          </button>
          <button
            type="button"
            class="note-tab-close"
            data-tab-close="${escapeAttribute(note.id)}"
            aria-label="关闭标签页"
            title="关闭标签页"
          >${renderIcon('cancel', { className: 'note-tab-close-icon' })}</button>
        </div>
      `;
    })
    .join('');
}

export function renderTabOverflowToggle({ count, open }) {
  if (!count) {
    return '';
  }

  return `
    <button
      type="button"
      class="note-tab-overflow-toggle"
      data-tab-overflow-toggle
      data-open="${String(open)}"
      aria-expanded="${String(open)}"
      aria-controls="note-tab-overflow-menu"
      aria-haspopup="menu"
      aria-label="显示其余 ${count} 个标签页"
      title="其余 ${count} 个标签页"
    >${renderIcon('more', { className: 'note-tab-overflow-icon' })}<small>${count}</small></button>
  `;
}

export function renderTabOverflowMenu({ notes, selectedNoteId, foldersById, buildNoteTabPath }) {
  return notes.map((note) => `
    <button
      type="button"
      class="note-tab-overflow-item"
      role="menuitemradio"
      aria-checked="${String(note.id === selectedNoteId)}"
      data-tab-overflow-note-id="${escapeAttribute(note.id)}"
      data-active="${String(note.id === selectedNoteId)}"
      aria-label="${escapeAttribute(`${note.title || '未命名资料'}${note.id === selectedNoteId ? '（当前）' : ''}`)}"
      title="${escapeAttribute(buildNoteTabPath(note, foldersById))}"
    >
      <span>${escapeHtml(note.title)}</span>
      <small>${note.id === selectedNoteId ? '当前' : '打开'}</small>
    </button>
  `).join('');
}

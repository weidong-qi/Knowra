import { escapeHtml, escapeAttribute } from '../../src/app/formatting.js';

export const NOTE_TAB_MENU_ITEMS = [
  { action: 'close', label: '关闭' },
  { action: 'close-others', label: '关闭其他' },
  { type: 'divider' },
  { action: 'copy-path', label: '复制路径' }
];

export function renderNoteTabMenuItems(items = NOTE_TAB_MENU_ITEMS) {
  return items
    .map((item) => {
      if (item?.type === 'divider') {
        return '<div class="note-tab-menu-divider" aria-hidden="true"></div>';
      }

      if (!item?.action || !item?.label) {
        return '';
      }

      return `<button type="button" class="note-tab-menu-item" data-tab-menu-action="${escapeAttribute(item.action)}">${escapeHtml(item.label)}</button>`;
    })
    .join('');
}

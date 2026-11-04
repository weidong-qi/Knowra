import {
  EDITOR_CONTEXT_FORMAT_ACTIONS,
  EDITOR_CONTEXT_INDENT_ACTIONS,
  EDITOR_CONTEXT_INSERT_ITEMS,
  EDITOR_CONTEXT_LIST_ACTIONS,
  EDITOR_CONTEXT_PARAGRAPH_ITEMS,
  EDITOR_CONTEXT_PRIMARY_ACTIONS,
  editorContextActionMeta
} from './context-menu-model.js';
import { renderEditorContextIconSvg } from './context-menu-icons.js';
import { renderIcon } from '../icons/icon-map.js';
import { escapeHtml, escapeAttribute } from '../../src/app/formatting.js';

export function renderEditorContextMenuMarkup({ getShortcutLabel = () => '' } = {}) {
  return `
    <div class="editor-context-panel">
      <div class="editor-context-action-row editor-context-action-row-primary">
        ${EDITOR_CONTEXT_PRIMARY_ACTIONS.map(renderEditorContextIconButton).join('')}
      </div>
      <div class="editor-context-action-row">
        ${EDITOR_CONTEXT_FORMAT_ACTIONS.map(renderEditorContextIconButton).join('')}
      </div>
      <div class="editor-context-action-row editor-context-action-row-compact">
        ${EDITOR_CONTEXT_LIST_ACTIONS.map(renderEditorContextIconButton).join('')}
      </div>
      <div class="editor-context-action-row editor-context-action-row-compact">
        ${EDITOR_CONTEXT_INDENT_ACTIONS.map(renderEditorContextIconButton).join('')}
      </div>
      <div class="editor-context-divider" aria-hidden="true"></div>
      ${renderEditorContextSubmenu('标题', EDITOR_CONTEXT_PARAGRAPH_ITEMS, getShortcutLabel)}
      ${renderEditorContextSubmenu('插入', EDITOR_CONTEXT_INSERT_ITEMS, getShortcutLabel)}
    </div>
  `;
}

export function renderEditorContextIconButton(action) {
  const meta = editorContextActionMeta[action];
  if (!meta) {
    return '';
  }

  return `
    <button
      type="button"
      class="editor-context-icon-button"
      data-editor-context-action="${escapeAttribute(action)}"
      title="${escapeAttribute(meta.label)}"
      aria-label="${escapeAttribute(meta.label)}"
    >
      ${renderEditorContextIconSvg(meta.icon)}
    </button>
  `;
}

export function renderEditorContextMenuItem(action, getShortcutLabel = () => '') {
  const meta = editorContextActionMeta[action];
  if (!meta) {
    return '';
  }

  const shortcut = getShortcutLabel(action);
  return `
    <button type="button" class="editor-context-menu-item" data-editor-context-action="${escapeAttribute(action)}">
      <span>${escapeHtml(meta.label)}</span>
      ${shortcut ? `<span class="editor-context-shortcut">${escapeHtml(shortcut)}</span>` : ''}
    </button>
  `;
}

function renderEditorContextSubmenu(label, actions, getShortcutLabel) {
  return `
    <div class="editor-context-submenu-group">
      <button type="button" class="editor-context-submenu-trigger">
        <span>${escapeHtml(label)}</span>
        ${renderIcon('navigationChevron', { className: 'editor-context-submenu-caret' })}
      </button>
      <div class="editor-context-submenu">
        ${actions.map((action) => renderEditorContextMenuItem(action, getShortcutLabel)).join('')}
      </div>
    </div>
  `;
}


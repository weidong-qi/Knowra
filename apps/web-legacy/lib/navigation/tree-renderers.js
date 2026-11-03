import { escapeHtml, escapeAttribute } from '../../src/app/formatting.js';
import { renderIcon } from '../icons/icon-map.js';

export function renderFolderIcon(open) {
  return renderIcon(open ? 'folderOpen' : 'folder', {
    className: 'library-tree-icon'
  });
}

export function renderNoteIcon(iconKind = 'markdown') {
  const iconNames = {
    pdf: 'notePdf',
    resource: 'noteResource',
    markdown: 'noteMarkdown'
  };
  const iconName = iconNames[iconKind] ?? iconNames.markdown;
  const iconClass = iconKind in iconNames ? iconKind : 'markdown';
  return renderIcon(iconName, {
    className: `library-tree-icon library-tree-icon-${iconClass}`
  });
}

export function renderNavigationSection({ key, label, count, children, open, isDropTarget = false }) {
  const isMaterials = key === 'materials';
  const isRecycle = key === 'recycle';

  return `
    <div class="library-node-group library-section-group">
      <button
        type="button"
        class="library-node library-section-node"
        data-nav-section="${escapeAttribute(key)}"
        data-open="${open}"
        data-level="0"
        data-drop-target="${isDropTarget}"
        ${isMaterials ? 'data-materials-section="true"' : ''}
        ${isRecycle ? 'data-recycle-section="true"' : ''}
      >
        <span class="library-node-leading">
          ${renderIcon('navigationChevron', { className: 'library-chevron', data: { 'data-open': open } })}
        </span>
        <span class="library-node-label library-section-label">${escapeHtml(label)}</span>
        <span class="library-section-meta">${escapeHtml(count)}</span>
      </button>
      ${open ? `<div class="library-node-children">${children}</div>` : ''}
    </div>
  `;
}

export function renderNoteNode({
  note,
  level,
  selected = false,
  isDragging = false,
  iconKind = 'markdown'
}) {
  return `
    <button
      type="button"
      class="library-node library-note-node"
      data-note-id="${escapeAttribute(note.id)}"
      data-level="${level}"
      data-selected="${selected}"
      data-drag-kind="note"
      data-drag-id="${escapeAttribute(note.id)}"
      data-dragging="${isDragging}"
      title="${escapeAttribute(note.title)}"
      draggable="true"
    >
      <span class="library-node-leading">
        <span class="library-node-spacer"></span>
        ${renderNoteIcon(iconKind)}
      </span>
      <span class="library-node-label">${escapeHtml(note.title)}</span>
    </button>
  `;
}

export function renderRecycleNoteNode({ note, level, iconKind = 'markdown' }) {
  return `
    <div class="library-node-group">
      <button
        type="button"
        class="library-node library-note-node library-note-node-recycle"
        data-recycle-note-id="${escapeAttribute(note.id)}"
        data-level="${level}"
        title="${escapeAttribute(note.title)}"
      >
        <span class="library-node-leading">
          <span class="library-node-spacer"></span>
          ${renderNoteIcon(iconKind)}
        </span>
        <span class="library-node-label">${escapeHtml(note.title)}</span>
      </button>
    </div>
  `;
}

export function renderInlineEditorRow({ level, mode, value }) {
  const placeholder = mode.includes('folder') ? '输入目录名称' : '输入文件名称';

  return `
    <div class="library-inline-editor" style="--tree-level:${level}">
      <form class="library-inline-form" data-inline-editor-form>
        <span class="library-inline-icon" aria-hidden="true">
          ${mode.includes('folder') ? renderFolderIcon(true) : renderNoteIcon('markdown')}
        </span>
        <input
          type="text"
          class="library-inline-input"
          data-inline-editor-input
          value="${escapeAttribute(value)}"
          placeholder="${placeholder}"
          autocomplete="off"
          spellcheck="false"
        />
        <div class="library-inline-actions">
          <button type="submit" class="library-inline-action library-inline-action-primary">保存</button>
          <button type="button" class="library-inline-action" data-editor-cancel>取消</button>
        </div>
      </form>
    </div>
  `;
}

export function renderDeleteIntentRow({ level, kind, targetId, name }) {
  return `
    <div class="library-inline-confirm" style="--tree-level:${level}">
      <div class="library-inline-confirm-body">
        <span class="library-inline-confirm-text">删除“${escapeHtml(name)}”后将立即生效</span>
        <div class="library-inline-actions">
          <button type="button" class="library-inline-action library-inline-action-danger" data-delete-confirm="${escapeAttribute(kind)}" data-target-id="${escapeAttribute(targetId)}">删除</button>
          <button type="button" class="library-inline-action" data-delete-cancel>取消</button>
        </div>
      </div>
    </div>
  `;
}

export function renderEmptyTreeItem(label) {
  return `
    <div class="library-node library-static-node library-empty-node" data-level="1">
      <span class="library-node-leading">
        <span class="library-node-spacer"></span>
      </span>
      <span class="library-node-label">${escapeHtml(label)}</span>
    </div>
  `;
}

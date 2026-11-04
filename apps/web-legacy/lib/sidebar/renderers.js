import { escapeHtml, escapeAttribute } from '../../src/app/formatting.js';
import { normalizeTagColor } from '../theme/runtime-colors.js';
import { renderIcon } from '../icons/icon-map.js';

export function renderAsideTabs({ tabs = [], activeKey = null } = {}) {
  return tabs
    .map(
      (tab) => `
        <button
          type="button"
          class="aside-tab"
          data-aside-tab="${escapeAttribute(tab.key)}"
          data-active="${String(activeKey === tab.key)}"
          id="aside-tab-${escapeAttribute(tab.key)}"
          role="tab"
          aria-controls="aside-content"
          aria-selected="${String(activeKey === tab.key)}"
          tabindex="${activeKey === tab.key ? '0' : '-1'}"
        >${escapeHtml(tab.label)}</button>
      `
    )
    .join('');
}

export function renderAsideEmptyState() {
  return `
    <section class="aside-panel-empty">
      <strong>未打开笔记</strong>
      <span>请先在左侧选择一个文件。</span>
    </section>
  `;
}

export function renderAiTab(note) {
  return `
    <section class="aside-panel-stack">
      <section class="aside-card">
        <div class="aside-card-header">
          <span>AI</span>
          <strong>${escapeHtml(note.title)}</strong>
        </div>
        <div class="aside-placeholder">AI 辅助区将在右侧面板内继续扩展。</div>
      </section>
    </section>
  `;
}

export function renderTagPills(tags) {
  return tags
    .map(
      (tag) => `
        <span class="pill" data-accent="true">
          ${renderTagColorDot(tag.color)}
          ${escapeHtml(tag.name)}
        </span>
      `
    )
    .join('');
}

export function renderAssignedTagPills(tags) {
  return tags
    .map(
      (tag) => `
        <button type="button" class="pill pill-button" data-accent="true" data-note-tag-remove="${escapeAttribute(tag.id)}" title="移除标签：${escapeAttribute(tag.name)}">
          ${renderTagColorDot(tag.color)}
          <span>${escapeHtml(tag.name)}</span>
          <span class="pill-action" aria-hidden="true">${renderIcon('cancel', { className: 'pill-action-icon' })}</span>
        </button>
      `
    )
    .join('');
}

export function renderAvailableTagPills(tags) {
  return tags
    .map(
      (tag) => `
        <button type="button" class="pill pill-button" data-note-tag-add="${escapeAttribute(tag.id)}" title="添加标签：${escapeAttribute(tag.name)}">
          ${renderTagColorDot(tag.color)}
          <span>${escapeHtml(tag.name)}</span>
          <span class="pill-action" aria-hidden="true">${renderIcon('create', { className: 'pill-action-icon' })}</span>
        </button>
      `
    )
    .join('');
}

function renderTagColorDot(color) {
  return `<span class="tag-color-dot" aria-hidden="true" style="--tag-dot-color: ${escapeAttribute(normalizeTagColor(color))};"></span>`;
}

export function renderLinkedNotes(linkedNotes) {
  return linkedNotes
    .map(
      (linkedNote) => `
        <div class="linked-row">
          <button type="button" data-linked-id="${escapeAttribute(linkedNote.id)}">
            <div class="linked-meta">
              <strong>${escapeHtml(linkedNote.title)}</strong>
              <span>${escapeHtml(linkedNote.summary || linkedNote.plainText || '')}</span>
            </div>
          </button>
        </div>
      `
    )
    .join('');
}

export function renderAttachments(attachments, attachmentRenaming = null) {
  return attachments
    .map(
      (attachment) => {
        const isRenaming = attachmentRenaming?.id === attachment.id;
        const statusLabel = getAttachmentStatusLabel(attachment.status);
        if (isRenaming) {
          return `
            <div class="resource-row resource-row-editing" data-referenced="${String(Boolean(attachment.isReferenced))}">
              <form class="resource-rename-form" data-attachment-rename-form="${escapeAttribute(attachment.id)}">
                <span class="library-inline-icon resource-rename-icon" aria-hidden="true">${renderIcon('rename', { className: 'resource-rename-glyph' })}</span>
                <label class="resource-rename-field">
                  <input
                    name="fileName"
                    type="text"
                    class="library-inline-input resource-rename-input"
                    value="${escapeAttribute(attachmentRenaming?.draft ?? attachment.fileName)}"
                    data-attachment-rename-input="${escapeAttribute(attachment.id)}"
                    placeholder="输入附件名"
                    autocomplete="off"
                    spellcheck="false"
                  />
                  <span class="resource-rename-extension">${escapeHtml(attachmentRenaming?.extension ?? '.png')}</span>
                </label>
                <div class="library-inline-actions resource-rename-actions">
                  <button type="submit" class="library-inline-action" title="确认" aria-label="确认">${renderIcon('confirm', { className: 'library-inline-action-icon' })}</button>
                  <button type="button" class="library-inline-action" data-attachment-rename-cancel title="取消" aria-label="取消">${renderIcon('cancel', { className: 'library-inline-action-icon' })}</button>
                </div>
              </form>
            </div>
          `;
        }

        return `
          <div class="resource-row" data-referenced="${String(Boolean(attachment.isReferenced))}" data-attachment-status="${escapeAttribute(attachment.status || 'ready')}">
            <button
              type="button"
              class="resource-entry"
              data-attachment-id="${escapeAttribute(attachment.id)}"
              data-attachment-name="${escapeAttribute(attachment.fileName)}"
              data-attachment-referenced="${String(Boolean(attachment.isReferenced))}"
              title="${escapeAttribute(attachment.fileName)}"
              aria-label="附件：${escapeAttribute(attachment.fileName)}；${escapeAttribute(attachment.mimeType)}；${escapeAttribute(statusLabel || (attachment.isReferenced ? '已引用' : '未引用'))}"
            >
              <div class="resource-meta">
                <strong title="${escapeAttribute(attachment.fileName)}">${escapeHtml(attachment.fileName)}</strong>
                <span>${escapeHtml(attachment.mimeType)}</span>
              </div>
              <span class="resource-badge" data-referenced="${String(Boolean(attachment.isReferenced))}" data-attachment-status="${escapeAttribute(attachment.status || 'ready')}" title="${escapeAttribute(statusLabel || '')}">
                ${escapeHtml(statusLabel || (attachment.isReferenced ? '已引用' : '未引用'))}
              </span>
            </button>
            <button
              type="button"
              class="subtle-button resource-inline-action"
              data-attachment-open="${escapeAttribute(attachment.id)}"
            >
              打开
            </button>
          </div>
        `;
      }
    )
    .join('');
}

function getAttachmentStatusLabel(status) {
  return {
    missing: '文件缺失',
    corrupt: '文件损坏',
    pending: '处理中',
    failed: '上传失败'
  }[status] ?? '';
}

export function renderAsideEmptyInline(label) {
  return `<div class="aside-empty-inline">${escapeHtml(label)}</div>`;
}

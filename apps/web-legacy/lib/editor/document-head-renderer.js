import {
  escapeAttribute,
  escapeHtml,
  formatCompactDate
} from '../../src/app/formatting.js';
import { buildNotePath } from '../navigation/selection.js';
import { resolveNoteTags, renderTagList } from '../tags/inline-renderers.js';
import { renderIcon } from '../icons/icon-map.js';
import { getSourceTypeLabel, getStatusLabel } from '../library-index/model.js';

function renderBreadcrumb(note, state) {
  return buildNotePath({
    note: {
      ...note,
      title: state.draftTitle || note.title
    },
    foldersById: state.foldersById
  })
    .split(' / ')
    .map((segment, index, segments) => `
      <li${index === segments.length - 1 ? ' aria-current="page"' : ''}>
        <span title="${escapeAttribute(segment)}">${escapeHtml(segment)}</span>
      </li>
    `)
    .join('');
}

export function renderEditorDocumentHead({ note, state }) {
  if (!note) {
    return '<div class="document-head-empty">选择一条资料开始编辑</div>';
  }

  const tags = resolveNoteTags(note, state.tags);
  const breadcrumb = renderBreadcrumb(note, state);
  const createdAt = formatCompactDate(note.createdAt);
  const updatedAt = formatCompactDate(note.updatedAt);

  return `
    <section class="document-head">
      <div class="document-meta-row">
        <div class="document-location">
          <nav class="document-breadcrumb" aria-label="资料路径">
            <ol class="breadcrumb">${breadcrumb}</ol>
          </nav>
          <span class="document-status" data-document-status="${escapeAttribute(note.status ?? 'active')}">
            <span class="document-status-dot" aria-hidden="true"></span>
            ${escapeHtml(getStatusLabel(note.status))}
          </span>
        </div>
        <div class="document-dates" aria-label="资料时间">
          <span class="document-date-item">创建 <time datetime="${escapeAttribute(note.createdAt ?? '')}">${escapeHtml(createdAt)}</time></span>
          <span class="document-date-separator" aria-hidden="true">·</span>
          <span class="document-date-item">编辑 <time datetime="${escapeAttribute(note.updatedAt ?? '')}">${escapeHtml(updatedAt)}</time></span>
        </div>
      </div>
      <div class="document-title-row">
        <div class="document-title">
          <div class="document-title-kicker">
            ${renderIcon('sectionFile', { className: 'document-title-kicker-icon' })}
            <span>${escapeHtml(getSourceTypeLabel(note.sourceType))}</span>
            <span class="document-title-kicker-separator" aria-hidden="true">·</span>
            <span>知识资料</span>
          </div>
          <input
            type="text"
            class="document-title-input"
            data-document-title-input
            value="${escapeAttribute(state.draftTitle || note.title)}"
            aria-label="资料标题"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
        <div class="document-tag-footer">
          <span class="document-tag-label">标签</span>
          <div class="tag-row">${renderTagList(tags)}</div>
        </div>
      </div>
    </section>
  `;
}

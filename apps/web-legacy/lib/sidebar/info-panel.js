import { decorateAttachmentsForDisplay } from './attachments.js';
import {
  renderAsideEmptyInline,
  renderAssignedTagPills,
  renderAttachments,
  renderAvailableTagPills,
  renderLinkedNotes
} from './renderers.js';
import { getNoteStats } from './stats.js';
import { escapeHtml, escapeAttribute } from '../../src/app/formatting.js';
import { renderSectionIcon } from '../library-index/renderers.js';
import { renderIcon } from '../icons/icon-map.js';

export function renderInfoTab({
  note,
  markdown = '',
  folderPath = '',
  tags = [],
  tagComposer = { draft: '', isExpanded: false },
  linkedNotes = [],
  attachments = [],
  attachmentRenaming = null,
  formatDate = (value) => value ?? ''
}) {
  const stats = getNoteStats(markdown || note.rawMarkdown || '');
  const decoratedAttachments = decorateAttachmentsForDisplay(attachments, markdown || note.rawMarkdown || '');

  return `
    <section class="aside-panel-stack">
      <section class="inspector-fixed-section note-info-card">
        <header>${renderSectionIcon('file')}<h3>资料信息</h3></header>
        <dl class="inspector-record">
          <div><dt>标题</dt><dd>${escapeHtml(note.title)}</dd></div>
          <div><dt>路径</dt><dd>${escapeHtml(folderPath)}</dd></div>
          <div><dt>字数</dt><dd>${stats.characterCount}</dd></div>
          <div><dt>更新时间</dt><dd>${formatDate(note.updatedAt)}</dd></div>
          <div><dt>创建时间</dt><dd>${formatDate(note.createdAt)}</dd></div>
          <div><dt>收藏状态</dt><dd>${note.favorite ? '已收藏' : '未收藏'}</dd></div>
        </dl>
      </section>
      <section class="inspector-fixed-section note-tags-card">
        <header>${renderSectionIcon('tag')}<h3>标签</h3></header>
        ${renderNoteTagComposer({ note, tags, tagComposer })}
      </section>
      <div class="summary-groups editor-summary-groups">
        <details class="inspector-disclosure">
          <summary><span>${renderSectionIcon('link')}<b>关联笔记</b></span><span><small>${linkedNotes.length}</small>${renderIcon('disclosureChevron', { className: 'disclosure-chevron' })}</span></summary>
          <div class="disclosure-body linked-list">${linkedNotes.length ? renderLinkedNotes(linkedNotes) : renderAsideEmptyInline('暂无关联笔记')}</div>
        </details>
        <details class="inspector-disclosure">
          <summary><span>${renderSectionIcon('paperclip')}<b>附件</b></span><span><small>${decoratedAttachments.length}</small>${renderIcon('disclosureChevron', { className: 'disclosure-chevron' })}</span></summary>
          <div class="disclosure-body resource-list">${decoratedAttachments.length ? renderAttachments(decoratedAttachments, attachmentRenaming) : renderAsideEmptyInline('暂无附件')}</div>
        </details>
      </div>
    </section>
  `;
}

export function renderNoteTagComposer({ note, tags = [], tagComposer = { draft: '', isExpanded: false } }) {
  const noteTagIds = note.tagIds ?? [];
  const assignedTags = noteTagIds
    .map((tagId) => tags.find((tag) => tag.id === tagId))
    .filter(Boolean);
  const availableTags = tags.filter((tag) => !noteTagIds.includes(tag.id));
  const draft = tagComposer.draft.trim();
  const draftLowerCase = draft.toLowerCase();
  const matchingTags = draftLowerCase
    ? availableTags.filter((tag) => tag.name.toLowerCase().includes(draftLowerCase))
    : availableTags.slice(0, 8);
  const existingExactTag = tags.find((tag) => tag.name.trim().toLowerCase() === draftLowerCase);
  const canCreateTag = Boolean(draft) && !existingExactTag;

  return `
    <div class="note-tag-composer">
      <div class="note-tag-toolbar">
        <div class="pill-row">
          ${assignedTags.length ? renderAssignedTagPills(assignedTags) : '<span class="note-tag-empty">暂无标签</span>'}
        </div>
        <button type="button" class="subtle-button note-tag-toggle" data-note-tag-toggle>
          ${tagComposer.isExpanded ? '收起' : '添加标签'}
        </button>
      </div>
      ${tagComposer.isExpanded ? `
        <div class="note-tag-composer-body">
          <label class="note-tag-input-shell">
            <input
              type="text"
              value="${escapeAttribute(tagComposer.draft)}"
              data-note-tag-input
              placeholder="输入标签名，回车可创建并绑定"
              autocomplete="off"
              spellcheck="false"
            />
            ${canCreateTag ? '<button type="button" class="subtle-button note-tag-create" data-note-tag-create>创建</button>' : ''}
          </label>
          ${matchingTags.length ? `
            <div class="pill-row note-tag-suggestions">
              ${renderAvailableTagPills(matchingTags)}
            </div>
          ` : ''}
        </div>
      ` : ''}
    </div>
  `;
}

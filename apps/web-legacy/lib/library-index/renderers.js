import {
  escapeAttribute,
  escapeHtml,
  formatCompactDate
} from '../../src/app/formatting.js';
import { buildFolderPath } from '../navigation/selection.js';
import { resolveNoteTags, renderTagList } from '../tags/inline-renderers.js';
import { getSourceTypeLabel, getStatusLabel } from './model.js';
import { renderLibraryPagination } from './pagination-renderers.js';
import { renderIcon } from '../icons/icon-map.js';

export function renderLibraryIndexScope({ notes, state }) {
  const folderName = state.selectedFolderId ? state.foldersById[state.selectedFolderId]?.name : null;
  const scope = folderName || ({
    all: '全部资料',
    recent: '最近资料',
    favorites: '收藏资料',
    recycle: '回收站'
  }[state.libraryIndex.tab] ?? '全部资料');
  const latest = notes[0]?.updatedAt ? formatCompactDate(notes[0].updatedAt) : '暂无记录';
  return `
    <span class="scope-label">浏览范围</span>
    <strong title="${escapeAttribute(scope)}">${escapeHtml(scope)}</strong>
    <span class="scope-separator" aria-hidden="true">·</span>
    <span class="scope-label">最近更新</span>
    <time>${escapeHtml(latest)}</time>
  `;
}

export function renderLibraryIndexContent({ notes, pagination, state }) {
  if (!notes.length) {
    return `
      <section class="entry-list">
        <div class="empty-state">
          <strong>没有找到匹配条目</strong>
          <span>可以清除搜索、切换资料范围或返回全部资料。</span>
          <button type="button" data-index-clear>清除筛选</button>
        </div>
      </section>
      <footer class="pagination"><span>当前 0 条</span></footer>
    `;
  }

  const selectedId = state.libraryIndex.selectedNoteId;
  return `
    <section class="entry-list index-list-card" aria-label="资料条目">
      ${notes.map((note) => renderIndexEntry({
        note,
        selected: note.id === selectedId,
        state
      })).join('')}
    </section>
    ${renderLibraryPagination(pagination)}
  `;
}

export function renderLibraryIndexInspector({ note, state }) {
  if (!state.libraryIndex.inspectorOpen) {
    return '<button type="button" class="reopen-panel" data-index-inspector-open aria-expanded="false" aria-controls="library-index-inspector" aria-label="展开详情" title="展开详情">详情</button>';
  }

  const closeButton = `
    <button type="button" class="panel-close" data-index-inspector-close aria-expanded="true" aria-controls="library-index-inspector" aria-label="收起详情" title="收起详情">
      ${renderIcon('navigationChevron', { className: 'panel-close-icon' })}
    </button>
  `;
  const inspectorHeader = `
    <header class="inspector-head panel-head">
      <span class="panel-head-title"><span class="panel-head-icon" aria-hidden="true">${renderIcon('sectionFile', { className: 'inspector-head-icon' })}</span><span>资料详情</span></span>
      <span class="inspector-head-grow"></span>
      ${note ? `<button type="button" class="inspector-open-button" data-index-open="${escapeAttribute(note.id)}" aria-label="打开资料：${escapeAttribute(note.title)}" title="打开资料">${renderIcon('inspectorOpen', { className: 'inspector-open-icon' })}<span>打开</span></button>` : ''}
      ${closeButton}
    </header>
  `;

  if (!note) {
    return `
      ${inspectorHeader}
      <div class="index-inspector-content">
        <header class="inspector-heading inspector-heading-empty"><strong class="inspector-heading-title">未选择资料</strong></header>
        <div class="inspector-empty"><strong>未选择资料</strong><span>请从列表中选择一条资料。</span></div>
      </div>
    `;
  }

  const tags = resolveNoteTags(note, state.tags);
  const folderPath = buildFolderPath({ folderId: note.folderId, foldersById: state.foldersById }) || '未分类';
  const linkedNotes = (note.internalLinks ?? [])
    .map((noteId) => state.allNotes.find((item) => item.id === noteId))
    .filter(Boolean);
  const outline = Array.isArray(note.outline)
    ? note.outline
    : extractOutline(note.rawMarkdown ?? '');
  const attachments = note.id === state.selectedNoteId
    ? state.attachments
    : (Array.isArray(note.attachments) ? note.attachments : []);

  return `
    ${inspectorHeader}
    <div class="index-inspector-content">
      ${renderFixedSection({ icon: 'file', title: '资料信息', content: `
        <dl class="inspector-record">
          <div><dt>类型</dt><dd>${escapeHtml(getSourceTypeLabel(note.sourceType))}</dd></div>
          <div><dt>所在位置</dt><dd>${escapeHtml(folderPath)}</dd></div>
          <div><dt>字数</dt><dd>${resolveCharacterCount(note)}</dd></div>
          <div><dt>最后编辑</dt><dd>${escapeHtml(formatCompactDate(note.updatedAt))}</dd></div>
          <div><dt>收藏</dt><dd>${note.favorite ? '已收藏' : '未收藏'}</dd></div>
        </dl>
      ` })}
      ${renderDisclosure({ icon: 'tag', title: '标签', count: tags.length, content: `
        <div class="inspector-tag-wrap tag-row">${renderTagList(tags)}</div>
      ` })}
      <div class="summary-groups">
        ${renderDisclosure({ icon: 'link', title: '关联笔记', count: linkedNotes.length, content: linkedNotes.length
          ? `<ol class="relations">${linkedNotes.map((item) => `<li><button type="button" class="relation-link" data-index-open="${escapeAttribute(item.id)}" aria-label="打开关联资料：${escapeAttribute(item.title)}" title="打开关联资料">${escapeHtml(shortId(item.id))}</button><span>${escapeHtml(item.title)}</span></li>`).join('')}</ol>`
          : '<span class="aside-empty-inline">暂无关联笔记</span>' })}
        ${renderDisclosure({ icon: 'list', title: '内容大纲', count: outline.length, content: outline.length
          ? `<ol class="outline preview-outline">${outline.map((item) => `<li>${escapeHtml(item.title)}</li>`).join('')}</ol>`
          : '<span class="aside-empty-inline">当前资料还没有标题</span>' })}
        ${renderDisclosure({ icon: 'paperclip', title: '附件', count: attachments.length, content: attachments.length
          ? attachments.map((item) => `<button type="button" class="resource-row" data-attachment-open="${escapeAttribute(item.id)}" aria-label="打开附件：${escapeAttribute(item.fileName)}"><span>${escapeHtml(item.fileName)}</span><small>${escapeHtml(item.mimeType ?? '')}</small></button>`).join('')
          : '<span class="aside-empty-inline">打开资料后可管理附件</span>' })}
      </div>
    </div>
  `;
}

function renderIndexEntry({ note, selected, state }) {
  const tags = resolveNoteTags(note, state.tags);
  return `
    <article class="index-entry" data-index-note-select="${escapeAttribute(note.id)}" data-selected="${String(selected)}" tabindex="0" title="双击打开资料">
      ${renderArchiveMark(note)}
      <div class="entry-copy">
        <div class="entry-heading"><h2>${escapeHtml(note.title)}</h2><span class="status ${note.deleted ? 'status-deleted' : `status-${escapeAttribute(note.status ?? 'active')}`}\"><i></i>${note.deleted ? '已删除' : getStatusLabel(note.status)}</span></div>
        <p>${escapeHtml(summarizeNote(note))}</p>
        <div class="tag-row">${renderTagList(tags)}<span class="entry-source-type">${escapeHtml(getSourceTypeLabel(note.sourceType))}</span></div>
      </div>
      <div class="entry-meta">
        <span>${escapeHtml(formatCompactDate(note.updatedAt))}</span>
        <button
          type="button"
          class="entry-action"
          ${note.deleted ? `data-index-restore="${escapeAttribute(note.id)}"` : `data-index-open="${escapeAttribute(note.id)}"`}
          aria-label="${note.deleted ? `恢复资料：${escapeAttribute(note.title)}` : `打开资料：${escapeAttribute(note.title)}`}"
        >
          ${note.deleted
            ? '<span>恢复</span>'
            : `<span>打开</span>${renderIcon('inspectorOpen', { className: 'entry-action-icon' })}`}
        </button>
      </div>
    </article>
  `;
}

function renderArchiveMark(note) {
  const icon = note?.sourceType === 'manual'
    ? 'noteManual'
    : note?.sourceType === 'pdf-import'
      ? 'notePdf'
      : note?.sourceType === 'imported-file'
        ? 'noteResource'
        : 'noteMarkdown';
  return `
    <div class="entry-archive" role="img" aria-label="资料类型图标">
      ${renderIcon(icon, { className: 'entry-book-cover' })}
    </div>
  `;
}

function renderFixedSection({ icon, title, content }) {
  return `<section class="inspector-fixed-section"><header>${renderSectionIcon(icon)}<h3>${title}</h3></header>${content}</section>`;
}

function renderDisclosure({ icon, title, count, content }) {
  return `<details class="inspector-disclosure"><summary><span>${renderSectionIcon(icon)}<b>${title}</b></span><span><small>${count}</small>${renderIcon('disclosureChevron', { className: 'disclosure-chevron' })}</span></summary><div class="disclosure-body">${content}</div></details>`;
}

export function renderSectionIcon(kind) {
  const iconNames = {
    file: 'sectionFile',
    tag: 'sectionTag',
    link: 'sectionLink',
    list: 'sectionList',
    paperclip: 'sectionAttachment'
  };
  return renderIcon(iconNames[kind] ?? iconNames.file, { className: 'section-icon' });
}

function summarizeNote(note) {
  const raw = String(note.summary ?? note.rawMarkdown ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~\[\]-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return raw.slice(0, 132) || '这条资料还没有正文摘要。';
}

function extractOutline(markdown) {
  return String(markdown).split('\n').flatMap((line) => {
    const match = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    return match ? [{ level: match[1].length, title: match[2].trim() }] : [];
  });
}

function countCharacters(markdown = '') {
  return String(markdown).replace(/\s/g, '').length;
}

function resolveCharacterCount(note) {
  return Number.isFinite(Number(note?.characterCount))
    ? Number(note.characterCount)
    : countCharacters(note?.rawMarkdown);
}

function shortId(value) {
  const normalized = String(value ?? '').replace(/[^a-zA-Z0-9]/g, '');
  return (normalized.slice(-3) || '001').toUpperCase();
}

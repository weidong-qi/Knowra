import { escapeAttribute, escapeHtml, formatCompactDate } from '../../src/app/formatting.js';
import { renderIcon } from '../icons/icon-map.js';
import { getSourceTypeLabel, getStatusLabel } from '../library-index/model.js';
import { selectHomeRecentNotes, selectHomeSummary } from './model.js';

const HOME_MODULE_CARDS = Object.freeze([
  {
    key: 'materials',
    title: '沉浸式写作',
    icon: 'homeWriting',
    action: '进入编辑器',
    description: '专注 Markdown 资料的采集、编辑与整理，随时进入正式资料工作台。'
  },
  {
    key: 'knowledge',
    title: '双向链接知识库',
    icon: 'homeKnowledge',
    action: '管理知识',
    description: '管理碎片化知识单元，通过关联与回顾逐步构建你的知识网络。'
  },
  {
    key: 'training',
    title: '训练与题库',
    icon: 'homeTraining',
    action: '开始训练',
    description: '从题库和训练概览进入真实学习数据，集中安排练习与错题回顾。'
  }
]);

export function renderHomeWorkspace(state) {
  const recentNotes = selectHomeRecentNotes(state, 4);
  const summary = selectHomeSummary(state, recentNotes);
  return `
    <div class="home-workspace" data-home-workspace data-home-loading="${String(summary.isLoading)}">
      ${renderWelcome(summary)}
      <section class="home-module-grid" aria-label="核心工作模块">
        ${HOME_MODULE_CARDS.map(renderHomeModuleCard).join('')}
      </section>
      <section class="home-recent-section" aria-labelledby="home-recent-heading">
        <header class="home-section-heading home-recent-heading">
          <h2 id="home-recent-heading">${renderIcon('homeRecent', { className: 'home-heading-icon' })}最近编辑</h2>
          <button type="button" class="home-secondary-action ink-button ink-button-compact" data-home-action="open-library">查看全部</button>
        </header>
        ${renderRecentTable(recentNotes, summary.isLoading)}
      </section>
    </div>
  `;
}

export function renderHomeLoading() {
  return `
    <div class="home-workspace home-workspace-loading" data-home-workspace data-home-loading="true">
      <div class="home-loading-state" role="status" aria-live="polite">
        <span class="home-section-kicker">WORKBENCH</span>
        <strong>正在加载资料工作台…</strong>
        <span>正在读取真实资料与文件夹状态。</span>
      </div>
    </div>
  `;
}

function renderWelcome(summary) {
  const summaryText = summary.isLoading
    ? '正在同步真实资料状态。'
    : `已整理 ${summary.noteCount} 条资料，最近有 ${summary.recentCount} 条更新。保持专注。`;
  return `
    <header class="home-welcome">
      <div class="home-welcome-copy">
        <h1>你好，创造者。</h1>
        <p>${escapeHtml(summaryText)}</p>
      </div>
      <div class="home-welcome-actions">
        <button type="button" class="home-secondary-action ink-button" data-home-action="open-library">
          ${renderIcon('homeCalendar', { className: 'home-action-icon' })}资料库
        </button>
        <button type="button" class="home-primary-action ink-button ink-button-primary" data-home-action="open-library">
          ${renderIcon('homeWriting', { className: 'home-action-icon' })}新建笔记 <kbd>Ctrl+N</kbd>
        </button>
      </div>
    </header>
  `;
}

function renderHomeModuleCard(card) {
  return `
    <article class="home-module-card ink-card-interactive" data-home-domain-card="${escapeAttribute(card.key)}" data-home-domain-state="ready">
      <header class="home-module-card-header">
        <span class="home-module-icon" aria-hidden="true">${renderIcon(card.icon, { className: 'home-module-icon-image' })}</span>
        <span class="home-module-more" aria-hidden="true">•••</span>
      </header>
      <h2>${escapeHtml(card.title)}</h2>
      <p>${escapeHtml(card.description)}</p>
      <button type="button" class="home-module-action ink-button ink-button-compact" data-home-module="${escapeAttribute(card.key)}">${escapeHtml(card.action)} <span aria-hidden="true">→</span></button>
    </article>
  `;
}

function renderRecentTable(notes, isLoading) {
  if (isLoading) return '<div class="home-recent-empty" role="status">正在读取最近编辑…</div>';
  if (!notes.length) {
    return '<div class="home-recent-empty"><strong>还没有最近编辑资料</strong><span>进入资料库后创建或导入第一条资料。</span></div>';
  }
  return `
    <div class="home-recent-table-wrap">
      <table class="home-recent-table">
        <tbody>${notes.map(renderRecentRow).join('')}</tbody>
      </table>
    </div>
  `;
}

function renderRecentRow(note) {
  const title = note.title || '未命名资料';
  return `
    <tr>
      <td>
        <button type="button" class="home-recent-note" data-home-note-open="${escapeAttribute(note.id)}">
          ${renderIcon('noteMarkdown', { className: 'home-recent-note-icon' })}
          <strong>${escapeHtml(title)}</strong>
        </button>
      </td>
      <td class="home-recent-date">${escapeHtml(formatCompactDate(note.updatedAt || note.createdAt))}</td>
      <td><span class="home-recent-status" data-home-note-status="${escapeAttribute(note.status || 'draft')}">${escapeHtml(getStatusLabel(note.status))}</span></td>
      <td class="home-recent-source">${escapeHtml(getSourceTypeLabel(note.sourceType))}</td>
    </tr>
  `;
}

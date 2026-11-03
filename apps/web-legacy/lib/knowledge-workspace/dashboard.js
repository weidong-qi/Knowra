import { escapeAttribute, escapeHtml } from '../../src/app/formatting.js';
import {
  renderCountLabel,
  renderStatusBadge,
  renderWorkDomainEmpty
} from '../work-domains/renderers.js';

export function renderKnowledgeOverview(overview) {
  if (!overview) {
    return renderWorkDomainEmpty('还没有知识工作区数据', '进入知识单元页面后，系统会从真实 KnowledgeItem 查询生成概览。');
  }
  const itemCounts = overview.knowledgeItems?.byReviewStatus ?? {};
  const evidenceCounts = overview.evidence?.byHealth ?? {};
  const coverage = overview.coverage ?? {};
  const recentItems = overview.recentItems ?? [];
  return `<div class="workspace-dashboard">
    <section class="workspace-dashboard-lead"><span class="workspace-eyebrow">KNOWLEDGE COVERAGE</span><h2>知识资产正在从资料中沉淀。</h2><p>这里集中查看知识单元、来源健康、学习目标覆盖和待处理审核事项。所有数字来自当前后端查询，不推导掌握度。</p></section>
    <section class="workspace-metric-grid" aria-label="知识资产统计">
      ${renderCountLabel(overview.knowledgeItems?.total, '知识单元')}
      ${renderCountLabel(itemCounts.candidate, '候选')}
      ${renderCountLabel(itemCounts.confirmed, '已确认')}
      ${renderCountLabel(coverage.itemsWithoutConfirmedObjective, '缺少已确认目标')}
    </section>
    <div class="workspace-dashboard-columns">
      <section class="workspace-dashboard-section"><header><span class="workspace-section-kicker">SOURCE HEALTH</span><h3>来源健康</h3></header><div class="workspace-status-list">${renderHealthRow('valid', '有效', evidenceCounts.valid)}${renderHealthRow('stale', '待复核', evidenceCounts.stale)}${renderHealthRow('invalid', '已失效', evidenceCounts.invalid)}${renderHealthRow('insufficient', '来源不足', evidenceCounts.insufficient)}</div></section>
      <section class="workspace-dashboard-section"><header><span class="workspace-section-kicker">RECENT UPDATES</span><h3>最近更新</h3></header>${recentItems.length ? `<div class="workspace-recent-list">${recentItems.map(renderRecentItem).join('')}</div>` : '<p class="workspace-muted-copy">还没有知识单元记录。</p>'}</section>
    </div>
  </div>`;
}

function renderHealthRow(status, label, count) {
  return `<div class="workspace-health-row"><span>${renderStatusBadge(status, { valid: '有效', stale: '待复核', invalid: '已失效', insufficient: '不足' })}</span><strong>${escapeHtml(String(count ?? 0))}</strong><small>${escapeHtml(label)}</small></div>`;
}

function renderRecentItem(item) {
  return `<button type="button" class="workspace-recent-row" data-knowledge-select="${escapeAttribute(item.id)}"><span><strong>${escapeHtml(item.title || '未命名知识单元')}</strong><small>${escapeHtml(item.updatedAt || '')}</small></span>${renderStatusBadge(item.reviewStatus, { candidate: '候选', confirmed: '已确认', needsRevision: '需修订', archived: '已归档' })}</button>`;
}

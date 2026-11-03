import { escapeAttribute, escapeHtml } from '../../src/app/formatting.js';
import { renderCountLabel, renderStatusBadge, renderWorkDomainEmpty } from '../work-domains/renderers.js';

export function renderTrainingOverview(overview) {
  if (!overview) return renderWorkDomainEmpty('还没有训练工作区数据', '创建题目或考试场景后，训练概览会显示真实资产状态。');
  const counts = overview.questions?.byReviewStatus ?? {};
  const review = overview.review ?? {};
  return `<div class="workspace-dashboard"><section class="workspace-dashboard-lead"><span class="workspace-eyebrow">TRAINING ASSETS</span><h2>题目先成为可靠资产，再进入正式训练。</h2><p>这里管理题目、题源和考试场景，不展示不存在的考试次数、分数或掌握度。</p></section><section class="workspace-metric-grid" aria-label="训练资产统计">${renderCountLabel(overview.questions?.total, '题目')}${renderCountLabel(counts.draft, '草稿')}${renderCountLabel(counts.confirmed, '已确认')}${renderCountLabel(review.staleSources, '来源待复核')}</section><div class="workspace-dashboard-columns"><section class="workspace-dashboard-section"><header><span class="workspace-section-kicker">REVIEW STATUS</span><h3>审核状态</h3></header><div class="workspace-status-list">${renderTrainingHealthRow('draft', '待校验', review.pendingValidation)}${renderTrainingHealthRow('candidate', '待确认', review.pendingConfirmation)}${renderTrainingHealthRow('stale', '来源待复核', review.staleSources)}${renderTrainingHealthRow('insufficient', '来源不足', review.insufficientSources)}</div></section><section class="workspace-dashboard-section"><header><span class="workspace-section-kicker">RECENT QUESTIONS</span><h3>最近题目</h3></header>${overview.recentQuestions?.length ? `<div class="workspace-recent-list">${overview.recentQuestions.map(renderRecentQuestion).join('')}</div>` : '<p class="workspace-muted-copy">还没有训练题。</p>'}</section></div></div>`;
}

function renderTrainingHealthRow(status, label, count) {
  return `<div class="workspace-health-row"><span>${renderStatusBadge(status, { draft: '草稿', candidate: '候选', stale: '待复核', insufficient: '不足' })}</span><strong>${escapeHtml(String(count ?? 0))}</strong><small>${escapeHtml(label)}</small></div>`;
}

function renderRecentQuestion(question) {
  return `<button type="button" class="workspace-recent-row" data-question-select="${escapeAttribute(question.id)}"><span><strong>${escapeHtml(question.stem || '未命名题目')}</strong><small>${escapeHtml(question.updatedAt || '')}</small></span>${renderStatusBadge(question.reviewStatus, { draft: '草稿', validating: '校验中', candidate: '候选', confirmed: '已确认', archived: '已归档' })}</button>`;
}

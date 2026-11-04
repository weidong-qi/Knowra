import { escapeAttribute, escapeHtml } from '../../src/app/formatting.js';
import { renderStatusBadge, renderWorkDomainEmpty } from '../work-domains/renderers.js';

const STATUS_LABELS = { candidate: '候选', needsRevision: '需修订', stale: '待复核', invalid: '已失效', insufficient: '不足' };
const KIND_LABELS = { knowledgeItem: '知识单元', knowledgeEvidence: '知识来源', learningObjective: '学习目标', question: '题目' };

export function renderReviewQueue(entries = [], selection = {}) {
  if (!entries.length) return renderWorkDomainEmpty('审核队列为空', '当前没有候选知识、失效来源或需要复核的题目。');
  return `<section class="workspace-list-panel"><header class="workspace-list-header"><div><span class="workspace-section-kicker">REVIEW QUEUE</span><h2>审核队列</h2></div><span class="workspace-list-total">${escapeHtml(String(entries.length))} 项</span></header><div class="workspace-list" role="list">${entries.map((entry) => renderReviewRow(entry, selection.id)).join('')}</div></section>`;
}

function renderReviewRow(entry, selectedId) {
  return `<button type="button" class="workspace-list-row workspace-review-row" data-review-select-kind="${escapeAttribute(entry.kind)}" data-review-select="${escapeAttribute(entry.id)}" data-selected="${String(selectedId === entry.id)}"><span class="workspace-row-index">${escapeHtml(KIND_LABELS[entry.kind] ?? entry.kind)}</span><span class="workspace-row-main"><strong>${escapeHtml(entry.title || '未命名资产')}</strong><small>${escapeHtml(entry.summary || entry.reason || '')}</small></span><span class="workspace-row-meta">${renderStatusBadge(entry.status, STATUS_LABELS)}<small>${escapeHtml(entry.reason || '')}</small></span></button>`;
}

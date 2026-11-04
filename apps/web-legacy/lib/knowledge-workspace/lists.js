import { escapeAttribute, escapeHtml } from '../../src/app/formatting.js';
import { renderStatusBadge, renderWorkDomainEmpty } from '../work-domains/renderers.js';

const KNOWLEDGE_STATUS_LABELS = { candidate: '候选', confirmed: '已确认', needsRevision: '需修订', archived: '已归档' };
const EVIDENCE_STATUS_LABELS = { valid: '有效', stale: '待复核', invalid: '已失效', insufficient: '不足' };
const ACTION_VERB_LABELS = { identify: '识别', explain: '解释', apply: '应用', compare: '比较', analyze: '分析', calculate: '计算', design: '设计', evaluate: '评价' };
const COGNITIVE_LABELS = { remember: '记忆', understand: '理解', apply: '应用', analyze: '分析' };

export function renderKnowledgeItemsList({ items = [], filters = {}, selection = {} } = {}) {
  return `<section class="workspace-list-panel"><header class="workspace-list-header"><div><span class="workspace-section-kicker">KNOWLEDGE ITEMS</span><h2>知识单元</h2></div><button type="button" class="workspace-primary-action" data-knowledge-create>新增候选</button></header>${renderKnowledgeFilterBar(filters)}${items.length ? `<div class="workspace-list" role="list">${items.map((item) => renderKnowledgeItemRow(item, selection.id)).join('')}</div>` : renderWorkDomainEmpty('没有匹配的知识单元', '可以调整关键词或筛选条件，也可以新增一个人工候选。')}</section>`;
}

export function renderLearningObjectivesList({ objectives = [], filters = {}, selection = {} } = {}) {
  return `<section class="workspace-list-panel"><header class="workspace-list-header"><div><span class="workspace-section-kicker">LEARNING OBJECTIVES</span><h2>学习目标</h2></div></header>${renderObjectiveFilterBar(filters)}${objectives.length ? `<div class="workspace-list" role="list">${objectives.map((objective) => renderObjectiveRow(objective, selection.id)).join('')}</div>` : renderWorkDomainEmpty('没有匹配的学习目标', '学习目标会在知识单元确认后进入正式训练绑定范围。')}</section>`;
}

export function renderKnowledgeFilterBar(filters = {}) {
  return `<div class="workspace-filter-bar"><label class="workspace-search-field"><span>搜索</span><input type="search" value="${escapeAttribute(filters.query ?? '')}" placeholder="标题、陈述或解释" data-knowledge-filter-query /></label><label><span>状态</span><select data-knowledge-filter="reviewStatus">${renderFilterOptions(KNOWLEDGE_STATUS_LABELS, filters.reviewStatus)}</select></label><label><span>来源</span><select data-knowledge-filter="evidenceStatus">${renderFilterOptions(EVIDENCE_STATUS_LABELS, filters.evidenceStatus)}</select></label><label class="workspace-check-field"><input type="checkbox" data-knowledge-filter-boolean="missingObjectives"${filters.missingObjectives ? ' checked' : ''} /><span>缺少目标</span></label><label class="workspace-check-field"><input type="checkbox" data-knowledge-filter-boolean="missingQuestions"${filters.missingQuestions ? ' checked' : ''} /><span>缺少题目</span></label></div>`;
}

export function renderObjectiveFilterBar(filters = {}) {
  return `<div class="workspace-filter-bar"><label class="workspace-search-field"><span>搜索</span><input type="search" value="${escapeAttribute(filters.query ?? '')}" placeholder="目标或父知识单元" data-objective-filter-query /></label><label><span>状态</span><select data-objective-filter="reviewStatus">${renderFilterOptions(KNOWLEDGE_STATUS_LABELS, filters.reviewStatus)}</select></label><label><span>动作</span><select data-objective-filter="actionVerb">${renderFilterOptions(ACTION_VERB_LABELS, filters.actionVerb)}</select></label><label><span>认知</span><select data-objective-filter="cognitiveLevel">${renderFilterOptions(COGNITIVE_LABELS, filters.cognitiveLevel)}</select></label><label class="workspace-check-field"><input type="checkbox" data-objective-filter-boolean="hasQuestions"${filters.hasQuestions === true ? ' checked' : ''} /><span>已有题目</span></label></div>`;
}

export function renderKnowledgeItemRow(item, selectedId) {
  return `<button type="button" class="workspace-list-row" data-knowledge-select="${escapeAttribute(item.id)}" data-selected="${String(selectedId === item.id)}"><span class="workspace-row-index">${escapeHtml(String(item.objectiveCount ?? 0))}</span><span class="workspace-row-main"><strong>${escapeHtml(item.title || '未命名知识单元')}</strong><small>${escapeHtml(item.canonicalStatement || '尚未填写核心陈述')}</small></span><span class="workspace-row-meta">${renderStatusBadge(item.reviewStatus, KNOWLEDGE_STATUS_LABELS)}${renderStatusBadge(item.evidenceStatus, EVIDENCE_STATUS_LABELS)}<small>${escapeHtml(`${item.questionCount ?? 0} 题 / ${item.confirmedObjectiveCount ?? 0} 目标`)}</small></span></button>`;
}

export function renderObjectiveRow(objective, selectedId) {
  return `<button type="button" class="workspace-list-row" data-objective-select="${escapeAttribute(objective.id)}" data-selected="${String(selectedId === objective.id)}"><span class="workspace-row-index">${escapeHtml(String(objective.order ?? 0).padStart?.(2, '0') ?? '00')}</span><span class="workspace-row-main"><strong>${escapeHtml(objective.objective || '目标内容尚未填写')}</strong><small>${escapeHtml(objective.knowledgeItem?.title || '父知识单元未知')}</small></span><span class="workspace-row-meta">${renderStatusBadge(objective.reviewStatus, KNOWLEDGE_STATUS_LABELS)}<small>${escapeHtml(`${objective.questionCount ?? 0} 题`)}</small></span></button>`;
}

function renderFilterOptions(labels, selected) {
  return [`<option value="all"${!selected || selected === 'all' ? ' selected' : ''}>全部</option>`, ...Object.entries(labels).map(([value, label]) => `<option value="${escapeAttribute(value)}"${selected === value ? ' selected' : ''}>${escapeHtml(label)}</option>`)].join('');
}

import { escapeAttribute, escapeHtml } from '../../src/app/formatting.js';
import { renderStatusBadge, renderWorkDomainEmpty } from '../work-domains/renderers.js';

const QUESTION_STATUS_LABELS = { draft: '草稿', validating: '校验中', candidate: '候选', confirmed: '已确认', archived: '已归档' };
const SOURCE_STATUS_LABELS = { valid: '来源有效', stale: '来源待复核', insufficient: '来源不足' };
const QUESTION_TYPES = { singleChoice: '单选', multipleChoice: '多选', trueFalse: '判断', shortAnswer: '简答' };
const DIFFICULTIES = { easy: '容易', medium: '中等', hard: '困难' };

export function renderQuestionList({ questions = [], filters = {}, selection = {} } = {}) {
  return `<section class="workspace-list-panel"><header class="workspace-list-header"><div><span class="workspace-section-kicker">QUESTION LIBRARY</span><h2>题目库</h2></div><button type="button" class="workspace-primary-action" data-question-create>新增题目</button></header>${renderQuestionFilters(filters)}${questions.length ? `<div class="workspace-list" role="list">${questions.map((question) => renderQuestionRow(question, selection.id)).join('')}</div>` : renderWorkDomainEmpty('没有匹配的题目', '可以调整筛选条件，或从已确认的学习目标创建题目。')}</section>`;
}

export function renderProfileList({ profiles = [], selection = {} } = {}) {
  return `<section class="workspace-list-panel"><header class="workspace-list-header"><div><span class="workspace-section-kicker">EXAM CONTEXT</span><h2>考试场景</h2></div><button type="button" class="workspace-primary-action" data-profile-create>新增场景</button></header>${profiles.length ? `<div class="workspace-list" role="list">${profiles.map((profile) => renderProfileRow(profile, selection.id)).join('')}</div>` : renderWorkDomainEmpty('还没有考试场景', '考试场景是题目筛选上下文，不是正式试卷或训练记录。')}</section>`;
}

export function renderQuestionFilters(filters = {}) {
  return `<div class="workspace-filter-bar"><label class="workspace-search-field"><span>搜索</span><input type="search" value="${escapeAttribute(filters.query ?? '')}" placeholder="题干、解析或目标" data-question-filter-query /></label><label><span>题型</span><select data-question-filter="questionType">${renderOptions(QUESTION_TYPES, filters.questionType, '全部')}</select></label><label><span>状态</span><select data-question-filter="reviewStatus">${renderOptions(QUESTION_STATUS_LABELS, filters.reviewStatus, '全部')}</select></label><label><span>难度</span><select data-question-filter="difficulty">${renderOptions(DIFFICULTIES, filters.difficulty, '全部')}</select></label><label><span>来源</span><select data-question-filter="sourceStatus">${renderOptions(SOURCE_STATUS_LABELS, filters.sourceStatus, '全部')}</select></label></div>`;
}

export function renderQuestionRow(question, selectedId) {
  const objective = question.primaryObjective?.objective || '尚未绑定主目标';
  return `<button type="button" class="workspace-list-row" data-question-select="${escapeAttribute(question.id)}" data-selected="${String(selectedId === question.id)}"><span class="workspace-row-index">${escapeHtml(QUESTION_TYPES[question.questionType] ?? question.questionType)}</span><span class="workspace-row-main"><strong>${escapeHtml(question.stem || '未命名题目')}</strong><small>${escapeHtml(objective)}</small></span><span class="workspace-row-meta">${renderStatusBadge(question.reviewStatus, QUESTION_STATUS_LABELS)}${renderStatusBadge(question.sourceStatus, SOURCE_STATUS_LABELS)}<small>${escapeHtml(`v${question.version ?? 1}`)}</small></span></button>`;
}

export function renderProfileRow(profile, selectedId) {
  return `<button type="button" class="workspace-list-row" data-profile-select="${escapeAttribute(profile.id)}" data-selected="${String(selectedId === profile.id)}"><span class="workspace-row-index">${escapeHtml(String(profile.focusCount ?? 0))}</span><span class="workspace-row-main"><strong>${escapeHtml(profile.name || '未命名场景')}</strong><small>${escapeHtml(profile.description || profile.scope?.join(' · ') || '没有场景说明')}</small></span><span class="workspace-row-meta"><small>${escapeHtml(`${profile.confirmedFocusCount ?? 0} 个已确认考点`)}</small>${profile.archivedAt ? renderStatusBadge('archived', { archived: '已归档' }) : renderStatusBadge('active', { active: '使用中' })}</span></button>`;
}

function renderOptions(options, selected, blankLabel) {
  return [`<option value="all"${!selected || selected === 'all' ? ' selected' : ''}>${escapeHtml(blankLabel)}</option>`, ...Object.entries(options).map(([value, label]) => `<option value="${escapeAttribute(value)}"${selected === value ? ' selected' : ''}>${escapeHtml(label)}</option>`)].join('');
}

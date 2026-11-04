import { escapeAttribute, escapeHtml } from '../../src/app/formatting.js';
import { renderStatusBadge, renderWorkDomainEmpty } from '../work-domains/renderers.js';

const STATUS_LABELS = { candidate: '候选', confirmed: '已确认', needsRevision: '需修订', archived: '已归档' };
const EVIDENCE_LABELS = { valid: '有效', stale: '待复核', invalid: '已失效', insufficient: '不足' };
const ACTION_VERBS = ['identify', 'explain', 'apply', 'compare', 'analyze', 'calculate', 'design', 'evaluate'];
const COGNITIVE_LEVELS = ['remember', 'understand', 'apply', 'analyze'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];

export function renderKnowledgeItemInspector(item, { objectives = [], on = {} } = {}) {
  if (!item) return renderWorkDomainEmpty('选择一个知识单元', '从左侧列表选择资产，在这里查看来源、目标覆盖和状态动作。');
  const action = renderKnowledgeItemActions(item);
  return `<section class="workspace-inspector-panel" data-inspector-kind="knowledgeItem"><header class="workspace-inspector-header"><div><span class="workspace-section-kicker">KNOWLEDGE ITEM</span><h2>${escapeHtml(item.title || '未命名知识单元')}</h2></div>${renderStatusBadge(item.reviewStatus, STATUS_LABELS)}</header><div class="workspace-inspector-scroll"><label class="workspace-field"><span>标题</span><input type="text" value="${escapeAttribute(item.title ?? '')}" data-knowledge-inspector-field="title" /></label><label class="workspace-field"><span>核心陈述</span><textarea rows="4" data-knowledge-inspector-field="canonicalStatement">${escapeHtml(item.canonicalStatement ?? '')}</textarea></label><label class="workspace-field"><span>我的解释</span><textarea rows="4" data-knowledge-inspector-field="userExplanation">${escapeHtml(item.userExplanation ?? '')}</textarea></label><div class="workspace-inspector-section"><header><strong>来源健康</strong>${renderStatusBadge(item.evidenceStatus, EVIDENCE_LABELS)}</header>${renderEvidenceSummary(item.evidenceSummary ?? [], on)}</div><div class="workspace-inspector-section"><header><strong>学习目标</strong><small>${escapeHtml(`${item.confirmedObjectiveCount ?? 0}/${item.objectiveCount ?? 0} 已确认`)}</small><button type="button" data-objective-create-for="${escapeAttribute(item.id)}">新增目标</button></header>${objectives.length ? `<div class="workspace-inline-list">${objectives.map((objective) => renderObjectiveLink(objective, on)).join('')}</div>` : '<p class="workspace-muted-copy">还没有学习目标。</p>'}</div></div><footer class="workspace-inspector-actions"><button type="button" class="workspace-primary-action" data-knowledge-save="${escapeAttribute(item.id)}">保存</button>${action}</footer></section>`;
}

export function renderLearningObjectiveInspector(objective, { on = {} } = {}) {
  if (!objective) return renderWorkDomainEmpty('选择一个学习目标', '查看父知识单元、题目覆盖和审核状态。');
  const status = objective.reviewStatus;
  return `<section class="workspace-inspector-panel" data-inspector-kind="learningObjective"><header class="workspace-inspector-header"><div><span class="workspace-section-kicker">LEARNING OBJECTIVE</span><h2>${escapeHtml(objective.objective || '未命名学习目标')}</h2></div>${renderStatusBadge(status, STATUS_LABELS)}</header><div class="workspace-inspector-scroll"><div class="workspace-parent-link"><span>父知识单元</span><button type="button" data-open-knowledge-item="${escapeAttribute(objective.knowledgeItemId)}">${escapeHtml(objective.knowledgeItem?.title || '打开知识单元')}</button></div><label class="workspace-field"><span>目标描述</span><textarea rows="5" data-objective-inspector-field="objective">${escapeHtml(objective.objective ?? '')}</textarea></label><label class="workspace-field"><span>动作词</span><select data-objective-inspector-field="actionVerb">${renderEnumOptions(ACTION_VERBS, objective.actionVerb)}</select></label><label class="workspace-field"><span>认知层级</span><select data-objective-inspector-field="cognitiveLevel">${renderEnumOptions(COGNITIVE_LEVELS, objective.cognitiveLevel)}</select></label><label class="workspace-field"><span>难度提示</span><select data-objective-inspector-field="difficultyHint"><option value=""${!objective.difficultyHint ? ' selected' : ''}>未设置</option>${renderEnumOptions(DIFFICULTIES, objective.difficultyHint, false)}</select></label><div class="workspace-inspector-section"><header><strong>关联题目</strong><small>${escapeHtml(`${objective.questionCount ?? 0} 道`)}</small></header>${objective.questionIds?.length ? `<div class="workspace-inline-list">${objective.questionIds.map((id) => `<button type="button" class="workspace-inline-link" data-open-question="${escapeAttribute(id)}">${escapeHtml(id)}</button>`).join('')}</div>` : '<p class="workspace-muted-copy">还没有关联题目。</p>'}</div></div><footer class="workspace-inspector-actions"><button type="button" class="workspace-primary-action" data-objective-save="${escapeAttribute(objective.id)}">保存</button>${renderObjectiveActions(objective)}</footer></section>`;
}

function renderKnowledgeItemActions(item) {
  if (item.reviewStatus === 'archived') return `<button type="button" data-knowledge-restore="${escapeAttribute(item.id)}">恢复</button>`;
  const revision = item.reviewStatus === 'confirmed' ? `<button type="button" data-knowledge-revision="${escapeAttribute(item.id)}">标记需修订</button>` : '';
  const confirm = item.reviewStatus === 'candidate' || item.reviewStatus === 'needsRevision'
    ? `<button type="button" data-knowledge-confirm="${escapeAttribute(item.id)}">确认</button>` : '';
  return `${confirm}${revision}<button type="button" data-knowledge-archive="${escapeAttribute(item.id)}">归档</button>`;
}

function renderObjectiveActions(objective) {
  if (objective.reviewStatus === 'archived') return `<button type="button" data-objective-restore="${escapeAttribute(objective.id)}">恢复</button>`;
  const review = objective.reviewStatus === 'confirmed' ? `<button type="button" data-objective-revision="${escapeAttribute(objective.id)}">需修订</button>` : '';
  const confirm = objective.reviewStatus === 'candidate' ? `<button type="button" data-objective-confirm="${escapeAttribute(objective.id)}">确认</button>` : '';
  const question = objective.reviewStatus === 'confirmed' ? `<button type="button" data-create-question-from-objective="${escapeAttribute(objective.id)}">创建题目</button>` : '';
  return `${confirm}${review}${question}<button type="button" data-objective-archive="${escapeAttribute(objective.id)}">归档</button>`;
}

function renderEvidenceSummary(evidence, on) {
  if (!evidence.length) return '<p class="workspace-muted-copy">暂无来源记录。</p>';
  return `<div class="workspace-source-list">${evidence.slice(0, 5).map((source) => `<div class="workspace-source-row"><span>${renderStatusBadge(source.status, EVIDENCE_LABELS)}</span><div><strong>${escapeHtml(source.noteTitle || source.sourceType || '来源')}</strong><small>${escapeHtml(source.quoteText || '未提供引用文本')}</small></div>${source.noteId ? `<button type="button" data-open-note="${escapeAttribute(source.noteId)}">打开资料</button>` : ''}</div>`).join('')}</div>`;
}

function renderObjectiveLink(objective, on) {
  return `<button type="button" class="workspace-inline-link" data-open-objective="${escapeAttribute(objective.id)}"><span>${escapeHtml(objective.objective || '未命名目标')}</span>${renderStatusBadge(objective.reviewStatus, STATUS_LABELS)}</button>`;
}

function renderEnumOptions(values, selected, includeBlank = true) {
  const blank = includeBlank ? `<option value=""${!selected ? ' selected' : ''}>未设置</option>` : '';
  return `${blank}${values.map((value) => `<option value="${escapeAttribute(value)}"${selected === value ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('')}`;
}

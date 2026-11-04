import { escapeAttribute, escapeHtml } from '../../src/app/formatting.js';
import { renderStatusBadge, renderWorkDomainEmpty } from '../work-domains/renderers.js';

const STATUS_LABELS = { draft: '草稿', validating: '校验中', candidate: '候选', confirmed: '已确认', archived: '已归档' };
const SOURCE_STATUS_LABELS = { valid: '来源有效', stale: '来源待复核', insufficient: '来源不足' };
const QUESTION_TYPES = { singleChoice: '单选', multipleChoice: '多选', trueFalse: '判断', shortAnswer: '简答' };
const DIFFICULTIES = { easy: '容易', medium: '中等', hard: '困难' };
const SOURCE_TYPES = { knowledgeItem: '知识单元', learningObjective: '学习目标', noteVersion: '笔记版本', knowledgeEvidence: '知识证据', manual: '人工来源' };

export function renderQuestionInspector(question, { objectiveOptions = [] } = {}) {
  if (!question) return renderWorkDomainEmpty('选择一道题目', '查看目标绑定、题源、答案结构和审核门禁。');
  const answer = serializeField(question.referenceAnswer);
  const options = serializeField(question.options);
  const rubric = serializeField(question.rubric);
  return `<section class="workspace-inspector-panel training-question-inspector" data-inspector-kind="question"><header class="workspace-inspector-header"><div><span class="workspace-section-kicker">QUESTION ASSET</span><h2>${escapeHtml(question.stem || '未命名题目')}</h2></div><div>${renderStatusBadge(question.reviewStatus, STATUS_LABELS)}${renderStatusBadge(question.sourceStatus, SOURCE_STATUS_LABELS)}</div></header><div class="workspace-inspector-scroll"><label class="workspace-field"><span>题型</span><select data-question-inspector-field="questionType">${renderOptions(QUESTION_TYPES, question.questionType)}</select></label><label class="workspace-field"><span>难度</span><select data-question-inspector-field="difficulty"><option value=""${!question.difficulty ? ' selected' : ''}>未设置</option>${renderOptions(DIFFICULTIES, question.difficulty, false)}</select></label><label class="workspace-field"><span>题干</span><textarea rows="5" data-question-inspector-field="stem">${escapeHtml(question.stem ?? '')}</textarea></label><label class="workspace-field"><span>选项 JSON</span><textarea rows="4" data-question-inspector-field="options" placeholder="单选/多选题填写 JSON 数组">${escapeHtml(options)}</textarea></label><label class="workspace-field"><span>参考答案 JSON/文本</span><textarea rows="4" data-question-inspector-field="referenceAnswer">${escapeHtml(answer)}</textarea></label><label class="workspace-field"><span>评分量规 JSON</span><textarea rows="4" data-question-inspector-field="rubric">${escapeHtml(rubric)}</textarea></label><label class="workspace-field"><span>解析</span><textarea rows="4" data-question-inspector-field="explanation">${escapeHtml(question.explanation ?? '')}</textarea></label>${renderObjectiveBinding(question, objectiveOptions)}${renderSourceEditor(question.sources ?? [])}</div><footer class="workspace-inspector-actions"><button type="button" class="workspace-primary-action" data-question-save-workspace="${escapeAttribute(question.id)}">保存题目</button>${renderQuestionActions(question)}</footer></section>`;
}

export function renderProfileInspector(profile, { objectiveOptions = [] } = {}) {
  if (!profile) return renderWorkDomainEmpty('选择一个考试场景', '维护人工考试/训练上下文与其学习目标侧重点。');
  return `<section class="workspace-inspector-panel" data-inspector-kind="profile"><header class="workspace-inspector-header"><div><span class="workspace-section-kicker">EXAM PROFILE</span><h2>${escapeHtml(profile.name || '未命名场景')}</h2></div>${profile.archivedAt ? renderStatusBadge('archived', { archived: '已归档' }) : renderStatusBadge('active', { active: '使用中' })}</header><div class="workspace-inspector-scroll"><label class="workspace-field"><span>名称</span><input type="text" value="${escapeAttribute(profile.name ?? '')}" data-profile-field="name" /></label><label class="workspace-field"><span>说明</span><textarea rows="4" data-profile-field="description">${escapeHtml(profile.description ?? '')}</textarea></label><label class="workspace-field"><span>范围（每行一项）</span><textarea rows="3" data-profile-field="scope">${escapeHtml((profile.scope ?? []).join('\n'))}</textarea></label><div class="workspace-inspector-section"><header><strong>考试考点</strong><button type="button" data-focus-create="${escapeAttribute(profile.id)}">新增考点</button></header>${profile.focuses?.length ? `<div class="workspace-focus-list">${profile.focuses.map(renderFocusRow).join('')}</div>` : '<p class="workspace-muted-copy">还没有考点，考试场景也可以不维护考点。</p>'}</div></div><footer class="workspace-inspector-actions"><button type="button" class="workspace-primary-action" data-profile-save="${escapeAttribute(profile.id)}">保存场景</button>${profile.archivedAt ? `<button type="button" data-profile-restore="${escapeAttribute(profile.id)}">恢复</button>` : `<button type="button" data-profile-archive="${escapeAttribute(profile.id)}">归档</button>`}</footer></section>`;
}

function renderObjectiveBinding(question, objectiveOptions) {
  const selected = new Set(question.learningObjectiveIds ?? []);
  return `<section class="workspace-inspector-section"><header><strong>学习目标绑定</strong><small>可选择多个 confirmed 目标</small></header>${objectiveOptions.length ? `<div class="workspace-check-list">${objectiveOptions.map((objective) => `<label class="workspace-check-row"><input type="checkbox" value="${escapeAttribute(objective.id)}" data-question-objective-option${selected.has(objective.id) ? ' checked' : ''} /><span><strong>${escapeHtml(objective.objective || '未命名目标')}</strong><small>${escapeHtml(objective.knowledgeItem?.title || '')}</small></span></label>`).join('')}</div>` : '<p class="workspace-muted-copy">暂无可绑定目标，请先确认学习目标。</p>'}</section>`;
}

function renderSourceEditor(sources) {
  return `<section class="workspace-inspector-section"><header><strong>题目来源</strong><button type="button" data-question-source-add>新增来源</button></header><div class="workspace-source-editor-list">${sources.length ? sources.map(renderSourceRow).join('') : '<p class="workspace-muted-copy">至少添加一个来源后才能确认题目。</p>'}</div></section>`;
}

function renderSourceRow(source) {
  return `<div class="workspace-source-editor-row" data-question-source-row="${escapeAttribute(source.id)}"><div class="workspace-source-editor-grid"><label><span>类型</span><select data-question-source-field="sourceType">${renderOptions(SOURCE_TYPES, source.sourceType)}</select></label><label><span>来源 ID</span><input type="text" value="${escapeAttribute(source.sourceId ?? '')}" data-question-source-field="sourceId" /></label><label class="workspace-source-quote"><span>引用</span><textarea rows="2" data-question-source-field="quote">${escapeHtml(source.quote ?? source.quoteText ?? '')}</textarea></label></div><div class="workspace-source-editor-actions"><select data-question-source-field="status" aria-label="题目来源状态"><option value="active"${source.status === 'active' ? ' selected' : ''}>来源有效</option><option value="stale"${source.status === 'stale' ? ' selected' : ''}>来源待复核</option><option value="reanchored"${source.status === 'reanchored' ? ' selected' : ''}>来源已重锚定</option></select><button type="button" data-question-source-remove>移除</button></div></div>`;
}

function renderFocusRow(focus) {
  const action = focus.reviewStatus === 'archived'
    ? `<button type="button" data-focus-restore="${escapeAttribute(focus.id)}">恢复</button>`
    : `${focus.reviewStatus === 'candidate' ? `<button type="button" data-focus-confirm="${escapeAttribute(focus.id)}">确认</button>` : ''}<button type="button" data-focus-archive="${escapeAttribute(focus.id)}">归档</button>`;
  return `<div class="workspace-focus-row" data-focus-id="${escapeAttribute(focus.id)}"><div><strong>${escapeHtml(focus.learningObjective?.objective || '未关联目标')}</strong><small>${escapeHtml(focus.description || '没有额外说明')}</small></div><div>${renderStatusBadge(focus.reviewStatus, { candidate: '候选', confirmed: '已确认', archived: '已归档' })}${action}</div></div>`;
}

function renderQuestionActions(question) {
  if (question.reviewStatus === 'archived') return `<button type="button" data-question-restore-workspace="${escapeAttribute(question.id)}">恢复</button>`;
  const validate = ['draft', 'validating'].includes(question.reviewStatus) ? `<button type="button" data-question-validate-workspace="${escapeAttribute(question.id)}">校验</button>` : '';
  const submit = question.reviewStatus === 'candidate' ? `<button type="button" data-question-submit-workspace="${escapeAttribute(question.id)}">提交审核</button>` : '';
  const confirm = question.reviewStatus === 'candidate' ? `<button type="button" data-question-confirm-workspace="${escapeAttribute(question.id)}">确认</button>` : '';
  return `${validate}${submit}${confirm}<button type="button" data-question-archive-workspace="${escapeAttribute(question.id)}">归档</button>`;
}

function renderOptions(options, selected, includeBlank = true) {
  const blank = includeBlank ? `<option value=""${!selected ? ' selected' : ''}>未设置</option>` : '';
  return `${blank}${Object.entries(options).map(([value, label]) => `<option value="${escapeAttribute(value)}"${selected === value ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}`;
}

function serializeField(value) {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

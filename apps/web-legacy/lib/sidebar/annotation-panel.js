import { escapeAttribute, escapeHtml } from '../../src/app/formatting.js';

export function renderAnnotationPanel(annotations = [], {
  knowledgeItems = [],
  noteVersions = [],
  learningObjectives = [],
  questions = []
} = {}) {
  const items = annotations.filter((annotation) => annotation?.status !== 'archived');
  if (!items.length && !knowledgeItems.length && !noteVersions.length) {
    return '<div class="aside-empty">暂无重要内容标注</div>';
  }

  return `<section class="concepts-panel">
    <section class="annotation-panel">
      <header class="concepts-section-heading"><strong>重要内容</strong><span>${items.length} 条</span></header>
      ${items.length ? items.map(renderAnnotationCard).join('') : '<div class="aside-empty-inline">暂无重要内容标注</div>'}
    </section>
    ${renderKnowledgeContext(knowledgeItems, learningObjectives, questions)}
    ${renderNoteVersions(noteVersions)}
  </section>`;
}

function renderAnnotationCard(annotation) {
  const id = escapeAttribute(annotation?.id);
  const quoteText = escapeHtml(annotation?.quoteText);
  const statusLabel = annotation?.status === 'stale' ? '原文位置已变化' : '已标注';
  const isStale = annotation?.status === 'stale';
  return `<article class="annotation-card" data-annotation-id="${id}"><p>${quoteText}</p><small>${statusLabel}</small><div class="annotation-card-actions"><button type="button" data-annotation-jump="${id}">定位</button><button type="button" data-annotation-delete="${id}">删除</button><button type="button" data-knowledge-item-from-annotation="${id}"${isStale ? ' disabled' : ''}>生成知识候选</button></div></article>`;
}

function renderKnowledgeContext(items, objectives, questions) {
  return `<section class="knowledge-context-panel"><header class="concepts-section-heading"><strong>知识关联</strong><span>${items.length} 个知识单元</span></header>${items.length ? items.map((item) => renderKnowledgeContextCard(item, objectives, questions)).join('') : '<div class="aside-empty-inline">当前资料还没有关联知识单元</div>'}<p class="aside-context-hint">知识、目标与题目在各自工作域中编辑，右侧栏只保留当前资料的关系摘要。</p></section>`;
}

function renderKnowledgeContextCard(item, objectives, questions) {
  const id = escapeAttribute(item.id);
  const itemObjectives = objectives.filter((objective) => objective.knowledgeItemId === item.id);
  const objectiveIds = new Set(itemObjectives.map((objective) => objective.id));
  const itemQuestions = questions.filter((question) => (question.learningObjectiveIds ?? []).some((objectiveId) => objectiveIds.has(objectiveId)));
  const status = getStatusLabel(item.reviewStatus);
  const evidence = item.evidenceStatus ? ` · 来源${getEvidenceStatusLabel(item.evidenceStatus)}` : '';
  return `<article class="knowledge-context-card" data-knowledge-item-id="${id}"><header><div><strong>${escapeHtml(item.title || '未命名知识单元')}</strong><small>${escapeHtml(`${status}${evidence}`)}</small></div><button type="button" data-knowledge-item-open="${id}">在知识中打开</button></header><div class="knowledge-context-metrics"><span>${itemObjectives.length} 个目标</span><span>${itemQuestions.length} 道题</span></div>${renderContextObjectives(itemObjectives)}${renderContextQuestions(itemQuestions)}</article>`;
}

function renderContextObjectives(objectives) {
  if (!objectives.length) return '<p class="aside-empty-inline">尚未建立学习目标</p>';
  return `<div class="knowledge-context-links"><small>学习目标</small>${objectives.slice(0, 4).map((objective) => `<button type="button" data-learning-objective-open="${escapeAttribute(objective.id)}"><span>${escapeHtml(objective.objective || '未命名目标')}</span><em>${escapeHtml(getStatusLabel(objective.reviewStatus))}</em></button>`).join('')}</div>`;
}

function renderContextQuestions(questions) {
  if (!questions.length) return '<p class="aside-empty-inline">尚未关联训练题</p>';
  return `<div class="knowledge-context-links"><small>训练题</small>${questions.slice(0, 4).map((question) => `<button type="button" data-question-open="${escapeAttribute(question.id)}"><span>${escapeHtml(question.stem || '未命名题目')}</span><em>${escapeHtml(getStatusLabel(question.reviewStatus))}</em></button>`).join('')}</div>`;
}

function getStatusLabel(status) {
  return {
    candidate: '候选',
    confirmed: '已确认',
    needsRevision: '需修订',
    draft: '草稿',
    validating: '校验中',
    archived: '已归档'
  }[status] ?? status ?? '未设置';
}

function getEvidenceStatusLabel(status) {
  return { valid: '有效', stale: '待复核', invalid: '已失效', insufficient: '不足' }[status] ?? status;
}

function renderNoteVersions(versions) {
  if (!versions.length) return '';
  return `<section class="note-version-panel"><header class="concepts-section-heading"><strong>笔记版本</strong><span>${versions.length} 个</span></header><div class="note-version-list">${versions.slice(0, 5).map((version) => `<div class="note-version-row"><span>${escapeHtml(version.createdBy || 'user')}</span><code>${escapeHtml((version.contentHash || '').slice(0, 10))}</code></div>`).join('')}</div></section>`;
}

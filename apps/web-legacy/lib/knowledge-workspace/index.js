import { renderKnowledgeOverview } from './dashboard.js';
import { renderKnowledgeItemInspector, renderLearningObjectiveInspector } from './inspectors.js';
import { renderKnowledgeItemsList, renderLearningObjectivesList } from './lists.js';
import { renderReviewQueue } from './review.js';
import { renderWorkDomainShell } from '../work-domains/renderers.js';

export function renderKnowledgeWorkspace(state) {
  const workspace = state.knowledgeWorkspace;
  const view = state.navigation.activeDomainView;
  const meta = renderKnowledgeMeta(workspace);
  let body;
  if (workspace.loadState === 'loading') return renderWorkDomainShell({ domain: 'knowledge', view, meta, body: '<div class="workspace-three-pane"><div class="workspace-main-panel workspace-main-panel-full"><div class="work-domain-state work-domain-state-loading" role="status"><span class="state-marker" aria-hidden="true"></span><strong>正在加载知识工作区…</strong></div></div></div>' });
  if (workspace.loadState === 'error') return renderWorkDomainShell({ domain: 'knowledge', view, meta, body: `<div class="workspace-three-pane"><div class="workspace-main-panel workspace-main-panel-full"><div class="work-domain-state work-domain-state-error" role="alert"><strong>加载失败</strong><span>${escapeMessage(workspace.error)}</span><button type="button" class="workspace-secondary-action" data-workspace-retry>重试</button></div></div></div>` });
  switch (view) {
    case 'items':
      body = renderThreePane(
        renderKnowledgeItemsList({ items: workspace.items, filters: workspace.filters, selection: workspace.selection }),
        renderKnowledgeItemInspector(selectedItem(state), { objectives: objectivesForItem(state, selectedItem(state)), on: state })
      );
      break;
    case 'objectives':
      body = renderThreePane(
        renderLearningObjectivesList({ objectives: workspace.objectives, filters: workspace.filters, selection: workspace.selection }),
        renderLearningObjectiveInspector(selectedObjective(state), { on: state })
      );
      break;
    case 'review':
      body = renderThreePane(renderReviewQueue(workspace.reviewQueue, workspace.selection), renderReviewInspector(workspace.reviewQueue.find((entry) => entry.id === workspace.selection.id)));
      break;
    case 'overview':
    default:
      body = renderKnowledgeOverview(workspace.overview);
  }
  return renderWorkDomainShell({ domain: 'knowledge', view, meta, body });
}

function renderThreePane(list, inspector) {
  return `<div class="workspace-three-pane"><div class="workspace-main-panel">${list}</div><aside class="workspace-inspector-column">${inspector}</aside></div>`;
}

function selectedItem(state) {
  const item = state.knowledgeWorkspace.selection.kind === 'knowledgeItem'
    ? state.knowledgeWorkspace.items.find((candidate) => candidate.id === state.knowledgeWorkspace.selection.id) ?? null
    : null;
  return item ? { ...item, ...(state.knowledgeWorkspace.drafts[item.id] ?? {}) } : null;
}

function selectedObjective(state) {
  const objective = state.knowledgeWorkspace.selection.kind === 'learningObjective'
    ? state.knowledgeWorkspace.objectives.find((candidate) => candidate.id === state.knowledgeWorkspace.selection.id) ?? null
    : null;
  return objective ? { ...objective, ...(state.knowledgeWorkspace.drafts[objective.id] ?? {}) } : null;
}

function objectivesForItem(state, item) {
  return item ? state.knowledgeWorkspace.objectives.filter((objective) => objective.knowledgeItemId === item.id) : [];
}

function renderReviewInspector(entry) {
  if (!entry) return '<div class="workspace-inspector-panel"><div class="workspace-inspector-scroll"><p class="workspace-muted-copy">选择一项审核记录查看下一步动作。</p></div></div>';
  return `<section class="workspace-inspector-panel"><header class="workspace-inspector-header"><div><span class="workspace-section-kicker">REVIEW ITEM</span><h2>${escapeMessage(entry.title)}</h2></div><span class="workspace-status-badge" data-status="${escapeMessage(entry.status)}">${escapeMessage(entry.reason)}</span></header><div class="workspace-inspector-scroll"><p class="workspace-review-summary">${escapeMessage(entry.summary || '没有补充摘要')}</p><button type="button" class="workspace-primary-action" data-review-open-kind="${escapeMessage(entry.kind)}" data-review-open="${escapeMessage(entry.id)}">打开正式资产</button></div></section>`;
}

function renderKnowledgeMeta(workspace) {
  const total = workspace.overview?.knowledgeItems?.total ?? workspace.items?.length ?? 0;
  const pending = (workspace.overview?.coverage?.itemsWithoutConfirmedObjective ?? 0);
  return `<span>${escapeMessage(`${total} 个知识单元`)}</span><span>${escapeMessage(`${pending} 个目标缺口`)}</span>`;
}

function escapeMessage(value) {
  return String(value ?? '未知错误').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

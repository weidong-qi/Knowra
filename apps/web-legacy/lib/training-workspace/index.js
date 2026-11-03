import { renderTrainingOverview } from './dashboard.js';
import { renderProfileInspector, renderQuestionInspector } from './inspectors.js';
import { renderProfileList, renderQuestionList } from './lists.js';
import { renderWorkDomainShell } from '../work-domains/renderers.js';

export function renderTrainingWorkspace(state) {
  const workspace = state.trainingWorkspace;
  const view = state.navigation.activeDomainView;
  const meta = renderTrainingMeta(workspace);
  if (workspace.loadState === 'loading') return renderWorkDomainShell({ domain: 'training', view, meta, body: renderState('正在加载训练工作区…', 'loading') });
  if (workspace.loadState === 'error') return renderWorkDomainShell({ domain: 'training', view, meta, body: `<div class="workspace-three-pane"><div class="workspace-main-panel workspace-main-panel-full"><div class="work-domain-state work-domain-state-error" role="alert"><strong>加载失败</strong><span>${escapeMessage(workspace.error)}</span><button type="button" class="workspace-secondary-action" data-workspace-retry>重试</button></div></div></div>` });
  let body;
  switch (view) {
    case 'questions':
      body = renderThreePane(
        renderQuestionList({ questions: workspace.questions, filters: workspace.filters, selection: workspace.selection }),
        renderQuestionInspector(selectedQuestion(state), { objectiveOptions: workspace.objectiveOptions })
      );
      break;
    case 'editor':
      body = `<div class="workspace-editor-stage">${renderQuestionInspector(selectedQuestion(state), { objectiveOptions: workspace.objectiveOptions })}</div>`;
      break;
    case 'profiles':
      body = renderThreePane(
        renderProfileList({ profiles: workspace.profiles, selection: workspace.selection }),
        renderProfileInspector(selectedProfile(state), { objectiveOptions: workspace.objectiveOptions })
      );
      break;
    case 'overview':
    default:
      body = renderTrainingOverview(workspace.overview);
  }
  return renderWorkDomainShell({ domain: 'training', view, meta, body });
}

function renderThreePane(list, inspector) {
  return `<div class="workspace-three-pane"><div class="workspace-main-panel">${list}</div><aside class="workspace-inspector-column">${inspector}</aside></div>`;
}

function renderState(message, kind) {
  return `<div class="workspace-three-pane"><div class="workspace-main-panel workspace-main-panel-full"><div class="work-domain-state work-domain-state-${kind}" role="status"><span class="state-marker" aria-hidden="true"></span><strong>${escapeMessage(message)}</strong></div></div></div>`;
}

function selectedQuestion(state) {
  const question = state.trainingWorkspace.selection.kind === 'question'
    ? state.trainingWorkspace.questions.find((candidate) => candidate.id === state.trainingWorkspace.selection.id) ?? null
    : null;
  return question ? { ...question, ...(state.trainingWorkspace.drafts[question.id] ?? {}) } : null;
}

function selectedProfile(state) {
  const profile = state.trainingWorkspace.selection.kind === 'profile'
    ? state.trainingWorkspace.profiles.find((candidate) => candidate.id === state.trainingWorkspace.selection.id) ?? null
    : null;
  return profile ? { ...profile, ...(state.trainingWorkspace.drafts[profile.id] ?? {}) } : null;
}

function renderTrainingMeta(workspace) {
  const total = workspace.overview?.questions?.total ?? workspace.questions?.length ?? 0;
  const stale = workspace.overview?.review?.staleSources ?? 0;
  return `<span>${escapeMessage(`${total} 道题目`)}</span><span>${escapeMessage(`${stale} 个来源待复核`)}</span>`;
}

function escapeMessage(value) {
  return String(value ?? '未知错误').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

import { renderKnowledgeWorkspace } from '../../lib/knowledge-workspace/index.js';
import { renderTrainingWorkspace } from '../../lib/training-workspace/index.js';
import {
  getHomeStatusMessage,
  getWorkDomainStatusMessage
} from '../../lib/status/messages.js';

export function createWorkDomainController({
  state,
  elements,
  renderAll,
  knowledgeWorkspaceController,
  trainingWorkspaceController,
  canLeaveCurrentNote
}) {
  function render() {
    if (!elements.workDomainContent) return;
    const domain = state.navigation.activeWorkDomain;
    if (domain === 'knowledge') {
      elements.workDomainContent.innerHTML = renderKnowledgeWorkspace(state);
      return;
    }
    if (domain === 'training') {
      elements.workDomainContent.innerHTML = renderTrainingWorkspace(state);
      return;
    }
    if (domain === 'materials') {
      elements.workDomainContent.innerHTML = '';
      return;
    }
    elements.workDomainContent.innerHTML = renderLearningArchivePlaceholder();
  }

  function selectWorkDomain(domain, view = 'overview') {
    if (domain === 'materials') {
      state.statusMessage = getWorkDomainStatusMessage(domain);
      state.navigation.activeWorkDomain = 'materials';
      state.navigation.activeDomainView = 'overview';
      state.view.screen = 'index';
      renderAll();
      return true;
    }
    if (!['knowledge', 'training', 'learning'].includes(domain)) return false;
    state.statusMessage = getWorkDomainStatusMessage(domain);
    state.navigation.activeWorkDomain = domain;
    state.navigation.activeDomainView = domain === 'learning' ? 'overview' : view;
    if (domain === 'knowledge') state.knowledgeWorkspace.selection = { kind: null, id: null };
    if (domain === 'training') state.trainingWorkspace.selection = { kind: null, id: null };
    renderAll();
    if (domain === 'knowledge') void knowledgeWorkspaceController.load(state.navigation.activeDomainView);
    if (domain === 'training') void trainingWorkspaceController.load(state.navigation.activeDomainView);
    return true;
  }

  async function openHome() {
    if (typeof canLeaveCurrentNote === 'function' && !await canLeaveCurrentNote()) {
      return false;
    }
    state.statusMessage = getHomeStatusMessage();
    state.navigation.activeWorkDomain = 'materials';
    state.navigation.activeDomainView = 'overview';
    state.view.screen = 'home';
    renderAll();
    return true;
  }

  function selectView(view) {
    const domain = state.navigation.activeWorkDomain;
    if (domain === 'knowledge') {
      state.navigation.activeDomainView = view;
      state.knowledgeWorkspace.selection = { kind: null, id: null };
      renderAll();
      void knowledgeWorkspaceController.load(view);
      return true;
    }
    if (domain === 'training') {
      state.navigation.activeDomainView = view;
      state.trainingWorkspace.selection = { kind: null, id: null };
      renderAll();
      void trainingWorkspaceController.load(view);
      return true;
    }
    return false;
  }

  function openKnowledge(view = 'items', id = null) {
    state.statusMessage = getWorkDomainStatusMessage('knowledge');
    state.navigation.activeWorkDomain = 'knowledge';
    state.navigation.activeDomainView = view;
    state.knowledgeWorkspace.selection = id ? { kind: view === 'objectives' ? 'learningObjective' : 'knowledgeItem', id } : { kind: null, id: null };
    renderAll();
    void knowledgeWorkspaceController.load(view);
  }

  function openTraining(view = 'questions', id = null) {
    state.statusMessage = getWorkDomainStatusMessage('training');
    state.navigation.activeWorkDomain = 'training';
    state.navigation.activeDomainView = view;
    state.trainingWorkspace.selection = id ? { kind: view === 'profiles' ? 'profile' : 'question', id } : { kind: null, id: null };
    renderAll();
    void trainingWorkspaceController.load(view);
  }

  return {
    render,
    openHome,
    selectWorkDomain,
    selectView,
    openKnowledge,
    openTraining,
    retry: () => {
      const domain = state.navigation.activeWorkDomain;
      if (domain === 'knowledge') return knowledgeWorkspaceController.refresh();
      if (domain === 'training') return trainingWorkspaceController.refresh();
      return false;
    }
  };
}

function renderLearningArchivePlaceholder() {
  return `<div class="work-domain-shell learning-archive-placeholder" data-work-domain="learning"><header class="work-domain-header"><div class="work-domain-heading"><span class="work-domain-index">04</span><div><h1>学习档案</h1><span>LEARNING ARCHIVE</span></div></div><div class="work-domain-meta"><span>真实依赖未就绪</span></div></header><div class="workspace-placeholder-card"><span class="workspace-eyebrow">DEPENDENCY GATE</span><h2>学习档案暂不开放。</h2><p>掌握状态、薄弱知识和复习安排必须建立在 LearningEvidence 与 MasteryState 的真实数据之上。本阶段只冻结入口，不展示演示数字或前端推导的掌握度。</p><button type="button" class="workspace-secondary-action" data-work-domain-key="materials">返回资料</button></div></div>`;
}

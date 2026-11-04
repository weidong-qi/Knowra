import { guardWorkspaceWrite } from '../../lib/workspace-write-guard.js';
import { getWorkDomainStatusMessage } from '../../lib/status/messages.js';

export function createKnowledgeWorkspaceController({
  state,
  knowledgeApi,
  renderWorkDomain,
  renderAll,
  flashStatus,
  openNote,
  openTraining
}) {
  let requestSequence = 0;

  return {
    load,
    refresh: () => load(state.navigation.activeDomainView),
    setFilter,
    selectKnowledgeItem,
    selectLearningObjective,
    selectReviewEntry,
    createKnowledgeItem,
    updateKnowledgeItem,
    confirmKnowledgeItem,
    requestKnowledgeItemRevision,
    archiveKnowledgeItem,
    restoreKnowledgeItem,
    createLearningObjective,
    updateLearningObjective,
    confirmLearningObjective,
    requestLearningObjectiveRevision,
    archiveLearningObjective,
    restoreLearningObjective,
    openReviewEntry,
    openNote,
    openTraining
  };

  async function load(view = state.navigation.activeDomainView) {
    const sequence = ++requestSequence;
    state.knowledgeWorkspace.loadState = 'loading';
    state.knowledgeWorkspace.error = null;
    renderWorkDomain();
    try {
      if (view === 'overview') {
        state.knowledgeWorkspace.overview = await knowledgeApi.getKnowledgeOverview();
      } else if (view === 'items') {
        const [items, objectives] = await Promise.all([
          knowledgeApi.listWorkspaceKnowledgeItems(buildQuery(state.knowledgeWorkspace.filters)),
          knowledgeApi.listWorkspaceLearningObjectives({ limit: 100, includeArchived: true })
        ]);
        if (sequence !== requestSequence) return false;
        state.knowledgeWorkspace.items = items.items;
        state.knowledgeWorkspace.objectives = objectives.items;
        state.knowledgeWorkspace.pagination = items.pagination;
      } else if (view === 'objectives') {
        const objectives = await knowledgeApi.listWorkspaceLearningObjectives(buildQuery(state.knowledgeWorkspace.filters));
        if (sequence !== requestSequence) return false;
        state.knowledgeWorkspace.objectives = objectives.items;
        state.knowledgeWorkspace.pagination = objectives.pagination;
      } else if (view === 'review') {
        const [queue, overview] = await Promise.all([
          knowledgeApi.listReviewQueue({ limit: 100 }),
          knowledgeApi.getKnowledgeOverview()
        ]);
        if (sequence !== requestSequence) return false;
        state.knowledgeWorkspace.reviewQueue = queue.items;
        state.knowledgeWorkspace.pagination = queue.pagination;
        state.knowledgeWorkspace.overview = overview;
      }
      if (sequence !== requestSequence) return false;
      state.knowledgeWorkspace.loadState = 'loaded';
      renderWorkDomain();
      return true;
    } catch (error) {
      if (sequence !== requestSequence) return false;
      state.knowledgeWorkspace.loadState = 'error';
      state.knowledgeWorkspace.error = error.message || '知识工作区加载失败';
      renderWorkDomain();
      return false;
    }
  }

  function setFilter(name, value) {
    if (!(name in state.knowledgeWorkspace.filters)) return;
    state.knowledgeWorkspace.filters[name] = value;
    state.knowledgeWorkspace.selection = { kind: null, id: null };
    void load(state.navigation.activeDomainView);
  }

  function selectKnowledgeItem(id) {
    state.knowledgeWorkspace.selection = { kind: 'knowledgeItem', id };
    state.navigation.activeDomainView = 'items';
    renderWorkDomain();
    if (!state.knowledgeWorkspace.items.some((item) => item.id === id)) void load('items');
  }

  function selectLearningObjective(id) {
    state.knowledgeWorkspace.selection = { kind: 'learningObjective', id };
    state.navigation.activeDomainView = 'objectives';
    renderWorkDomain();
    if (!state.knowledgeWorkspace.objectives.some((objective) => objective.id === id)) void load('objectives');
  }

  function selectReviewEntry(kind, id) {
    state.knowledgeWorkspace.selection = { kind, id };
    renderWorkDomain();
    renderWorkDomain();
  }

  async function createKnowledgeItem() {
    if (!canWrite()) return false;
    try {
      const result = await knowledgeApi.createKnowledgeItem({ title: '', canonicalStatement: '', sourceMode: 'manual' });
      const item = result?.item ?? result;
      await load('items');
      state.knowledgeWorkspace.selection = { kind: 'knowledgeItem', id: item.id };
      renderWorkDomain();
      flashStatus('已新增知识单元候选，请在右侧填写内容');
      return item;
    } catch (error) {
      flashStatus(error.message || '新增知识单元失败');
      return false;
    }
  }

  async function updateKnowledgeItem(id, input) {
    state.knowledgeWorkspace.drafts[id] = input;
    return mutate(id, () => knowledgeApi.updateKnowledgeItem(id, input), '知识单元已保存', 'knowledgeItem');
  }

  async function confirmKnowledgeItem(id) {
    return mutate(id, () => knowledgeApi.confirmKnowledgeItem(id), '知识单元已确认', 'knowledgeItem');
  }

  async function requestKnowledgeItemRevision(id) {
    return mutate(id, () => knowledgeApi.markKnowledgeItemNeedsRevision(id), '知识单元已标记为需修订', 'knowledgeItem');
  }

  async function archiveKnowledgeItem(id) {
    return mutate(id, () => knowledgeApi.archiveKnowledgeItem(id), '知识单元已归档', 'knowledgeItem');
  }

  async function restoreKnowledgeItem(id) {
    return mutate(id, () => knowledgeApi.restoreKnowledgeItem(id), '知识单元已恢复为候选', 'knowledgeItem');
  }

  async function createLearningObjective(knowledgeItemId) {
    if (!canWrite()) return false;
    const item = state.knowledgeWorkspace.items.find((candidate) => candidate.id === knowledgeItemId);
    if (!item) return false;
    try {
      const objective = await knowledgeApi.createLearningObjective({
        knowledgeItemId,
        objective: '',
        actionVerb: 'explain',
        cognitiveLevel: 'understand',
        order: item.objectiveCount ?? 0
      });
      await load('items');
      state.knowledgeWorkspace.selection = { kind: 'knowledgeItem', id: knowledgeItemId };
      renderWorkDomain();
      flashStatus('已新增学习目标候选，请补充可评测描述');
      return objective;
    } catch (error) {
      flashStatus(error.message || '新增学习目标失败');
      return false;
    }
  }

  async function updateLearningObjective(id, input) {
    state.knowledgeWorkspace.drafts[id] = input;
    return mutate(id, () => knowledgeApi.updateLearningObjective(id, input), '学习目标已保存', 'learningObjective');
  }

  async function confirmLearningObjective(id) {
    return mutate(id, () => knowledgeApi.confirmLearningObjective(id), '学习目标已确认', 'learningObjective');
  }

  async function requestLearningObjectiveRevision(id, reviewNote = '需要人工修订') {
    return mutate(id, () => knowledgeApi.requestLearningObjectiveRevision(id, { reviewNote }), '学习目标已标记为需修订', 'learningObjective');
  }

  async function archiveLearningObjective(id) {
    return mutate(id, () => knowledgeApi.archiveLearningObjective(id), '学习目标已归档', 'learningObjective');
  }

  async function restoreLearningObjective(id) {
    return mutate(id, () => knowledgeApi.restoreLearningObjective(id), '学习目标已恢复为候选', 'learningObjective');
  }

  async function mutate(id, operation, message, kind) {
    if (!canWrite()) return false;
    try {
      const result = await operation();
      delete state.knowledgeWorkspace.drafts[id];
      await load(state.navigation.activeDomainView);
      state.knowledgeWorkspace.selection = { kind, id };
      renderWorkDomain();
      flashStatus(message);
      return result;
    } catch (error) {
      renderWorkDomain();
      flashStatus(error.message || '知识资产操作失败');
      return false;
    }
  }

  function openReviewEntry(kind, id) {
    if (kind === 'question') return openTraining?.('questions', id);
    state.statusMessage = getWorkDomainStatusMessage('knowledge');
    state.navigation.activeWorkDomain = 'knowledge';
    state.navigation.activeDomainView = kind === 'learningObjective' ? 'objectives' : 'items';
    state.knowledgeWorkspace.selection = { kind, id };
    renderAll();
    void load(state.navigation.activeDomainView);
    return true;
  }

  function canWrite() {
    return guardWorkspaceWrite({ dataMode: state.dataMode, flashStatus });
  }
}

function buildQuery(filters) {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== 'all' && value !== false && value !== ''));
}

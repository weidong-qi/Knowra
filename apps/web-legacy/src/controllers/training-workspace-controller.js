import { guardWorkspaceWrite } from '../../lib/workspace-write-guard.js';
import { createTrainingProfileController } from './training-profile-controller.js';

export function createTrainingWorkspaceController({
  state,
  knowledgeApi,
  renderWorkDomain,
  renderAll,
  flashStatus,
  openKnowledge
}) {
  let requestSequence = 0;
  const profileController = createTrainingProfileController({
    state,
    knowledgeApi,
    renderWorkDomain,
    flashStatus,
    loadProfiles: () => load('profiles')
  });

  return {
    load,
    refresh: () => load(state.navigation.activeDomainView),
    setFilter,
    selectQuestion,
    selectProfile,
    createQuestion,
    updateQuestion,
    addQuestionSource,
    removeQuestionSource,
    validateQuestion,
    submitQuestion,
    confirmQuestion,
    archiveQuestion,
    restoreQuestion,
    ...profileController,
    openKnowledge
  };

  async function load(view = state.navigation.activeDomainView) {
    const sequence = ++requestSequence;
    state.trainingWorkspace.loadState = 'loading';
    state.trainingWorkspace.error = null;
    renderWorkDomain();
    try {
      if (view === 'overview') {
        state.trainingWorkspace.overview = await knowledgeApi.getTrainingOverview();
      } else if (view === 'questions' || view === 'editor') {
        const [questions, objectives] = await Promise.all([
          knowledgeApi.listWorkspaceQuestions(buildQuestionQuery(state.trainingWorkspace.filters)),
          knowledgeApi.listWorkspaceLearningObjectives({ reviewStatus: 'confirmed', limit: 100 })
        ]);
        if (sequence !== requestSequence) return false;
        state.trainingWorkspace.questions = questions.items;
        state.trainingWorkspace.objectiveOptions = objectives.items;
        state.trainingWorkspace.pagination = questions.pagination;
      } else if (view === 'profiles') {
        const [profiles, objectives] = await Promise.all([
          knowledgeApi.listWorkspaceExamProfiles({ limit: 100 }),
          knowledgeApi.listWorkspaceLearningObjectives({ reviewStatus: 'confirmed', limit: 100 })
        ]);
        if (sequence !== requestSequence) return false;
        state.trainingWorkspace.profiles = profiles.items;
        state.trainingWorkspace.objectiveOptions = objectives.items;
        state.trainingWorkspace.pagination = profiles.pagination;
      }
      if (sequence !== requestSequence) return false;
      state.trainingWorkspace.loadState = 'loaded';
      renderWorkDomain();
      return true;
    } catch (error) {
      if (sequence !== requestSequence) return false;
      state.trainingWorkspace.loadState = 'error';
      state.trainingWorkspace.error = error.message || '训练工作区加载失败';
      renderWorkDomain();
      return false;
    }
  }

  function setFilter(name, value) {
    if (!(name in state.trainingWorkspace.filters)) return;
    state.trainingWorkspace.filters[name] = value;
    state.trainingWorkspace.selection = { kind: null, id: null };
    void load(state.navigation.activeDomainView);
  }

  function selectQuestion(id) {
    state.trainingWorkspace.selection = { kind: 'question', id };
    state.navigation.activeDomainView = 'questions';
    renderWorkDomain();
    if (!state.trainingWorkspace.questions.some((question) => question.id === id)) void load('questions');
  }

  function selectProfile(id) {
    state.trainingWorkspace.selection = { kind: 'profile', id };
    state.navigation.activeDomainView = 'profiles';
    renderWorkDomain();
    if (!state.trainingWorkspace.profiles.some((profile) => profile.id === id)) void load('profiles');
  }

  async function createQuestion(learningObjectiveId = null) {
    if (!canWrite()) return false;
    const objective = learningObjectiveId
      ? state.trainingWorkspace.objectiveOptions.find((item) => item.id === learningObjectiveId)
      : null;
    try {
      const question = await knowledgeApi.createQuestion({
        questionType: 'shortAnswer',
        stem: objective ? `请说明：${objective.objective}` : '',
        referenceAnswer: '',
        learningObjectiveIds: objective ? [objective.id] : [],
        sources: objective ? [{ sourceType: 'learningObjective', sourceId: objective.id, quote: objective.objective }] : []
      });
      await load('questions');
      state.trainingWorkspace.selection = { kind: 'question', id: question.id };
      state.navigation.activeDomainView = 'editor';
      renderAll();
      flashStatus('已新增题目草稿，请完善目标、答案和来源');
      return question;
    } catch (error) {
      flashStatus(error.message || '新增题目失败');
      return false;
    }
  }

  async function updateQuestion(id, input) {
    if (!canWrite()) return false;
    state.trainingWorkspace.drafts[id] = input;
    try {
      const question = await knowledgeApi.updateQuestion(id, input);
      delete state.trainingWorkspace.drafts[id];
      await load('questions');
      state.trainingWorkspace.selection = { kind: 'question', id };
      state.navigation.activeDomainView = 'editor';
      renderAll();
      flashStatus('题目已保存');
      return question;
    } catch (error) {
      renderWorkDomain();
      flashStatus(error.message || '保存题目失败，草稿已保留');
      return false;
    }
  }

  function addQuestionSource(id) {
    const question = selectedQuestion(state, id);
    if (!question) return;
    const draft = { ...question, ...(state.trainingWorkspace.drafts[id] ?? {}) };
    state.trainingWorkspace.drafts[id] = {
      ...draft,
      sources: [...(draft.sources ?? []), { id: createDraftId(), sourceType: 'manual', sourceId: '', quote: '', status: 'active' }]
    };
    renderWorkDomain();
  }

  function removeQuestionSource(id, sourceId) {
    const question = selectedQuestion(state, id);
    if (!question) return;
    const draft = { ...question, ...(state.trainingWorkspace.drafts[id] ?? {}) };
    state.trainingWorkspace.drafts[id] = { ...draft, sources: (draft.sources ?? []).filter((source) => source.id !== sourceId) };
    renderWorkDomain();
  }

  async function validateQuestion(id) {
    return mutateQuestion(id, () => knowledgeApi.validateQuestion(id), '题目已通过结构校验');
  }

  async function submitQuestion(id) {
    return mutateQuestion(id, () => knowledgeApi.submitQuestionForReview(id), '题目已提交审核');
  }

  async function confirmQuestion(id) {
    return mutateQuestion(id, () => knowledgeApi.confirmQuestion(id), '题目已确认');
  }

  async function archiveQuestion(id) {
    return mutateQuestion(id, () => knowledgeApi.archiveQuestion(id), '题目已归档');
  }

  async function restoreQuestion(id) {
    return mutateQuestion(id, () => knowledgeApi.restoreQuestion(id), '题目已恢复为草稿');
  }

  async function mutateQuestion(id, operation, message) {
    if (!canWrite()) return false;
    try {
      const result = await operation();
      delete state.trainingWorkspace.drafts[id];
      await load('questions');
      state.trainingWorkspace.selection = { kind: 'question', id };
      state.navigation.activeDomainView = 'editor';
      renderAll();
      flashStatus(message);
      return result;
    } catch (error) {
      flashStatus(error.message || '题目操作失败');
      return false;
    }
  }

  function canWrite() {
    return guardWorkspaceWrite({ dataMode: state.dataMode, flashStatus });
  }
}

function selectedQuestion(state, id) {
  return state.trainingWorkspace.questions.find((question) => question.id === id) ?? null;
}

function buildQuestionQuery(filters) {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== 'all' && value !== false && value !== ''));
}

function createDraftId() {
  return `draft-source-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
}

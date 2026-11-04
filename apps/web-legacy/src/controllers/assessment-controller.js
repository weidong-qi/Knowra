import { guardWorkspaceWrite } from '../../lib/workspace-write-guard.js';

export function createAssessmentController({
  state,
  knowledgeApi,
  getCurrentNote,
  renderSidebar,
  flashStatus
}) {
  function canWrite() {
    return guardWorkspaceWrite({ dataMode: state.dataMode, flashStatus });
  }

  async function createLearningObjective(knowledgeItemId) {
    if (!canWrite()) return false;
    const item = state.knowledgeItems.find((candidate) => candidate.id === knowledgeItemId);
    if (!item) return false;
    try {
      const objective = await knowledgeApi.createLearningObjective({
        knowledgeItemId,
        objective: `能够解释：${item.title}`,
        actionVerb: 'explain',
        cognitiveLevel: 'understand',
        order: state.learningObjectives.filter((candidate) => candidate.knowledgeItemId === knowledgeItemId).length
      });
      state.learningObjectives = [objective, ...state.learningObjectives];
      renderSidebar(getCurrentNote());
      flashStatus('已新增学习目标候选');
      return objective;
    } catch (error) {
      flashStatus(error.message || '新增学习目标失败');
      return false;
    }
  }

  async function updateLearningObjective(id, input) {
    return mutateLearningObjective(id, () => knowledgeApi.updateLearningObjective(id, input), '学习目标已保存');
  }

  async function confirmLearningObjective(id) {
    return mutateLearningObjective(id, () => knowledgeApi.confirmLearningObjective(id), '学习目标已确认');
  }

  async function archiveLearningObjective(id) {
    return mutateLearningObjective(id, () => knowledgeApi.archiveLearningObjective(id), '学习目标已归档');
  }

  async function restoreLearningObjective(id) {
    return mutateLearningObjective(id, () => knowledgeApi.restoreLearningObjective(id), '学习目标已恢复为候选');
  }

  async function mutateLearningObjective(id, operation, successMessage) {
    if (!canWrite()) return false;
    try {
      const objective = await operation();
      state.learningObjectives = replaceById(state.learningObjectives, objective);
      renderSidebar(getCurrentNote());
      flashStatus(successMessage);
      return objective;
    } catch (error) {
      flashStatus(error.message || '学习目标操作失败');
      return false;
    }
  }

  async function createQuestion(learningObjectiveId) {
    if (!canWrite()) return false;
    const objective = state.learningObjectives.find((candidate) => candidate.id === learningObjectiveId);
    if (!objective) return false;
    try {
      const question = await knowledgeApi.createQuestion({
        questionType: 'shortAnswer',
        stem: `请说明：${objective.objective}`,
        referenceAnswer: '',
        learningObjectiveIds: [learningObjectiveId],
        sources: [{ sourceType: 'learningObjective', sourceId: learningObjectiveId, quote: objective.objective }]
      });
      state.questions = [question, ...state.questions];
      renderSidebar(getCurrentNote());
      flashStatus('已生成基础训练题草稿');
      return question;
    } catch (error) {
      flashStatus(error.message || '生成训练题失败');
      return false;
    }
  }

  async function updateQuestion(id, input) {
    if (!canWrite()) return false;
    try {
      const question = await knowledgeApi.updateQuestion(id, input);
      state.questions = replaceById(state.questions, question);
      renderSidebar(getCurrentNote());
      flashStatus('训练题已保存');
      return question;
    } catch (error) {
      flashStatus(error.message || '保存训练题失败');
      return false;
    }
  }

  async function mutateQuestion(id, operation, successMessage) {
    if (!canWrite()) return false;
    try {
      const question = await operation();
      state.questions = replaceById(state.questions, question);
      renderSidebar(getCurrentNote());
      flashStatus(successMessage);
      return question;
    } catch (error) {
      flashStatus(error.message || '训练题操作失败');
      return false;
    }
  }

  return {
    createLearningObjective,
    updateLearningObjective,
    confirmLearningObjective,
    archiveLearningObjective,
    restoreLearningObjective,
    createQuestion,
    updateQuestion,
    validateQuestion: (id) => mutateQuestion(id, () => knowledgeApi.validateQuestion(id), '训练题已通过结构校验'),
    confirmQuestion: (id) => mutateQuestion(id, () => knowledgeApi.confirmQuestion(id), '训练题已确认'),
    archiveQuestion: (id) => mutateQuestion(id, () => knowledgeApi.archiveQuestion(id), '训练题已归档'),
    restoreQuestion: (id) => mutateQuestion(id, () => knowledgeApi.restoreQuestion(id), '训练题已恢复为草稿')
  };
}

function replaceById(items, next) {
  return items.map((item) => item.id === next?.id ? { ...item, ...next } : item);
}

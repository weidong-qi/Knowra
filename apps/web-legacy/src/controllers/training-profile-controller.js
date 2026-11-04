import { guardWorkspaceWrite } from '../../lib/workspace-write-guard.js';

export function createTrainingProfileController({
  state,
  knowledgeApi,
  renderWorkDomain,
  flashStatus,
  loadProfiles
}) {
  return {
    createProfile,
    updateProfile,
    archiveProfile,
    restoreProfile,
    createFocus,
    confirmFocus,
    archiveFocus,
    restoreFocus
  };

  async function createProfile() {
    if (!canWrite()) return false;
    try {
      const profile = await knowledgeApi.createExamProfile({ name: '新考试场景', description: '', scope: [], commonQuestionTypes: [], difficultyProfile: {} });
      await loadProfiles();
      state.trainingWorkspace.selection = { kind: 'profile', id: profile.id };
      renderWorkDomain();
      flashStatus('已新增考试场景');
      return profile;
    } catch (error) {
      flashStatus(error.message || '新增考试场景失败');
      return false;
    }
  }

  async function updateProfile(id, input) {
    if (!canWrite()) return false;
    state.trainingWorkspace.drafts[id] = input;
    try {
      const profile = await knowledgeApi.updateExamProfile(id, input);
      delete state.trainingWorkspace.drafts[id];
      await loadProfiles();
      state.trainingWorkspace.selection = { kind: 'profile', id };
      renderWorkDomain();
      flashStatus('考试场景已保存');
      return profile;
    } catch (error) {
      renderWorkDomain();
      flashStatus(error.message || '保存考试场景失败，草稿已保留');
      return false;
    }
  }

  async function archiveProfile(id) { return mutateProfile(id, () => knowledgeApi.archiveExamProfile(id), '考试场景已归档'); }
  async function restoreProfile(id) { return mutateProfile(id, () => knowledgeApi.restoreExamProfile(id), '考试场景已恢复'); }

  async function mutateProfile(id, operation, message) {
    if (!canWrite()) return false;
    try {
      const result = await operation();
      await loadProfiles();
      state.trainingWorkspace.selection = { kind: 'profile', id };
      renderWorkDomain();
      flashStatus(message);
      return result;
    } catch (error) {
      flashStatus(error.message || '考试场景操作失败');
      return false;
    }
  }

  async function createFocus(profileId, learningObjectiveId = null) {
    if (!canWrite()) return false;
    const objective = state.trainingWorkspace.objectiveOptions.find((item) => item.id === learningObjectiveId) ?? state.trainingWorkspace.objectiveOptions[0];
    if (!objective) {
      flashStatus('请先确认至少一个学习目标');
      return false;
    }
    try {
      const focus = await knowledgeApi.createExamFocus(profileId, { learningObjectiveId: objective.id, description: '', priority: 1, sourceType: 'manual' });
      await loadProfiles();
      state.trainingWorkspace.selection = { kind: 'profile', id: profileId };
      renderWorkDomain();
      flashStatus('已新增考试考点候选');
      return focus;
    } catch (error) {
      flashStatus(error.message || '新增考试考点失败');
      return false;
    }
  }

  async function confirmFocus(id) { return mutateFocus(id, () => knowledgeApi.confirmExamFocus(id), '考试考点已确认'); }
  async function archiveFocus(id) { return mutateFocus(id, () => knowledgeApi.archiveExamFocus(id), '考试考点已归档'); }
  async function restoreFocus(id) { return mutateFocus(id, () => knowledgeApi.restoreExamFocus(id), '考试考点已恢复'); }

  async function mutateFocus(id, operation, message) {
    if (!canWrite()) return false;
    try {
      const result = await operation();
      await loadProfiles();
      renderWorkDomain();
      flashStatus(message);
      return result;
    } catch (error) {
      flashStatus(error.message || '考试考点操作失败');
      return false;
    }
  }

  function canWrite() {
    return guardWorkspaceWrite({ dataMode: state.dataMode, flashStatus });
  }
}

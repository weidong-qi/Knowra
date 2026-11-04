import { asArray, getData } from '../api-response.js';

function queryString(query = {}) {
  const entries = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return entries.length ? `?${entries.join('&')}` : '';
}

function getCollection(payload) {
  const data = payload?.data;
  if (data && !Array.isArray(data) && Array.isArray(data.items)) return data;
  return { items: asArray(data), pagination: null };
}

export function createKnowledgeDomainApi({ requestJson }) {
  return {
    async listNoteVersions(noteId, query = {}) {
      const payload = await requestJson(
        `/api/knowledge/notes/${encodeURIComponent(noteId)}/versions${queryString(query)}`
      );
      return asArray(payload.data);
    },
    async listKnowledgeItems(query = {}) {
      const payload = await requestJson(`/api/knowledge/items${queryString(query)}`);
      return asArray(payload.data);
    },
    async createKnowledgeItem(input) {
      return getData(await requestJson('/api/knowledge/items', {
        method: 'POST',
        body: JSON.stringify(input)
      }));
    },
    async confirmKnowledgeItem(id) {
      return getData(await requestJson(
        `/api/knowledge/items/${encodeURIComponent(id)}/confirm`,
        { method: 'POST' }
      ));
    },
    async updateKnowledgeItem(id, input) {
      return getData(await requestJson(`/api/knowledge/items/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(input)
      }));
    },
    async archiveKnowledgeItem(id) {
      return getData(await requestJson(
        `/api/knowledge/items/${encodeURIComponent(id)}/archive`,
        { method: 'POST' }
      ));
    },
    async restoreKnowledgeItem(id) {
      return getData(await requestJson(
        `/api/knowledge/items/${encodeURIComponent(id)}/restore`,
        { method: 'POST' }
      ));
    },
    async markKnowledgeItemNeedsRevision(id) {
      return getData(await requestJson(
        `/api/knowledge/items/${encodeURIComponent(id)}/needs-revision`,
        { method: 'POST' }
      ));
    },
    async getKnowledgeOverview() {
      return getData(await requestJson('/api/knowledge/overview'));
    },
    async listWorkspaceKnowledgeItems(query = {}) {
      return getCollection(await requestJson(`/api/knowledge/items${queryString({ ...query, view: 'workspace' })}`));
    },
    async listWorkspaceLearningObjectives(query = {}) {
      return getCollection(await requestJson(`/api/knowledge/learning-objectives${queryString({ ...query, view: 'workspace' })}`));
    },
    async listReviewQueue(query = {}) {
      return getCollection(await requestJson(`/api/knowledge/review-queue${queryString(query)}`));
    },
    async listLearningObjectives(query = {}) {
      const payload = await requestJson(`/api/knowledge/learning-objectives${queryString(query)}`);
      return asArray(payload.data);
    },
    async createLearningObjective(input) {
      return getData(await requestJson('/api/knowledge/learning-objectives', {
        method: 'POST',
        body: JSON.stringify(input)
      }));
    },
    async updateLearningObjective(id, input) {
      return getData(await requestJson(`/api/knowledge/learning-objectives/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(input)
      }));
    },
    async confirmLearningObjective(id) {
      return getData(await requestJson(`/api/knowledge/learning-objectives/${encodeURIComponent(id)}/confirm`, { method: 'POST' }));
    },
    async requestLearningObjectiveRevision(id, input = {}) {
      return getData(await requestJson(`/api/knowledge/learning-objectives/${encodeURIComponent(id)}/request-revision`, {
        method: 'POST',
        body: JSON.stringify(input)
      }));
    },
    async archiveLearningObjective(id) {
      return getData(await requestJson(`/api/knowledge/learning-objectives/${encodeURIComponent(id)}/archive`, { method: 'POST' }));
    },
    async restoreLearningObjective(id) {
      return getData(await requestJson(`/api/knowledge/learning-objectives/${encodeURIComponent(id)}/restore`, { method: 'POST' }));
    },
    async listQuestions(query = {}) {
      const payload = await requestJson(`/api/knowledge/questions${queryString(query)}`);
      return asArray(payload.data);
    },
    async createQuestion(input) {
      return getData(await requestJson('/api/knowledge/questions', {
        method: 'POST',
        body: JSON.stringify(input)
      }));
    },
    async updateQuestion(id, input) {
      return getData(await requestJson(`/api/knowledge/questions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(input)
      }));
    },
    async validateQuestion(id) {
      return getData(await requestJson(`/api/knowledge/questions/${encodeURIComponent(id)}/validate`, { method: 'POST' }));
    },
    async confirmQuestion(id) {
      return getData(await requestJson(`/api/knowledge/questions/${encodeURIComponent(id)}/confirm`, { method: 'POST' }));
    },
    async archiveQuestion(id) {
      return getData(await requestJson(`/api/knowledge/questions/${encodeURIComponent(id)}/archive`, { method: 'POST' }));
    },
    async restoreQuestion(id) {
      return getData(await requestJson(`/api/knowledge/questions/${encodeURIComponent(id)}/restore`, { method: 'POST' }));
    },
    async submitQuestionForReview(id) {
      return getData(await requestJson(`/api/knowledge/questions/${encodeURIComponent(id)}/submit-review`, { method: 'POST' }));
    },
    async getTrainingOverview() {
      return getData(await requestJson('/api/knowledge/training-overview'));
    },
    async listWorkspaceQuestions(query = {}) {
      return getCollection(await requestJson(`/api/knowledge/questions${queryString({ ...query, view: 'workspace' })}`));
    },
    async listWorkspaceExamProfiles(query = {}) {
      return getCollection(await requestJson(`/api/knowledge/exam-profiles${queryString({ ...query, view: 'workspace' })}`));
    },
    async listExamProfiles(query = {}) {
      return asArray((await requestJson(`/api/knowledge/exam-profiles${queryString(query)}`)).data);
    },
    async createExamProfile(input) {
      return getData(await requestJson('/api/knowledge/exam-profiles', { method: 'POST', body: JSON.stringify(input) }));
    },
    async updateExamProfile(id, input) {
      return getData(await requestJson(`/api/knowledge/exam-profiles/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }));
    },
    async archiveExamProfile(id) {
      return getData(await requestJson(`/api/knowledge/exam-profiles/${encodeURIComponent(id)}/archive`, { method: 'POST' }));
    },
    async restoreExamProfile(id) {
      return getData(await requestJson(`/api/knowledge/exam-profiles/${encodeURIComponent(id)}/restore`, { method: 'POST' }));
    },
    async listExamFocuses(examProfileId, query = {}) {
      return asArray((await requestJson(`/api/knowledge/exam-profiles/${encodeURIComponent(examProfileId)}/focuses${queryString(query)}`)).data);
    },
    async createExamFocus(examProfileId, input) {
      return getData(await requestJson(`/api/knowledge/exam-profiles/${encodeURIComponent(examProfileId)}/focuses`, { method: 'POST', body: JSON.stringify(input) }));
    },
    async updateExamFocus(id, input) {
      return getData(await requestJson(`/api/knowledge/exam-focuses/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }));
    },
    async confirmExamFocus(id) {
      return getData(await requestJson(`/api/knowledge/exam-focuses/${encodeURIComponent(id)}/confirm`, { method: 'POST' }));
    },
    async archiveExamFocus(id) {
      return getData(await requestJson(`/api/knowledge/exam-focuses/${encodeURIComponent(id)}/archive`, { method: 'POST' }));
    },
    async restoreExamFocus(id) {
      return getData(await requestJson(`/api/knowledge/exam-focuses/${encodeURIComponent(id)}/restore`, { method: 'POST' }));
    }
  };
}

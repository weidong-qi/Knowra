import assert from 'node:assert/strict';
import { createInitialAppState } from '../src/app/app-state.js';
import { createKnowledgeDomainApi } from '../src/services/knowledge-api/knowledge-domain-service.js';
import { renderKnowledgeWorkspace } from '../lib/knowledge-workspace/index.js';
import { renderTrainingWorkspace } from '../lib/training-workspace/index.js';
import { renderAnnotationPanel } from '../lib/sidebar/annotation-panel.js';

const state = createInitialAppState();
state.navigation.activeDomainView = 'items';
state.knowledgeWorkspace.loadState = 'loaded';
state.knowledgeWorkspace.items = [{
  id: 'item-1',
  title: '导数',
  canonicalStatement: '导数描述变化率',
  reviewStatus: 'confirmed',
  evidenceStatus: 'valid',
  evidenceSummary: [],
  objectiveCount: 1,
  confirmedObjectiveCount: 1,
  questionCount: 1
}];
state.knowledgeWorkspace.objectives = [{
  id: 'objective-1',
  knowledgeItemId: 'item-1',
  objective: '能够解释导数的几何意义',
  actionVerb: 'explain',
  cognitiveLevel: 'understand',
  reviewStatus: 'confirmed',
  questionCount: 1,
  questionIds: ['question-1'],
  knowledgeItem: { id: 'item-1', title: '导数', reviewStatus: 'confirmed', evidenceStatus: 'valid' }
}];
state.knowledgeWorkspace.selection = { kind: 'knowledgeItem', id: 'item-1' };

const knowledgeMarkup = renderKnowledgeWorkspace(state);
assert.match(knowledgeMarkup, /data-work-domain="knowledge"/);
assert.match(knowledgeMarkup, /data-knowledge-select="item-1"/);
assert.match(knowledgeMarkup, /data-knowledge-save="item-1"/);
assert.match(knowledgeMarkup, /data-objective-create-for="item-1"/);

state.navigation.activeDomainView = 'questions';
state.trainingWorkspace.loadState = 'loaded';
state.trainingWorkspace.questions = [{
  id: 'question-1',
  questionType: 'shortAnswer',
  stem: '请解释导数的几何意义。',
  referenceAnswer: '切线斜率',
  options: null,
  rubric: null,
  explanation: '看切线斜率。',
  difficulty: 'medium',
  reviewStatus: 'candidate',
  sourceStatus: 'valid',
  learningObjectiveIds: ['objective-1'],
  objectives: [],
  sources: [{ id: 'source-1', sourceType: 'learningObjective', sourceId: 'objective-1', quote: '目标', status: 'active' }]
}];
state.trainingWorkspace.objectiveOptions = state.knowledgeWorkspace.objectives;
state.trainingWorkspace.selection = { kind: 'question', id: 'question-1' };

const trainingMarkup = renderTrainingWorkspace(state);
assert.match(trainingMarkup, /data-work-domain="training"/);
assert.match(trainingMarkup, /data-question-select="question-1"/);
assert.match(trainingMarkup, /data-question-save-workspace="question-1"/);
assert.match(trainingMarkup, /data-question-objective-option/);
assert.match(trainingMarkup, /data-question-source-row="source-1"/);

const asideMarkup = renderAnnotationPanel([], {
  knowledgeItems: state.knowledgeWorkspace.items,
  learningObjectives: state.knowledgeWorkspace.objectives,
  questions: state.trainingWorkspace.questions
});
assert.match(asideMarkup, /data-knowledge-item-open="item-1"/);
assert.match(asideMarkup, /data-learning-objective-open="objective-1"/);
assert.match(asideMarkup, /data-question-open="question-1"/);
assert.doesNotMatch(asideMarkup, /data-knowledge-item-save|data-objective-save|data-question-save/);

const calls = [];
const api = createKnowledgeDomainApi({
  async requestJson(url) {
    calls.push(url);
    return { data: { items: [], pagination: null } };
  }
});
await api.getKnowledgeOverview();
await api.listWorkspaceKnowledgeItems({ query: '导数', missingQuestions: true });
await api.listWorkspaceQuestions({ learningObjectiveId: 'objective-1' });
assert.equal(calls[0], '/api/knowledge/overview');
assert.match(calls[1], /items\?query=%E5%AF%BC%E6%95%B0&missingQuestions=true&view=workspace/);
assert.match(calls[2], /questions\?learningObjectiveId=objective-1&view=workspace/);

console.log('ok - Phase3.1 workspaces keep domain links, editors and contextual sidebar boundaries');

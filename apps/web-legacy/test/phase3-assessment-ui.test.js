import assert from 'node:assert/strict';
import { renderAnnotationPanel } from '../lib/sidebar/annotation-panel.js';
import { createKnowledgeDomainApi } from '../src/services/knowledge-api/knowledge-domain-service.js';

const markup = renderAnnotationPanel([], {
  knowledgeItems: [{ id: 'item-1', title: '函数', canonicalStatement: '函数描述对应关系', reviewStatus: 'confirmed' }],
  learningObjectives: [{ id: 'objective-1', knowledgeItemId: 'item-1', objective: '<能解释>', actionVerb: 'explain', cognitiveLevel: 'understand', reviewStatus: 'confirmed' }],
  questions: [{ id: 'question-1', learningObjectiveIds: ['objective-1'], stem: '题干', referenceAnswer: '答案', reviewStatus: 'draft' }]
});

assert.match(markup, /data-knowledge-item-open="item-1"/);
assert.match(markup, /data-learning-objective-open="objective-1"/);
assert.match(markup, /data-question-open="question-1"/);
assert.doesNotMatch(markup, /data-learning-objective-save|data-question-save/);
assert.match(markup, /&lt;能解释&gt;/);

const calls = [];
const api = createKnowledgeDomainApi({
  async requestJson(url, options = {}) {
    calls.push({ url, options });
    return { data: { id: 'assessment-1', reviewStatus: 'candidate' } };
  }
});

await api.listLearningObjectives({ includeArchived: true });
await api.createQuestion({ questionType: 'shortAnswer' });
await api.confirmQuestion('question/1');
assert.match(calls[0].url, /learning-objectives\?includeArchived=true/);
assert.equal(calls[1].options.method, 'POST');
assert.match(calls[2].url, new RegExp('questions/question%2F1/confirm$'));

console.log('ok - Phase3 objective and question UI/API hooks are encoded and escaped');

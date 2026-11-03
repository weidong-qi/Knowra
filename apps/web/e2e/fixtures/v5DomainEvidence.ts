import type { Page } from '@playwright/test';
import type { KnowledgeItem, KnowledgeEvidence } from '@study-accelerator/web-core';
import { mockMobileEvidence } from '../mobile-evidence.fixture';

const date = '2026-10-10T00:00:00.000Z';
export const knowledgeTitle = '导数与瞬时变化率：从图像理解数学概念';
export const questionTitle = '解释导数的几何意义，并计算函数在给定点的变化率。';
const item: KnowledgeItem = { id: 'v5-knowledge', title: knowledgeTitle, canonicalStatement: '导数刻画函数在某一点附近的瞬时变化率。',
  userExplanation: '可以从割线斜率逐步趋近切线斜率来理解。', knowledgeType: 'concept', sourceMode: 'annotation',
  reviewStatus: 'candidate', importance: null, createdAt: date, updatedAt: date, deletedAt: null };
const objective = { id: 'v5-objective', knowledgeItemId: item.id, objective: '用自己的语言解释导数的几何意义', actionVerb: 'explain', cognitiveLevel: 'understand', reviewStatus: 'confirmed', createdAt: date, updatedAt: date };
const question = { id: 'v5-question', stem: questionTitle, questionType: 'shortAnswer', referenceAnswer: '导数表示切线斜率。对 f(x)=x²，有 f′(2)=4。',
  rubric: { totalPoints: 4, criteria: [{ description: '解释切线与变化率的关系', points: 2 }, { description: '正确求导并代入', points: 2 }] },
  explanation: '先计算平均变化率，再令区间长度趋近零。', difficulty: 'medium', reviewStatus: 'candidate', sourceMode: 'manual',
  version: 1, createdAt: date, updatedAt: date, learningObjectiveIds: [objective.id], deletedAt: null,
  sources: [{ id: 'v5-source', sourceType: 'noteVersion', sourceId: 'v5-version', quote: '导数是平均变化率的极限。', locator: { noteId: 'note-1' }, status: 'active' }] };
const evidence: KnowledgeEvidence = { id: 'v5-evidence', knowledgeItemId: item.id, sourceType: 'annotation', sourceId: 'v5-annotation', annotationId: 'v5-annotation',
  noteId: 'note-1', noteVersionId: 'v5-version', quoteText: '导数是平均变化率的极限。', headingPath: ['导数的几何意义'],
  relationType: 'supports', status: 'valid', applicabilityStatus: 'active', sourceAnnotationRemoved: false, createdAt: date, updatedAt: date };

/** 只读合成领域资料。沿用移动验收的全网阻断与外壳夹具，不访问真实资料库。 */
export async function mockV5DomainEvidence(page: Page) {
  const network = await mockMobileEvidence(page);
  const dataByPath: Record<string, unknown> = {
    '/api/knowledge/items': [item, { ...item, id: 'v5-knowledge-2', title: '平均变化率与割线斜率', reviewStatus: 'confirmed' }],
    [`/api/knowledge/items/${item.id}`]: item,
    [`/api/knowledge/items/${item.id}/evidence`]: [evidence],
    [`/api/knowledge/items/${item.id}/provenance`]: { artifactId: item.id, state: 'absent', record: null, sources: [] },
    '/api/knowledge/learning-objectives': [objective],
    '/api/knowledge/exam-profiles': [],
    '/api/knowledge/exam-focuses': [],
    '/api/knowledge/questions': [question, { ...question, id: 'v5-question-2', stem: '导数一定大于零。', questionType: 'trueFalse', referenceAnswer: false, rubric: null, sources: [] }],
    '/api/knowledge/tag-groups': [{ id: 'v5-group', name: '学习主题', code: 'ordinary', selectionMode: 'multiple', sortOrder: 0, isSystem: false }],
    '/api/knowledge/tags': ['blue', 'green', 'orange', 'violet', 'red', 'neutral'].map((color, index) => ({ id: index === 0 ? 'tag-study' : `v5-tag-${index}`, name: ['学习', '数学概念', '待整理', '复习重点', '需要核对', '延伸阅读'][index], color, groupId: 'v5-group', sortOrder: index, isSystem: false })),
    '/api/knowledge/notes/note-1/versions/v5-version': { id: 'v5-version', noteId: 'note-1', content: '# 导数的几何意义\n\n导数是平均变化率的极限。\n\n本页面仅使用合成测试资料。', contentHash: 'a'.repeat(64), createdAt: date, createdBy: 'user' }
  };
  await page.route('**/api/knowledge/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (!(path in dataByPath)) return route.fallback();
    network.requests.push(`${request.method()} ${path}`);
    if (request.method() !== 'GET') { network.blocked.push(`${request.method()} ${path}`); return route.abort('blockedbyclient'); }
    return route.fulfill({ json: { data: dataByPath[path] } });
  });
  return network;
}

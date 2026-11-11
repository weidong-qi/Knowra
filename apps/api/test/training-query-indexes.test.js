import assert from 'node:assert/strict';
import { createWorkspaceSnapshotReader } from '../src/modules/knowledge/application/workspace-query-snapshot.js';
import { createTrainingWorkspaceQuery } from '../src/modules/knowledge/application/training-workspace-query-service.js';
import { createReviewQueueQuery } from '../src/modules/knowledge/application/review-queue-query-service.js';

export const trainingQueryIndexesTests = [
  {
    name: '题库列表与概览的公共数据扫描次数不随题数增加',
    async run() {
      for (const method of ['listQuestions', 'getTrainingOverview']) {
        const counts = [];
        for (const size of [1, 40]) {
          const snapshot = await createFixture(size);
          const reads = {};
          for (const key of ['knowledgeItems', 'objectives', 'noteVersions', 'evidence']) {
            reads[key] = 0;
            snapshot[key] = new Proxy(snapshot[key], {
              get(target, property, receiver) {
                if (/^\d+$/.test(String(property))) reads[key] += 1;
                return Reflect.get(target, property, receiver);
              }
            });
          }
          await createTrainingWorkspaceQuery({ snapshotReader: { load: async () => snapshot } })[method]();
          counts.push(reads);
        }
        assert.deepEqual(counts[1], counts[0], `${method} 不应为每题重复扫描公共记录`);
        assert.ok(Object.values(counts[0]).every(count => count > 0));
      }
    }
  },
  {
    name: '题库查询保持来源标签、缺失引用、归档分页与请求内映射语义',
    async run() {
      const snapshot = await createFixture(4);
      let loads = 0;
      const service = createTrainingWorkspaceQuery({
        snapshotReader: {
          load: async () => {
            loads += 1;
            return snapshot;
          }
        }
      });
      const before = structuredClone(snapshot);
      const first = await service.listQuestions({ limit: 2 });
      assert.equal(loads, 1);
      assert.deepEqual(
        first.items.map(item => item.id),
        ['q0', 'q1']
      );
      assert.equal(first.pagination.total, 3);
      const question = first.items[0];
      assert.deepEqual(
        question.sources.map(source => source.label),
        ['知识标题', '学习目标', '笔记标题', '证据引用', '笔记版本', '知识证据', 'knowledgeItem']
      );
      assert.deepEqual(question.learningObjectiveIds, ['missing', 'o1', 'orphan']);
      assert.deepEqual(question.primaryObjective, {
        id: 'o1',
        objective: '学习目标',
        knowledgeItemId: 'k1',
        knowledgeItemTitle: '知识标题'
      });
      assert.deepEqual(
        question.objectives.map(objective => [objective.id, objective.knowledgeItemId, objective.knowledgeItemTitle]),
        [
          ['missing', null, ''],
          ['o1', 'k1', '知识标题'],
          ['orphan', 'missing-item', '']
        ]
      );
      const next = await service.listQuestions({ limit: 2, cursor: first.pagination.nextCursor });
      assert.deepEqual(
        next.items.map(item => item.id),
        ['q2']
      );
      assert.equal(next.pagination.hasMore, false);
      const archived = await service.listQuestions({ includeArchived: true, sort: 'updated-asc' });
      assert.deepEqual(
        archived.items.map(item => item.id),
        ['q3', 'q2', 'q1', 'q0']
      );
      const filtered = await service.listQuestions({
        learningObjectiveId: 'o1',
        query: '证据检索',
        sourceStatus: 'stale'
      });
      assert.deepEqual(
        filtered.items.map(item => item.id),
        ['q0']
      );
      const overview = await service.getTrainingOverview();
      assert.equal(overview.questions.total, 3);
      assert.deepEqual(overview.review, {
        pendingValidation: 1,
        pendingConfirmation: 1,
        staleSources: 1,
        insufficientSources: 1
      });
      assert.deepEqual(snapshot, before, '查询不得修改快照');
      snapshot.knowledgeItems[0].title = '新标题';
      const refreshed = await service.listQuestions();
      assert.equal(refreshed.items[0].sources[0].label, '新标题');
      assert.equal(question.sources[0].label, '知识标题', '后续请求不得改写旧 DTO');
      snapshot.knowledgeItems[0].title = '';
      snapshot.objectives[0].objective = '';
      const emptyLabels = await service.listQuestions();
      assert.deepEqual(
        emptyLabels.items[0].sources.slice(0, 2).map(source => source.label),
        ['', '']
      );
      snapshot.questions = [];
      assert.deepEqual((await service.listQuestions()).items, []);
      assert.equal((await service.getTrainingOverview()).questions.total, 0);
    }
  },
  {
    name: '审核队列复用快照题目索引并保留来源优先级与首个目标语义',
    async run() {
      const snapshot = await createFixture(4);
      // 索引已由真实快照 reader 建好；队列不应再次扫描原始关系数组。
      for (const key of ['questionObjectives', 'questionSources']) {
        Object.defineProperty(snapshot, key, {
          get() {
            throw new Error(`重复扫描 ${key}`);
          }
        });
      }
      const queue = await createReviewQueueQuery({ snapshotReader: { load: async () => snapshot } }).listReviewQueue({
        kind: 'question'
      });
      assert.deepEqual(
        queue.items.map(({ id, reason, status, summary }) => ({ id, reason, status, summary })),
        [
          { id: 'q0', reason: '题目来源待复核', status: 'stale', summary: '解释0' },
          { id: 'q1', reason: '题目缺少来源', status: 'draft', summary: '学习目标' }
        ]
      );
    }
  }
];

async function createFixture(size) {
  const updatedAt = '2026-10-11T00:00:00.000Z';
  const records = {
    note: [{ id: 'n1', title: '笔记标题' }],
    noteVersion: [
      { id: 'v1', noteId: 'n1' },
      { id: 'v2', noteId: 'missing' }
    ],
    knowledgeItem: [{ id: 'k1', title: '知识标题', reviewStatus: 'confirmed' }],
    knowledgeEvidence: [
      { id: 'e1', quoteText: '证据引用' },
      { id: 'e2', quoteText: '' }
    ],
    learningObjective: [
      { id: 'o1', knowledgeItemId: 'k1', objective: '学习目标', reviewStatus: 'confirmed' },
      { id: 'orphan', knowledgeItemId: 'missing-item', objective: '缺失知识', reviewStatus: 'archived' }
    ],
    examProfile: [],
    examFocus: [],
    questionSource: [],
    questionObjective: [],
    question: Array.from({ length: size }, (_, index) => ({
      id: `q${index}`,
      stem: `题目${index}`,
      explanation: `解释${index}`,
      updatedAt: new Date(Date.parse(updatedAt) - index * 1000).toISOString(),
      questionType: 'shortAnswer',
      reviewStatus: index === 3 ? 'archived' : index === 0 ? 'candidate' : index === 1 ? 'draft' : 'confirmed'
    }))
  };
  for (const question of records.question) {
    records.questionObjective.push({ questionId: question.id, learningObjectiveId: 'o1', isPrimary: true, order: 1 });
    if (question.id !== 'q1')
      records.questionSource.push({
        questionId: question.id,
        sourceType: 'knowledgeItem',
        sourceId: 'k1',
        status: 'active'
      });
  }
  records.questionObjective.unshift({ questionId: 'q0', learningObjectiveId: 'missing', order: 0 });
  records.questionObjective.push({ questionId: 'q0', learningObjectiveId: 'orphan', order: 2 });
  records.questionSource.push(
    ...[
      ['learningObjective', 'o1'],
      ['noteVersion', 'v1'],
      ['knowledgeEvidence', 'e1'],
      ['noteVersion', 'v2'],
      ['knowledgeEvidence', 'e2'],
      ['knowledgeItem', 'missing']
    ].map(([sourceType, sourceId]) => ({ questionId: 'q0', sourceType, sourceId, status: 'stale', quote: '证据检索' }))
  );
  const repositories = Object.fromEntries(
    Object.entries(records).map(([key, values]) => [
      `${key}Repository`,
      { list: async () => values, listByQuestionIds: async () => values }
    ])
  );
  return createWorkspaceSnapshotReader({ repositories }).load();
}

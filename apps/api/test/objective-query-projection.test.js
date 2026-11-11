import assert from 'node:assert/strict';
import { createKnowledgeWorkspaceQuery } from '../src/modules/knowledge/application/knowledge-workspace-query-service.js';
import { createWorkspaceSnapshotReader } from '../src/modules/knowledge/application/workspace-query-snapshot.js';
import {
  toKnowledgeItemWorkspaceDto,
  toLearningObjectiveWorkspaceDto
} from '../src/modules/knowledge/application/workspace-query-dto.js';
import {
  matchesText,
  paginateWorkspaceItems,
  parseWorkspaceQuery
} from '../src/modules/knowledge/application/workspace-query-utils.js';

export const objectiveQueryProjectionTests = [
  {
    name: '学习目标查询只投影已引用知识且每请求最多汇总一次证据',
    async run() {
      const snapshot = await fixture(1);
      snapshot.objectives = Array.from({ length: 40 }, (_, index) => ({
        ...snapshot.objectives[0],
        id: `repeat-${index}`,
        knowledgeItemId: 'k0',
        reviewStatus: 'confirmed'
      }));
      const evidenceByItem = snapshot.indexes.evidenceByItem;
      const counts = { evidence: 0, objectives: 0, notes: 0 };
      for (const [key, counter] of [
        ['evidenceByItem', 'evidence'],
        ['objectivesByItem', 'objectives'],
        ['noteById', 'notes']
      ]) {
        const original = snapshot.indexes[key];
        snapshot.indexes[key] = {
          get(id) {
            counts[counter] += 1;
            return original.get(id);
          }
        };
      }
      const service = query(snapshot);
      const result = await service.listLearningObjectives({ limit: 100 });
      assert.equal(result.items.length, 40);
      assert.deepEqual(counts, { evidence: 1, objectives: 0, notes: 0 });
      result.items[0].knowledgeItem.title = '调用方修改';
      assert.equal(result.items[1].knowledgeItem.title, '知识0');
      snapshot.knowledgeItems[0].title = '刷新标题';
      evidenceByItem.set('k0', [{ status: 'invalid' }]);
      const refreshed = await service.listLearningObjectives();
      assert.equal(refreshed.items[0].knowledgeItem.title, '刷新标题');
      assert.equal(refreshed.items[0].knowledgeItem.evidenceStatus, 'invalid');
      assert.equal(counts.evidence, 2, '缓存不可跨请求');
      snapshot.objectives = [];
      assert.deepEqual((await service.listLearningObjectives()).items, []);
      assert.equal(counts.evidence, 2, '空目标不扫描知识证据');
    }
  },
  {
    name: '学习目标最小投影与原实现随机差分保持归档缺失搜索排序分页语义',
    async run() {
      for (let seed = 1; seed <= 20; seed += 1) {
        const snapshot = await fixture(seed);
        const before = structuredClone(snapshot);
        const service = query(snapshot);
        for (const input of [
          {},
          { includeArchived: true },
          { query: '知识1' },
          { query: '仅正文检索' },
          { knowledgeItemId: 'k2', includeArchived: true },
          { hasQuestions: true },
          { hasQuestions: false },
          { reviewStatus: 'candidate' },
          { actionVerb: 'explain', cognitiveLevel: 'understand' },
          { sort: 'updated-asc', limit: 3 },
          { includeArchived: true, limit: 2 }
        ]) {
          const expected = legacyList(snapshot, input);
          const actual = await service.listLearningObjectives(input);
          assert.deepEqual(actual, expected, `seed=${seed}, input=${JSON.stringify(input)}`);
          if (expected.pagination.nextCursor) {
            const next = { ...input, cursor: expected.pagination.nextCursor };
            assert.deepEqual(await service.listLearningObjectives(next), legacyList(snapshot, next));
          }
        }
        assert.deepEqual(snapshot, before, '查询不可修改快照');
      }
    }
  },
  {
    name: '学习目标查询保留证据优先级删除归档知识与验证先于快照读取',
    async run() {
      const snapshot = await fixture(1);
      snapshot.objectives = snapshot.knowledgeItems.map((item, index) => ({
        id: `o${index}`,
        knowledgeItemId: item.id,
        reviewStatus: 'confirmed',
        updatedAt: '2026-10-11T00:00:00.000Z'
      }));
      const statuses = [[], ['valid'], ['valid', 'insufficient'], ['invalid', 'stale'], ['stale', 'insufficient']];
      snapshot.knowledgeItems.forEach((item, index) =>
        snapshot.indexes.evidenceByItem.set(
          item.id,
          statuses[index].map(status => ({ status }))
        )
      );
      const result = await query(snapshot).listLearningObjectives();
      assert.deepEqual(
        result.items.map(item => item.knowledgeItem.evidenceStatus),
        ['insufficient', 'valid', 'insufficient', 'invalid', 'stale']
      );
      assert.equal(result.items[2].knowledgeItem.reviewStatus, 'archived');
      assert.equal(result.items[3].knowledgeItem.id, 'k3', '已删除知识仍保持既有目标摘要');
      let loads = 0;
      const service = createKnowledgeWorkspaceQuery({
        snapshotReader: {
          load() {
            loads += 1;
            return snapshot;
          }
        }
      });
      for (const input of [
        { limit: 0 },
        { sort: 'wrong' },
        { cursor: 'broken' },
        { includeArchived: 'yes' },
        { hasQuestions: 'yes' }
      ]) {
        let error;
        try {
          legacyList(snapshot, input);
        } catch (caught) {
          error = caught;
        }
        await assert.rejects(
          service.listLearningObjectives(input),
          actual => actual.code === error.code && actual.message === error.message
        );
      }
      assert.equal(loads, 0);
    }
  }
];

function query(snapshot) {
  return createKnowledgeWorkspaceQuery({ snapshotReader: { load: async () => snapshot } });
}

// 冻结重构前的组合路径，用合成快照进行等价性差分；不走真实数据或模型。
function legacyList(snapshot, input) {
  const query = parseWorkspaceQuery(input);
  const itemById = new Map(
    snapshot.knowledgeItems.map(item => {
      const objectives = snapshot.indexes.objectivesByItem.get(item.id) ?? [];
      const questions = new Map();
      for (const objective of objectives) {
        for (const question of snapshot.indexes.questionsByObjective.get(objective.id) ?? [])
          questions.set(question.id, question);
      }
      return [
        item.id,
        toKnowledgeItemWorkspaceDto(item, {
          evidence: snapshot.indexes.evidenceByItem.get(item.id) ?? [],
          objectives: objectives.filter(objective => objective.reviewStatus !== 'archived'),
          questions: [...questions.values()],
          noteById: snapshot.indexes.noteById
        })
      ];
    })
  );
  const objectives = snapshot.objectives
    .filter(objective => query.includeArchived || objective.reviewStatus !== 'archived')
    .map(objective =>
      toLearningObjectiveWorkspaceDto(objective, {
        knowledgeItem: itemById.get(objective.knowledgeItemId) ?? null,
        questions: (snapshot.indexes.questionsByObjective.get(objective.id) ?? []).filter(
          question => query.includeArchived || question.reviewStatus !== 'archived'
        )
      })
    )
    .filter(objective => {
      if (query.reviewStatus && objective.reviewStatus !== query.reviewStatus) return false;
      if (query.actionVerb && objective.actionVerb !== query.actionVerb) return false;
      if (query.cognitiveLevel && objective.cognitiveLevel !== query.cognitiveLevel) return false;
      if (query.knowledgeItemId && objective.knowledgeItemId !== query.knowledgeItemId) return false;
      if (query.hasQuestions !== null && objective.questionCount > 0 !== query.hasQuestions) return false;
      return matchesText(
        [objective.objective, objective.knowledgeItem?.title, objective.knowledgeItem?.canonicalStatement],
        query.query
      );
    });
  return paginateWorkspaceItems(objectives, query);
}

async function fixture(seed) {
  let state = seed;
  const random = size => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % size;
  };
  const records = {
    note: [{ id: 'n0', title: '笔记' }],
    noteVersion: [],
    examProfile: [],
    examFocus: [],
    questionSource: [],
    knowledgeItem: Array.from({ length: 5 }, (_, i) => ({
      id: `k${i}`,
      title: `知识${i}`,
      canonicalStatement: '仅正文检索',
      reviewStatus: i === 2 ? 'archived' : 'confirmed',
      deletedAt: i === 3 ? '2026-01-01' : null
    })),
    knowledgeEvidence: Array.from({ length: 20 }, (_, i) => ({
      id: `e${i}`,
      knowledgeItemId: `k${random(5)}`,
      noteId: 'n0',
      quoteText: '证据',
      status: ['valid', 'stale', 'invalid', 'insufficient'][random(4)]
    })),
    learningObjective: Array.from({ length: 15 }, (_, i) => ({
      id: `o${i}`,
      knowledgeItemId: `k${random(7)}`,
      objective: `目标${i}`,
      actionVerb: i % 2 ? 'explain' : 'apply',
      cognitiveLevel: 'understand',
      reviewStatus: ['confirmed', 'candidate', 'archived'][random(3)],
      updatedAt: `2026-10-0${1 + random(3)}T00:00:00.000Z`
    })),
    question: Array.from({ length: 10 }, (_, i) => ({ id: `q${i}`, reviewStatus: i % 3 ? 'confirmed' : 'archived' })),
    questionObjective: Array.from({ length: 30 }, (_, i) => ({
      questionId: `q${i % 10}`,
      learningObjectiveId: `o${random(15)}`
    }))
  };
  const repositories = Object.fromEntries(
    Object.entries(records).map(([key, values]) => [
      `${key}Repository`,
      { list: async () => values, listByQuestionIds: async () => values }
    ])
  );
  return createWorkspaceSnapshotReader({ repositories }).load();
}

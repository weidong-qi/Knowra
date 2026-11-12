import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createKnowledgeModule } from '../src/modules/knowledge/index.ts';
import { createKnowledgeHttpHandlers } from '../src/modules/knowledge/http/knowledge-handlers.ts';
import { createServer } from '../src/server.js';
import { createAppContext } from '../src/app.factory.js';
import { createFileDataStore } from '../src/infrastructure/file-data-store.ts';
import { writeJsonFileAtomically } from '../src/infrastructure/atomic-json-file.ts';
import { createSqliteDataStore } from '../../desktop-runtime/src/sqlite-data-store.mjs';
import { createAsyncLearningObjectiveService } from '../src/modules/knowledge/application/postgres-async/learning-objective-service.ts';
import { createInMemoryLearningObjectiveRepository } from '../src/modules/knowledge/infrastructure/assessment-repository.ts';
import { createInMemoryKnowledgeItemRepository } from '../src/modules/knowledge/infrastructure/knowledge-item-repository.ts';
import { createPostgresLearningObjectiveRepository } from '../src/modules/knowledge/infrastructure/postgres/learning-objective-repository.ts';

const objectiveInput = { objective: '能够解释合成知识的原因', actionVerb: 'explain', cognitiveLevel: 'understand' };
const manual = { title: '合成知识', canonicalStatement: '仅用于审阅流程的合成内容', sourceMode: 'manual' };
const baseline = (objective, item) => ({
  reviewBaseline: { objectiveUpdatedAt: objective.updatedAt, knowledgeUpdatedAt: item.updatedAt }
});
const asAsync = repository =>
  new Proxy(repository, {
    get(target, key) {
      return typeof target[key] === 'function' ? async (...args) => target[key](...args) : target[key];
    }
  });
function seed(knowledge) {
  const created = knowledge.knowledgeItemService.createCandidate(manual).item;
  const item = knowledge.knowledgeItemService.confirmItem(created.id);
  const objective = knowledge.learningObjectiveService.createCandidate({
    ...objectiveInput,
    knowledgeItemId: item.id,
    reviewBaseline: { knowledgeUpdatedAt: item.updatedAt }
  });
  return { item, objective };
}
function persistedFixture(driver, operation) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `knowra-objective-${driver}-`));
  const file = path.join(root, driver === 'sqlite' ? 'data.sqlite' : 'data.json');
  let fail = false,
    commits = 0;
  const store =
    driver === 'sqlite'
      ? createSqliteDataStore(file, {
          beforeCommit() {
            commits++;
            if (fail) {
              fail = false;
              throw new Error('injected objective commit failure');
            }
          }
        })
      : createFileDataStore(file, {
          writeJson(target, value) {
            commits++;
            if (fail) {
              fail = false;
              throw new Error('injected objective commit failure');
            }
            writeJsonFileAtomically(target, value);
          }
        });
  try {
    const app = createAppContext({
      dataStore: store,
      storageRootDir: root,
      uploadsDir: path.join(root, 'uploads'),
      ownerId: 'test'
    });
    operation({
      app,
      store,
      file,
      root,
      failNext() {
        fail = true;
      },
      commits: () => commits
    });
  } finally {
    store.close?.();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export const learningObjectiveReviewTests = [
  {
    name: '学习目标审阅基线在同毫秒编辑后拒绝旧保存和旧确认，确认不吞掉新内容',
    run() {
      const knowledge = createKnowledgeModule(),
        service = knowledge.learningObjectiveService;
      const { item, objective } = seed(knowledge);
      const previousNow = Date.now;
      let edited;
      try {
        Date.now = () => Date.parse(objective.updatedAt);
        edited = service.updateObjective(objective.id, {
          objective: '能够解释已经修改的内容',
          ...baseline(objective, item)
        });
      } finally {
        Date.now = previousNow;
      }
      assert.equal(Date.parse(edited.updatedAt), Date.parse(objective.updatedAt) + 1);
      for (const action of [
        () => service.updateObjective(objective.id, { objective: '旧窗口内容', ...baseline(objective, item) }),
        () => service.confirmObjective(objective.id, baseline(objective, item))
      ]) {
        assert.throws(action, { code: 'LEARNING_OBJECTIVE_UPDATE_CONFLICT' });
        assert.deepEqual(service.getObjective(objective.id), edited);
      }
      assert.equal(service.confirmObjective(objective.id, baseline(edited, item)).reviewStatus, 'confirmed');
    }
  },
  {
    name: '父知识审阅后变化拒绝目标创建、保存和确认，旧无基线调用保持兼容',
    run() {
      const knowledge = createKnowledgeModule(),
        service = knowledge.learningObjectiveService;
      const { item, objective } = seed(knowledge);
      const changed = knowledge.knowledgeItemService.updateItem(item.id, {
        importance: 2,
        expectedUpdatedAt: item.updatedAt
      });
      assert.equal(changed.reviewStatus, 'confirmed');
      for (const action of [
        () =>
          service.createCandidate({
            ...objectiveInput,
            knowledgeItemId: item.id,
            reviewBaseline: { knowledgeUpdatedAt: item.updatedAt }
          }),
        () => service.updateObjective(objective.id, { objective: '旧父知识窗口', ...baseline(objective, item) }),
        () => service.confirmObjective(objective.id, baseline(objective, item))
      ])
        assert.throws(action, { code: 'LEARNING_OBJECTIVE_UPDATE_CONFLICT' });
      assert.equal(service.getObjective(objective.id).reviewStatus, 'candidate');
      const candidate = knowledge.knowledgeItemService.createCandidate(manual).item;
      assert.throws(
        () =>
          service.createCandidate({
            ...objectiveInput,
            knowledgeItemId: candidate.id,
            reviewBaseline: { knowledgeUpdatedAt: candidate.updatedAt }
          }),
        { code: 'KNOWLEDGE_ITEM_NOT_CONFIRMED' }
      );
      assert(service.createCandidate({ knowledgeItemId: candidate.id }).id);
      assert.equal(service.confirmObjective(objective.id).reviewStatus, 'confirmed');
    }
  },
  {
    name: '学习目标基线不接受空、部分或非法值，结构校验失败保留原候选',
    run() {
      const knowledge = createKnowledgeModule(),
        service = knowledge.learningObjectiveService;
      const { item, objective } = seed(knowledge);
      for (const reviewBaseline of [
        null,
        {},
        [],
        { knowledgeUpdatedAt: item.updatedAt },
        { objectiveUpdatedAt: '', knowledgeUpdatedAt: item.updatedAt },
        { objectiveUpdatedAt: 'bad', knowledgeUpdatedAt: item.updatedAt },
        { objectiveUpdatedAt: '2026-02-30T00:00:00.000Z', knowledgeUpdatedAt: item.updatedAt }
      ]) {
        assert.throws(() => service.confirmObjective(objective.id, { reviewBaseline }), {
          code: 'LEARNING_OBJECTIVE_BASELINE_INVALID'
        });
        assert.deepEqual(service.getObjective(objective.id), objective);
      }
      const mismatched = service.updateObjective(objective.id, {
        cognitiveLevel: 'remember',
        ...baseline(objective, item)
      });
      assert.throws(() => service.confirmObjective(objective.id, baseline(mismatched, item)), {
        code: 'LEARNING_OBJECTIVE_COGNITIVE_LEVEL_MISMATCH'
      });
      assert.deepEqual(service.getObjective(objective.id), mismatched);
      const vague = service.updateObjective(objective.id, {
        objective: '掌握合成知识',
        cognitiveLevel: 'understand',
        ...baseline(mismatched, item)
      });
      assert.throws(() => service.confirmObjective(objective.id, baseline(vague, item)), {
        code: 'LEARNING_OBJECTIVE_VAGUE_VERB'
      });
      assert.deepEqual(service.getObjective(objective.id), vague);
    }
  },
  {
    name: '异步目标更新与确认通过存储 CAS 只接受一个相同目标基线',
    async run() {
      const item = { id: 'async-parent', ...manual, reviewStatus: 'confirmed', updatedAt: new Date().toISOString() };
      const service = createAsyncLearningObjectiveService({
        repository: asAsync(createInMemoryLearningObjectiveRepository()),
        knowledgeItemRepository: asAsync(createInMemoryKnowledgeItemRepository({ records: [item] }))
      });
      const objective = await service.createCandidate({ ...objectiveInput, knowledgeItemId: item.id });
      const result = await Promise.allSettled([
        service.updateObjective(objective.id, { objective: '并发新目标', ...baseline(objective, item) }),
        service.confirmObjective(objective.id, baseline(objective, item))
      ]);
      assert.equal(result.filter(entry => entry.status === 'fulfilled').length, 1);
      assert.equal(result.find(entry => entry.status === 'rejected').reason.code, 'LEARNING_OBJECTIVE_UPDATE_CONFLICT');
    }
  },
  ...['json', 'sqlite'].map(driver => ({
    name: `${driver} 目标与题目失效一起提交一次，失败回滚并经重新打开验证`,
    run() {
      persistedFixture(driver, ({ app, store, file, failNext, commits }) => {
        const api = app.http.knowledge;
        const { item: created } = api.createKnowledgeItem(manual);
        const item = api.confirmKnowledgeItem({ id: created.id });
        const objective = api.createLearningObjective({
          ...objectiveInput,
          knowledgeItemId: item.id,
          reviewBaseline: { knowledgeUpdatedAt: item.updatedAt }
        });
        const confirmed = api.confirmLearningObjective({ id: objective.id }, baseline(objective, item));
        const question = api.createQuestion({
          stem: '合成判断题',
          questionType: 'trueFalse',
          referenceAnswer: true,
          learningObjectiveIds: [confirmed.id],
          sources: [{ sourceType: 'manual', sourceId: 'synthetic', quoteText: '人工合成测试' }]
        });
        api.validateQuestion({ id: question.id });
        api.confirmQuestion({ id: question.id });
        const before = structuredClone(store.state);
        failNext();
        assert.throws(() =>
          api.updateLearningObjective(
            { id: confirmed.id },
            { objective: '能够解释修订后的内容', ...baseline(confirmed, item) }
          )
        );
        assert.deepEqual(store.state, before);
        failNext();
        assert.throws(() =>
          api.updateKnowledgeItem(
            { id: item.id },
            { canonicalStatement: '失败时应一起回滚的父知识修订', expectedUpdatedAt: item.updatedAt }
          )
        );
        assert.deepEqual(store.state, before);
        let reopened = driver === 'sqlite' ? createSqliteDataStore(file) : createFileDataStore(file);
        try {
          assert.deepEqual(reopened.state.knowledgeItems, before.knowledgeItems);
          assert.deepEqual(reopened.state.learningObjectives, before.learningObjectives);
          assert.deepEqual(reopened.state.questions, before.questions);
        } finally {
          reopened.close?.();
        }
        const count = commits();
        api.updateLearningObjective(
          { id: confirmed.id },
          { objective: '能够解释修订后的内容', ...baseline(confirmed, item) }
        );
        assert.equal(commits() - count, 1);
        assert.equal(api.getLearningObjective({ id: confirmed.id }).reviewStatus, 'candidate');
        assert.equal(api.getQuestion({ id: question.id }).reviewStatus, 'candidate');
        reopened = driver === 'sqlite' ? createSqliteDataStore(file) : createFileDataStore(file);
        try {
          assert.equal(
            reopened.state.learningObjectives.find(row => row.id === confirmed.id).reviewStatus,
            'candidate'
          );
          assert.equal(reopened.state.questions.find(row => row.id === question.id).reviewStatus, 'candidate');
        } finally {
          reopened.close?.();
        }
      });
    }
  })),
  {
    name: '目标 HTTP 确认读取真实请求基线，旧审阅返回 409 且保留候选内容',
    async run() {
      const knowledge = createKnowledgeModule();
      const { item, objective } = seed(knowledge);
      const server = createServer({
        appContext: { http: { knowledge: createKnowledgeHttpHandlers({ knowledgeModule: knowledge }), storage: {} } },
        logger: { error() {} }
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const base = `http://127.0.0.1:${server.address().port}/api/knowledge/learning-objectives/${objective.id}`;
      const send = async (url, method, input) => {
        const response = await fetch(url, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input)
        });
        return { status: response.status, ...(await response.json()) };
      };
      try {
        const edited = await send(base, 'PATCH', {
          objective: '能够解释其他窗口已修改的内容',
          ...baseline(objective, item)
        });
        assert.equal(edited.status, 200);
        const old = await send(`${base}/confirm`, 'POST', baseline(objective, item));
        assert.equal(old.status, 409);
        assert.equal(old.error.code, 'LEARNING_OBJECTIVE_UPDATE_CONFLICT');
        assert.deepEqual({ ...knowledge.learningObjectiveService.getObjective(objective.id) }, edited.data);
        const invalid = await send(`${base}/confirm`, 'POST', { reviewBaseline: {} });
        assert.equal(invalid.status, 400);
        assert.equal(invalid.error.code, 'LEARNING_OBJECTIVE_BASELINE_INVALID');
        assert.equal(
          (await send(`${base}/confirm`, 'POST', baseline(edited.data, item))).data.reviewStatus,
          'confirmed'
        );
      } finally {
        server.close();
        await once(server, 'close');
      }
    }
  },
  {
    name: 'PostgreSQL 目标 repository 使用目标时间 CAS 拒绝覆盖',
    async run() {
      let query;
      const repository = createPostgresLearningObjectiveRepository({
        db: {
          learningObjective: {
            async updateMany(input) {
              query = input;
              return { count: 0 };
            }
          }
        }
      });
      await assert.rejects(
        repository.save(
          {
            id: 'race',
            knowledgeItemId: 'parent',
            ...objectiveInput,
            reviewStatus: 'candidate',
            order: 0,
            updatedAt: '2026-10-03T00:00:01.000Z',
            createdAt: '2026-10-03T00:00:00.000Z'
          },
          { expectedUpdatedAt: '2026-10-03T00:00:00.000Z' }
        ),
        { code: 'LEARNING_OBJECTIVE_UPDATE_CONFLICT' }
      );
      assert.equal(query.where.id, 'race');
      assert.equal(query.where.updatedAt.toISOString(), '2026-10-03T00:00:00.000Z');
    }
  }
];

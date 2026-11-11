import assert from 'node:assert/strict';
import { createPostgresKnowledgeModule } from '../src/modules/knowledge/postgres-async-module.js';
import { createAsyncLearningObjectiveService } from '../src/modules/knowledge/application/postgres-async/learning-objective-service.ts';
import { createPostgresKnowledgeItemRepository } from '../src/modules/knowledge/infrastructure/postgres/knowledge-item-repository.ts';
import { createPostgresLearningObjectiveRepository } from '../src/modules/knowledge/infrastructure/postgres/learning-objective-repository.ts';
import { createAppError } from '../src/errors/app-error.js';
import { withLearningObjectiveReviewErrors } from '../src/modules/knowledge/application/learning-objective-concurrency.ts';

const timestamp = new Date('2026-10-03T00:00:00.000Z');
const item = {
  id: 'parent',
  title: '合成父知识',
  canonicalStatement: '合成陈述',
  sourceMode: 'manual',
  reviewStatus: 'confirmed',
  createdAt: timestamp,
  updatedAt: timestamp
};
const objective = {
  id: 'objective',
  knowledgeItemId: item.id,
  objective: '能够解释合成内容',
  actionVerb: 'explain',
  cognitiveLevel: 'understand',
  reviewStatus: 'candidate',
  order: 0,
  createdAt: timestamp,
  updatedAt: timestamp
};
const review = {
  reviewBaseline: { knowledgeUpdatedAt: timestamp.toISOString(), objectiveUpdatedAt: timestamp.toISOString() }
};
const reviewActions = {
  createCandidate: service =>
    service.createCandidate({
      knowledgeItemId: item.id,
      objective: objective.objective,
      actionVerb: 'explain',
      cognitiveLevel: 'understand',
      reviewBaseline: { knowledgeUpdatedAt: timestamp.toISOString() }
    }),
  updateObjective: service =>
    service.updateObjective(objective.id, { objective: '能够解释修改后的合成内容', ...review }),
  confirmObjective: service => service.confirmObjective(objective.id, review)
};
const conflictErrors = () => [
  Object.assign(new Error('transaction write conflict'), { code: 'P2034' }),
  Object.assign(new Error('raw serialization conflict'), { code: 'P2010', meta: { code: '40001' } }),
  Object.assign(new Error('raw deadlock'), { code: 'P2010', meta: { code: '40P01' } })
];
const repositoryNames = [
  'note',
  'folder',
  'tag',
  'tagGroup',
  'knowledgeSpace',
  'contentAnnotation',
  'pdfAnnotation',
  'annotationExclusion',
  'annotationRevision',
  'analysisScope',
  'noteVersion',
  'knowledgeItem',
  'knowledgeEvidence',
  'knowledgeArtifactProvenance',
  'learningObjective',
  'examProfile',
  'examFocus',
  'question',
  'questionObjective',
  'questionSource'
];
function fakeModule(error, { commit = false } = {}) {
  let transactions = 0;
  const db = new Proxy(
    {
      knowledgeItem: { findUnique: async () => item },
      learningObjective: { findUnique: async () => objective },
      $queryRawUnsafe: async () => {
        throw error;
      }
    },
    {
      get(target, key) {
        return key in target ? target[key] : {};
      }
    }
  );
  const module = createPostgresKnowledgeModule({
    ...Object.fromEntries(repositoryNames.map(name => [`${name}Repository`, { supportsAsync: true }])),
    client: {
      async $transaction(operation, options) {
        transactions++;
        assert.equal(options.isolationLevel, 'Serializable');
        if (commit) throw error;
        return operation(db);
      }
    }
  });
  return { service: module.learningObjectiveService, transactions: () => transactions };
}

export const learningObjectiveReviewErrorTests = [
  {
    name: '目标审阅竞争：真实 PG repository cause 经服务及模块事务映射，所有新审阅动作只执行一次',
    async run() {
      for (const error of conflictErrors())
        for (const action of Object.values(reviewActions)) {
          const { service, transactions } = fakeModule(error);
          await assert.rejects(action(service), failure => {
            assert.equal(failure.code, 'LEARNING_OBJECTIVE_UPDATE_CONFLICT');
            assert.equal(failure.statusCode, 409);
            assert.match(failure.message, /重新加载并核对/);
            assert.equal(failure.cause.cause, error);
            return true;
          });
          assert.equal(transactions(), 1);
        }
      const raw = conflictErrors()[0];
      const db = {
        knowledgeItem: { findUnique: async () => item },
        learningObjective: { findUnique: async () => objective },
        $queryRawUnsafe: async () => {
          throw raw;
        }
      };
      const service = createAsyncLearningObjectiveService({
        repository: createPostgresLearningObjectiveRepository({ db }),
        knowledgeItemRepository: createPostgresKnowledgeItemRepository({ db })
      });
      await assert.rejects(service.confirmObjective(objective.id, review), {
        code: 'LEARNING_OBJECTIVE_UPDATE_CONFLICT',
        statusCode: 409
      });
    }
  },
  {
    name: '目标审阅事务提交竞争也映射，旧无基线调用保留数据库错误码',
    async run() {
      for (const action of Object.values(reviewActions)) {
        const { service, transactions } = fakeModule(conflictErrors()[0], { commit: true });
        await assert.rejects(action(service), { code: 'LEARNING_OBJECTIVE_UPDATE_CONFLICT', statusCode: 409 });
        assert.equal(transactions(), 1);
      }
      const legacy = fakeModule(conflictErrors()[0], { commit: true });
      await assert.rejects(legacy.service.confirmObjective(objective.id), {
        code: 'DATABASE_CONCURRENT_UPDATE',
        statusCode: 409
      });
      const legacyRaw = fakeModule(conflictErrors()[1]);
      await assert.rejects(legacyRaw.service.confirmObjective(objective.id), {
        code: 'DATABASE_OPERATION_FAILED',
        statusCode: 500
      });
    }
  },
  {
    name: '非竞争数据库失败、存在性和结构错误不冒充目标审阅冲突',
    async run() {
      for (const metaCode of ['42501', '42601', '57014', '40001-extra', 40001]) {
        const failure = Object.assign(new Error('non-concurrency raw failure'), {
          code: 'P2010',
          meta: { code: metaCode }
        });
        const { service } = fakeModule(failure);
        await assert.rejects(service.confirmObjective(objective.id, review), {
          code: 'DATABASE_OPERATION_FAILED',
          statusCode: 500
        });
      }
      for (const [code, statusCode] of [
        ['LEARNING_OBJECTIVE_NOT_FOUND', 404],
        ['LEARNING_OBJECTIVE_CONTENT_REQUIRED', 422]
      ]) {
        const failure = createAppError(code, 'existing domain failure', statusCode, { cause: conflictErrors()[0] });
        await assert.rejects(
          withLearningObjectiveReviewErrors(review, () => {
            throw failure;
          }),
          error => error === failure
        );
      }
      const cyclic = new Error('unrelated cause cycle');
      cyclic.cause = cyclic;
      await assert.rejects(
        withLearningObjectiveReviewErrors(review, () => {
          throw cyclic;
        }),
        error => error === cyclic
      );
    }
  },
  {
    name: '非法审阅基线在数据库事务前拒绝，不能被数据库竞争掩盖',
    async run() {
      const { service, transactions } = fakeModule(conflictErrors()[0], { commit: true });
      for (const reviewBaseline of [
        null,
        {},
        { knowledgeUpdatedAt: timestamp.toISOString() },
        { knowledgeUpdatedAt: timestamp.toISOString(), objectiveUpdatedAt: '2026-02-30T00:00:00.000Z' }
      ]) {
        await assert.rejects(service.confirmObjective(objective.id, { reviewBaseline }), {
          code: 'LEARNING_OBJECTIVE_BASELINE_INVALID',
          statusCode: 400
        });
      }
      assert.equal(transactions(), 0);
    }
  }
];

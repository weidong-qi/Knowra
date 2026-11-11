import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';
import { createPostgresAppContext } from '../src/postgres-app.factory.js';
import { createAsyncLearningObjectiveService } from '../src/modules/knowledge/application/postgres-async/learning-objective-service.ts';
import { createPostgresKnowledgeItemRepository } from '../src/modules/knowledge/infrastructure/postgres/knowledge-item-repository.ts';
import { createPostgresLearningObjectiveRepository } from '../src/modules/knowledge/infrastructure/postgres/learning-objective-repository.ts';

const parentLockQuery = 'SELECT id FROM "KnowledgeItem" WHERE id = $1 FOR UPDATE';
const syncGateQuery = 'SELECT pg_advisory_xact_lock(1266775634, 32)::text';
const baseline = (objective, item) => ({
  reviewBaseline: { objectiveUpdatedAt: objective.updatedAt, knowledgeUpdatedAt: item.updatedAt }
});
const outcome = promise =>
  promise.then(
    value => ({ value }),
    error => ({ error })
  );
const requireSuccess = result => {
  if (result.error) throw result.error;
  return result.value;
};

// 测试拥有原生 client，注入独立对象；不修改 app.prisma 或生产同步代理。
function observedClient(native, control) {
  const nativeTransaction = native.$transaction.bind(native);
  return new Proxy(native, {
    get(target, key) {
      if (key === '$transaction')
        return (operation, options) =>
          nativeTransaction(async tx => {
            const [{ pid }] = await tx.$queryRawUnsafe('SELECT pg_backend_pid()::integer AS pid');
            const [{ transaction_isolation: isolation }] = await tx.$queryRawUnsafe('SHOW transaction_isolation');
            control.transactions.push({ pid, isolation });
            const observedTx = new Proxy(tx, {
              get(transaction, property) {
                if (property === 'knowledgeItem')
                  return new Proxy(transaction.knowledgeItem, {
                    get(model, method) {
                      if (method === 'updateMany')
                        return async input => {
                          const result = await model.updateMany(input);
                          await control.afterParentWrite?.({ input, result, pid, isolation });
                          return result;
                        };
                      const value = model[method];
                      return typeof value === 'function' ? value.bind(model) : value;
                    }
                  });
                const value = transaction[property];
                return typeof value === 'function' ? value.bind(transaction) : value;
              }
            });
            return operation(observedTx);
          }, options);
      const value = target[key];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}
async function fixture(operation) {
  const database = await createPostgresTestDatabase();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-objective-review-pg-'));
  const apps = [],
    natives = [],
    controls = [];
  try {
    const { PrismaClient } = await import('@prisma/client');
    for (const name of ['a', 'b']) {
      const native = new PrismaClient({ datasources: { db: { url: database.databaseUrl } }, log: [] });
      natives.push(native);
      const control = { transactions: [], afterParentWrite: null };
      controls.push(control);
      apps.push(
        await createPostgresAppContext({
          client: observedClient(native, control),
          databaseUrl: database.databaseUrl,
          storageRootDir: path.join(root, name),
          uploadsDir: path.join(root, name, 'uploads')
        })
      );
    }
    const observer = new PrismaClient({ datasources: { db: { url: database.databaseUrl } }, log: [] });
    natives.push(observer);
    await observer.$connect();
    const api = apps[0].http.knowledge;
    const { item: candidate } = await api.createKnowledgeItem({
      title: '合成父知识',
      canonicalStatement: '审阅测试的合成内容',
      sourceMode: 'manual'
    });
    const item = await api.confirmKnowledgeItem({ id: candidate.id });
    const objective = await api.createLearningObjective({
      knowledgeItemId: item.id,
      objective: '能够解释合成知识',
      actionVerb: 'explain',
      cognitiveLevel: 'understand',
      reviewBaseline: { knowledgeUpdatedAt: item.updatedAt }
    });
    await operation({
      a: apps[0],
      b: apps[1],
      api,
      item,
      objective,
      nativeA: natives[0],
      nativeB: natives[1],
      observer,
      controlA: controls[0],
      controlB: controls[1]
    });
  } finally {
    const failures = [];
    for (const app of apps)
      try {
        await app.close();
      } catch (error) {
        failures.push(error);
      }
    for (const client of natives)
      try {
        await client.$disconnect();
      } catch (error) {
        failures.push(error);
      }
    try {
      await database.close();
    } catch (error) {
      failures.push(error);
    }
    fs.rmSync(root, { recursive: true, force: true });
    if (failures.length) assert.fail(new AggregateError(failures, '目标审阅 PostgreSQL 夹具清理失败'));
  }
}
async function confirmedQuestion(api, objective, item) {
  const confirmed = await api.confirmLearningObjective({ id: objective.id }, baseline(objective, item));
  const question = await api.createQuestion({
    stem: '合成判断题',
    questionType: 'trueFalse',
    referenceAnswer: true,
    learningObjectiveIds: [confirmed.id],
    sources: [{ sourceType: 'manual', sourceId: 'synthetic', quoteText: '人工合成测试' }]
  });
  await api.validateQuestion({ id: question.id });
  await api.confirmQuestion({ id: question.id });
  return { confirmed, question };
}
async function waitForBlockedQuery(observer, blockerPid, query) {
  const started = Date.now();
  while (Date.now() - started < 3000) {
    const rows = await observer.$queryRawUnsafe(
      'SELECT pid, query, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = $1 AND query = $2 AND $3::integer = ANY(pg_blocking_pids(pid))',
      'Lock',
      query,
      blockerPid
    );
    if (rows.length) {
      assert(rows.every(row => row.blockers.includes(blockerPid) && row.pid !== blockerPid && row.query === query));
      console.log('OBJECTIVE_REVIEW_PG_LOCK_WAIT', JSON.stringify({ blockerPid, rows }));
      return rows;
    }
    await delay(10);
  }
  assert.fail(`未观察到指定事务 ${blockerPid} 阻塞的真实 SQL：${query}`);
}
async function holdParent(native, item) {
  let acquired, release;
  const ready = new Promise(resolve => {
    acquired = resolve;
  });
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const done = outcome(
    native.$transaction(
      async tx => {
        const [{ pid }] = await tx.$queryRawUnsafe('SELECT pg_backend_pid()::integer AS pid');
        await tx.$queryRawUnsafe(parentLockQuery, item.id);
        acquired(pid);
        await gate;
        await tx.knowledgeItem.update({
          where: { id: item.id },
          data: { importance: 2, updatedAt: new Date(Date.parse(item.updatedAt) + 1) }
        });
      },
      { timeout: 10000 }
    )
  );
  try {
    const pid = await Promise.race([
      ready,
      done.then(result => {
        throw result.error ?? new Error('父行锁 gate 未进入');
      })
    ]);
    return { pid, release, done };
  } catch (error) {
    release();
    await done;
    throw error;
  }
}
function assertReviewConflict(result) {
  assert.equal(result.error?.code, 'LEARNING_OBJECTIVE_UPDATE_CONFLICT');
  assert.equal(result.error?.statusCode, 409);
}
function assertRawSerializationConflict(error) {
  const seen = new Set(),
    causes = [];
  for (let cause = error; cause && typeof cause === 'object' && !seen.has(cause); cause = cause.cause) {
    seen.add(cause);
    causes.push({ code: cause.code, sqlState: cause.meta?.code });
  }
  assert(
    causes.some(cause => cause.code === 'P2010' && cause.sqlState === '40001'),
    '独立原生 Serializable 验收必须实际触发 SQLSTATE 40001'
  );
  console.log('OBJECTIVE_REVIEW_PG_RAW_SERIALIZATION', JSON.stringify(causes));
}

// 实际 factory 由同步代理强制 ReadCommitted 和整库 advisory gate；独立 Serializable 场景单独标明。
export const learningObjectiveReviewPostgresTests = process.env.KNOWRA_SYNC_TEST_DATABASE_URL
  ? [
      {
        name: '真实 PostgreSQL 默认 factory：父行锁等待后的旧审阅拒绝与双实例 CAS',
        async run() {
          await fixture(async ({ api, b, item, objective, nativeA, observer, controlB }) => {
            const holder = await holdParent(nativeA, item);
            const waiting = outcome(
              b.http.knowledge.confirmLearningObjective({ id: objective.id }, baseline(objective, item))
            );
            let waitingResult;
            try {
              await waitForBlockedQuery(observer, holder.pid, parentLockQuery);
            } finally {
              holder.release();
              const held = await holder.done;
              waitingResult = await waiting;
              requireSuccess(held);
            }
            assertReviewConflict(waitingResult);
            assert.equal(controlB.transactions.at(-1).isolation, 'read committed');
            assert.deepEqual(await api.getLearningObjective({ id: objective.id }), objective);
            const latestParent = await api.getKnowledgeItem({ id: item.id });
            assert.equal(latestParent.importance, 2);
            const results = await Promise.allSettled([
              api.updateLearningObjective(
                { id: objective.id },
                { objective: '能够解释并发编辑后的内容', ...baseline(objective, latestParent) }
              ),
              b.http.knowledge.confirmLearningObjective({ id: objective.id }, baseline(objective, latestParent))
            ]);
            assert.equal(results.filter(entry => entry.status === 'fulfilled').length, 1);
            assert.equal(
              results.find(entry => entry.status === 'rejected').reason.code,
              'LEARNING_OBJECTIVE_UPDATE_CONFLICT'
            );
            const accepted = results.find(entry => entry.status === 'fulfilled').value;
            assert.deepEqual(await api.getLearningObjective({ id: objective.id }), accepted);
            assert(Date.parse(accepted.updatedAt) > Date.parse(objective.updatedAt));
          });
        }
      },
      {
        name: '真实 PostgreSQL 默认 factory：父修订持写锁时目标在整库 gate 等待，目标与题目一起失效',
        async run() {
          await fixture(async ({ api, b, item, objective, observer, controlA }) => {
            const { confirmed, question } = await confirmedQuestion(api, objective, item);
            let written,
              release,
              gated = false;
            const ready = new Promise(resolve => {
              written = resolve;
            });
            const gate = new Promise(resolve => {
              release = resolve;
            });
            controlA.afterParentWrite = async ({ input, result, pid, isolation }) => {
              if (!gated && input.where.id === item.id && result.count === 1) {
                gated = true;
                assert.equal(isolation, 'read committed');
                written(pid);
                await gate;
              }
            };
            let confirmation;
            const parent = outcome(
              api.updateKnowledgeItem(
                { id: item.id },
                { canonicalStatement: '父知识语义已经修订', expectedUpdatedAt: item.updatedAt }
              )
            );
            try {
              const pid = await Promise.race([
                ready,
                parent.then(result => {
                  throw result.error ?? new Error('父写锁 gate 未进入');
                })
              ]);
              confirmation = outcome(
                b.http.knowledge.confirmLearningObjective({ id: confirmed.id }, baseline(confirmed, item))
              );
              try {
                await waitForBlockedQuery(observer, pid, syncGateQuery);
              } finally {
                release();
              }
              requireSuccess(await parent);
              assertReviewConflict(await confirmation);
            } finally {
              release();
              await parent;
              await confirmation;
              controlA.afterParentWrite = null;
            }
            assert.equal((await api.getKnowledgeItem({ id: item.id })).reviewStatus, 'needsRevision');
            assert.equal((await api.getLearningObjective({ id: confirmed.id })).reviewStatus, 'candidate');
            assert.equal((await api.getQuestion({ id: question.id })).reviewStatus, 'candidate');
          });
        }
      },
      {
        name: '真实 PostgreSQL 独立原生 Serializable：实际行锁 SQLSTATE 40001 映射为审阅冲突',
        async run() {
          await fixture(async ({ api, item, objective, nativeA, nativeB, observer }) => {
            const holder = await holdParent(nativeA, item);
            const confirmation = outcome(
              nativeB.$transaction(
                async tx => {
                  const [{ transaction_isolation: isolation }] = await tx.$queryRawUnsafe('SHOW transaction_isolation');
                  assert.equal(isolation, 'serializable');
                  const service = createAsyncLearningObjectiveService({
                    repository: createPostgresLearningObjectiveRepository({ db: tx }),
                    knowledgeItemRepository: createPostgresKnowledgeItemRepository({ db: tx })
                  });
                  return service.confirmObjective(objective.id, baseline(objective, item));
                },
                { isolationLevel: 'Serializable', timeout: 10000 }
              )
            );
            let result;
            try {
              await waitForBlockedQuery(observer, holder.pid, parentLockQuery);
            } finally {
              holder.release();
              const held = await holder.done;
              result = await confirmation;
              requireSuccess(held);
            }
            assertReviewConflict(result);
            assertRawSerializationConflict(result.error);
            assert.deepEqual(await api.getLearningObjective({ id: objective.id }), objective);
          });
        }
      },
      {
        name: '真实 PostgreSQL 目标与父知识失效：关联题目写入失败全部回滚',
        async run() {
          await fixture(async ({ a, api, item, objective }) => {
            const { confirmed, question } = await confirmedQuestion(api, objective, item);
            const beforeItem = await api.getKnowledgeItem({ id: item.id });
            const beforeObjective = await api.getLearningObjective({ id: confirmed.id });
            const beforeQuestion = await api.getQuestion({ id: question.id });
            await a.prisma.$executeRawUnsafe(
              `CREATE FUNCTION fail_objective_review_question() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected objective review question failure'; END $$`
            );
            await a.prisma.$executeRawUnsafe(
              `CREATE TRIGGER objective_review_question_failure BEFORE UPDATE ON "Question" FOR EACH ROW EXECUTE FUNCTION fail_objective_review_question()`
            );
            try {
              await assert.rejects(
                api.updateLearningObjective(
                  { id: confirmed.id },
                  { objective: '能够解释失败回滚的修订', ...baseline(confirmed, item) }
                )
              );
              assert.deepEqual(await api.getLearningObjective({ id: confirmed.id }), beforeObjective);
              assert.deepEqual(await api.getQuestion({ id: question.id }), beforeQuestion);
              await assert.rejects(
                api.updateKnowledgeItem(
                  { id: item.id },
                  { canonicalStatement: '同一事务中失败的父知识修订', expectedUpdatedAt: item.updatedAt }
                )
              );
              assert.deepEqual(await api.getKnowledgeItem({ id: item.id }), beforeItem);
              assert.deepEqual(await api.getLearningObjective({ id: confirmed.id }), beforeObjective);
              assert.deepEqual(await api.getQuestion({ id: question.id }), beforeQuestion);
            } finally {
              await a.prisma.$executeRawUnsafe('DROP TRIGGER objective_review_question_failure ON "Question"');
              await a.prisma.$executeRawUnsafe('DROP FUNCTION fail_objective_review_question()');
            }
            const saved = await api.updateLearningObjective(
              { id: confirmed.id },
              { objective: '能够解释成功提交的修订', ...baseline(confirmed, item) }
            );
            assert.equal(saved.reviewStatus, 'candidate');
            assert.equal((await api.getQuestion({ id: question.id })).reviewStatus, 'candidate');
          });
        }
      }
    ]
  : [];

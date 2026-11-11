import assert from 'node:assert/strict';
import { createKnowledgeExtractionTaskService } from '../../src/modules/ai/knowledge-extraction-task-service.ts';
import { createMaintenanceGate } from '../../src/infrastructure/maintenance-gate.ts';
import { createServer } from '../../src/server.js';

// 真实 server/task service + 受控异步事务适配器；不代表真实 PostgreSQL 验证。
async function checkClose({ failRecovery = false, concurrentRecovery = false, holdReady = false } = {}) {
  const entered = Promise.withResolvers(),
    release = Promise.withResolvers(),
    gate = createMaintenanceGate();
  let identityReads = 0,
    transactions = 0,
    storageClosed = false,
    readsAfterClose = 0,
    listReads = 0;
  const warnings = [],
    recoveries = [];
  const assertOpen = () => {
    if (storageClosed) {
      readsAfterClose++;
      throw Object.assign(new Error('synthetic closed store'), { code: 'STORE_CLOSED' });
    }
  };
  const store = {
    supportsAsync: true,
    async runTransaction(operation) {
      transactions++;
      assertOpen();
      return operation({});
    },
    async listPage() {
      assertOpen();
      return [];
    },
    async list() {
      listReads++;
      assertOpen();
      if (failRecovery) throw Object.assign(new Error('synthetic recovery failure'), { code: 'TEST_RECOVERY_FAILED' });
      return [];
    }
  };
  const context = {
    aiRepository: {
      async identity() {
        assertOpen();
        identityReads++;
        if (identityReads === (holdReady ? 1 : 2)) {
          entered.resolve();
          await release.promise;
        }
        return { datasetId: 'synthetic-dataset', datasetEpoch: 'synthetic-epoch' };
      }
    }
  };
  const tasks = createKnowledgeExtractionTaskService({
    store,
    createContext: () => context,
    ownerId: 'demo',
    maintenanceGate: gate,
    gateway: {
      complete() {
        assert.fail('recovery must not enqueue');
      },
      capabilities: () => ({ provider: 'mock' })
    },
    commit: {
      commit() {
        assert.fail('recovery must not accept output');
      }
    },
    receiptStore: {}
  });
  const recover = tasks.recover;
  tasks.recover = () => {
    const promise = recover();
    recoveries.push(promise);
    return promise;
  };
  const server = createServer({
    appContext: { knowledgeExtractionTasks: tasks, http: {} },
    logger: {
      warn(...args) {
        warnings.push(args);
      },
      error() {}
    }
  });
  let closing, maintenance;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    await entered.promise;
    if (concurrentRecovery) {
      tasks.recover();
      maintenance = gate.runMaintenance(async () => assert.equal(storageClosed, false));
    }
    await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
    let closeReturned = false;
    closing = tasks.close().then(() => {
      closeReturned = true;
    });
    await new Promise(resolve => setImmediate(resolve));
    const closeReturnedWhileRecovering = closeReturned;
    if (closeReturned) storageClosed = true; // 宿主严格按 HTTP close -> tasks.close -> store close。
    release.resolve();
    await closing;
    await maintenance;
    storageClosed = true;
    await new Promise(resolve => setImmediate(resolve));
    const settled = await Promise.allSettled(recoveries);
    console.log(
      JSON.stringify({
        failRecovery,
        concurrentRecovery,
        holdReady,
        closeReturnedWhileRecovering,
        readsAfterClose,
        recoveryResults: settled.map(result => (result.status === 'fulfilled' ? result.value : result.reason.code)),
        actualPostgresExecuted: false
      })
    );
    assert.equal(closeReturnedWhileRecovering, false, 'close must wait for recovery before the host closes storage');
    assert.equal(readsAfterClose, 0);
    assert.equal(listReads, holdReady ? 0 : concurrentRecovery ? 2 : 1);
    for (const result of settled) {
      assert.equal(result.status, failRecovery || holdReady ? 'rejected' : 'fulfilled');
      if (holdReady) assert.equal(result.reason.code, 'KNOWLEDGE_EXTRACTION_NOT_RUNNABLE');
      else if (failRecovery) assert.equal(result.reason.code, 'TEST_RECOVERY_FAILED');
      else assert.equal(result.value, 0);
    }
    assert.equal(warnings.length, failRecovery || holdReady ? 1 : 0);
    assert.deepEqual(gate.getState(), { activeOperations: 0, maintenanceActive: false, waitingMaintenances: 0 });
    const before = { identityReads, transactions, listReads };
    await assert.rejects(recover(), { code: 'KNOWLEDGE_EXTRACTION_NOT_RUNNABLE' });
    await tasks.close();
    assert.deepEqual(
      { identityReads, transactions, listReads },
      before,
      'closed service cannot start another recovery'
    );
  } finally {
    release.resolve();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await closing;
    await Promise.allSettled(recoveries);
    await tasks.close();
  }
}

await checkClose();
await checkClose({ failRecovery: true });
await checkClose({ concurrentRecovery: true });
await checkClose({ holdReady: true });
console.log('startup recovery close tracking passed');

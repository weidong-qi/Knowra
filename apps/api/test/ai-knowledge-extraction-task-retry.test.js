import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppContext } from '../src/app.factory.ts';
import { createFileDataStore } from '../src/infrastructure/file-data-store.ts';
import {
  createExtractionTaskSources,
  extractionTaskGateway,
  deferredTaskResponse,
  quietTaskLogger
} from './fixtures/knowledge-extraction-task.fixture.js';
import {
  assertCrossInstanceExtractionRetry,
  assertSameInstanceExtractionRetry
} from './fixtures/knowledge-extraction-retry-scenarios.js';

async function fixture(run, { manual = false, cancel = false, crossCancel = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-extraction-retry-')),
    services = [];
  const deferred = deferredTaskResponse(),
    mock = extractionTaskGateway(deferred.onCall);
  const store = createFileDataStore(path.join(root, 'data.json'));
  let now = new Date('2026-10-02T12:00:00.000Z');
  const open = () => {
    const app = createAppContext({
      dataStore: store,
      ownerId: 'demo',
      storageRootDir: root,
      knowledgeExtractionMock: {
        gateway: mock.gateway,
        clock: () => now,
        logger: quietTaskLogger,
        ...(manual ? { schedule() {} } : {})
      }
    });
    services.push(app.knowledgeExtractionTasks);
    return app;
  };
  try {
    const app = open(),
      other = manual || crossCancel ? open().knowledgeExtractionTasks : null;
    await run({
      service: app.knowledgeExtractionTasks,
      other,
      store,
      mock,
      deferred,
      cancel,
      advance: ms => {
        now = new Date(now.getTime() + ms);
      },
      ...(await createExtractionTaskSources(app))
    });
  } finally {
    deferred.release();
    for (const service of services) await service.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export const aiKnowledgeExtractionTaskRetryTests = [
  {
    name: '02B JSON 跨实例恢复后显式重试，旧代迟到失败不能覆盖retrying',
    run: () => fixture(assertCrossInstanceExtractionRetry, { manual: true })
  },
  {
    name: '02B JSON 默认调度保留旧run收尾期间的新重试唤醒，第二代只接纳一次',
    run: () => fixture(assertSameInstanceExtractionRetry)
  },
  {
    name: '02B JSON 待重试唤醒被本机或其他实例取消后不误重发',
    async run() {
      for (const crossCancel of [false, true])
        await fixture(assertSameInstanceExtractionRetry, { cancel: true, crossCancel });
    }
  }
];

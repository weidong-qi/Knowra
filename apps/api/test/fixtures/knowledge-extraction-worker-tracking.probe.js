import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppContext } from '../../src/app.factory.ts';
import { createFileDataStore } from '../../src/infrastructure/file-data-store.ts';
import {
  createExtractionTaskSources,
  extractionTaskGateway,
  quietTaskLogger
} from './knowledge-extraction-task.fixture.js';

// 父测试有硬超时：若 idle 回归为 await([]) 忙循环，也不会挂住整个 API runner。
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-extraction-tracking-'));
let service;
try {
  const releases = [],
    entered = [];
  const mock = extractionTaskGateway(async (_request, response, count) => {
    entered.push(count);
    if (count !== 3) await new Promise(resolve => releases.push(resolve));
    return response;
  });
  const app = createAppContext({
    dataStore: createFileDataStore(path.join(root, 'data.json')),
    ownerId: 'demo',
    storageRootDir: root,
    knowledgeExtractionMock: { gateway: mock.gateway, schedule() {}, logger: quietTaskLogger }
  });
  service = app.knowledgeExtractionTasks;
  const jobs = [];
  for (let index = 0; index < 3; index++) {
    const { input } = await createExtractionTaskSources(app, `-tracking-${index}`);
    jobs.push(await service.start(input));
  }
  const first = service.run(jobs[0].jobId),
    second = service.run(jobs[1].jobId);
  while (entered.length < 2) await new Promise(resolve => setImmediate(resolve));
  // 两个 direct run 占满槽位，第三个任务留在队列；idle 必须等待 active 而让出 IO。
  const idle = service.idle();
  setImmediate(() => releases.splice(0).forEach(release => release()));
  await Promise.all([first, second, idle]);
  assert.equal(mock.calls.length, 3);
  for (const job of jobs) assert.equal((await service.get(job.jobId)).status, 'succeeded');
  await assert.rejects(service.run(jobs[0].jobId), { code: 'KNOWLEDGE_EXTRACTION_NOT_RUNNABLE' });
  assert.equal((await service.get(jobs[0].jobId)).status, 'succeeded');

  const { input } = await createExtractionTaskSources(app, '-tracking-close');
  const closingJob = await service.start(input);
  const running = service.run(closingJob.jobId),
    stopped = assert.rejects(running);
  while (entered.length < 4) await new Promise(resolve => setImmediate(resolve));
  const queued = await service.start((await createExtractionTaskSources(app, '-tracking-queued')).input);
  await service.close(); // 必须已等待 direct run 的持久化失败收尾。
  assert.equal((await service.get(closingJob.jobId)).status, 'failed');
  assert.equal((await service.get(queued.jobId)).status, 'pending');
  await stopped;
  await assert.rejects(service.run(queued.jobId), { code: 'KNOWLEDGE_EXTRACTION_NOT_RUNNABLE' });
  releases.splice(0).forEach(release => release());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.dataStore.state.knowledgeItems.length, 3);
  assert.equal((await service.get(closingJob.jobId)).status, 'failed');
  assert.equal(mock.calls.length, 4);
  process.stdout.write('direct run + queued idle/close passed\n');
} finally {
  await service?.close();
  fs.rmSync(root, { recursive: true, force: true });
}

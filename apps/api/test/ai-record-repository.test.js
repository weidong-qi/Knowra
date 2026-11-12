import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileDataStore } from '../src/infrastructure/file-data-store.ts';
import { hashRecord } from '../src/modules/ai/record-contract.ts';
import { aiRecords, insertAiRecords } from './ai-record-fixtures.js';

function temporaryStore(operation, options) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-records-'));
  try {
    return operation(createFileDataStore(path.join(dir, 'data.json'), options), path.join(dir, 'data.json'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export const aiRecordRepositoryTests = [
  {
    name: 'AI JSON 私有记录原子持久化，重启可读但不进入业务导出或同步日志',
    run() {
      temporaryStore((store, file) => {
        const originalJournal = structuredClone(store.getSyncJournal());
        const records = aiRecords(store.aiRepository.identity());
        insertAiRecords(store.aiRepository, records);
        assert.deepEqual(store.getSyncJournal(), originalJournal);
        assert.equal(store.aiRepository.get('aiJob', records.job.jobId).manifestHash, records.job.manifestHash);
        assert.equal(store.aiRepository.listEvents(records.job.jobId).length, 1);
        assert.equal(JSON.stringify(store.exportSnapshot()).includes(records.job.jobId), false);
        assert.equal(JSON.stringify(fs.readFileSync(file, 'utf8')).includes('apiKey'), false);
        const reopened = createFileDataStore(file);
        assert.equal(reopened.aiRepository.get('aiUsageRecord', records.usage.usageId).usageUnknown, true);
        assert.equal(reopened.aiRepository.identity().datasetEpoch, store.aiRepository.identity().datasetEpoch);
      });
    }
  },
  {
    name: 'AI JSON 拒绝越权来源、重复幂等键、未知字段及失败写入',
    run() {
      let fail = false;
      temporaryStore(
        (store, file) => {
          const records = aiRecords(store.aiRepository.identity());
          assert.throws(
            () => store.aiRepository.insert('scopeSnapshot', { ...records.scope, apiKey: 'should-not-persist' }),
            { code: 'AI_RECORD_INVALID' }
          );
          store.aiRepository.insert('scopeSnapshot', records.scope);
          assert.throws(
            () => store.aiRepository.insert('contextManifest', { ...records.manifest, scopeHash: '0'.repeat(64) }),
            { code: 'AI_REFERENCE_INVALID' }
          );
          store.aiRepository.insert('contextManifest', records.manifest);
          store.aiRepository.insert('aiGrant', records.grant);
          assert.throws(() => store.aiRepository.insert('aiJob', { ...records.job, parentJobId: 'missing-job' }), {
            code: 'AI_REFERENCE_INVALID'
          });
          store.aiRepository.insert('aiJob', records.job);
          const duplicate = { ...records.job, jobId: 'job-duplicate', requestId: 'request-duplicate' };
          assert.equal(store.aiRepository.insert('aiJob', duplicate).jobId, records.job.jobId);
          assert.throws(() => store.aiRepository.insert('aiJob', { ...duplicate, inputHash: '0'.repeat(64) }), {
            code: 'AI_IDEMPOTENCY_CONFLICT'
          });
          assert.throws(() => store.aiRepository.insert('aiJob', { ...duplicate, modelId: 'other-model' }), {
            code: 'AI_IDEMPOTENCY_CONFLICT'
          });
          assert.throws(
            () => store.aiRepository.appendEvent({ ...records.event, safePayload: { rawMarkdown: 'secret' } }),
            { code: 'AI_RECORD_INVALID' }
          );
          assert.throws(
            () => store.aiRepository.appendEvent({ ...records.event, safePayload: { code: 'raw note content' } }),
            { code: 'AI_RECORD_INVALID' }
          );
          const before = fs.readFileSync(file, 'utf8');
          fail = true;
          assert.throws(() => store.aiRepository.insert('aiJobAttempt', records.attempt), {
            code: 'STORAGE_WRITE_FAILED'
          });
          assert.equal(store.aiRepository.get('aiJobAttempt', records.attempt.attemptId), null);
          assert.equal(fs.readFileSync(file, 'utf8'), before);
        },
        {
          writeJson(file, value) {
            if (fail) throw new Error('simulated write failure');
            fs.writeFileSync(file, JSON.stringify(value));
          }
        }
      );
    }
  },
  {
    name: 'AI JSON 导入业务快照后换 epoch，旧任务只读，CAS 拒绝过期更新',
    run() {
      temporaryStore(store => {
        const records = aiRecords(store.aiRepository.identity());
        insertAiRecords(store.aiRepository, records);
        assert.throws(
          () =>
            store.aiRepository.replace(
              'aiJob',
              { ...records.job, status: 'running', updatedAt: '2026-09-26T00:00:01.000Z' },
              '0'.repeat(64)
            ),
          { code: 'AI_RECORD_CONFLICT' }
        );
        assert.throws(
          () =>
            store.aiRepository.replace(
              'aiJob',
              {
                ...records.job,
                status: 'running',
                acceptedAttemptId: 'other-attempt',
                updatedAt: '2026-09-26T00:00:01.000Z'
              },
              hashRecord(records.job)
            ),
          { code: 'AI_REFERENCE_INVALID' }
        );
        const epoch = store.aiRepository.identity().datasetEpoch;
        store.importSnapshot(store.exportSnapshot());
        assert.notEqual(store.aiRepository.identity().datasetEpoch, epoch);
        assert.equal(store.aiRepository.get('aiJob', records.job.jobId).status, 'pending');
        assert.throws(
          () =>
            store.aiRepository.replace(
              'aiJob',
              { ...records.job, status: 'running', updatedAt: '2026-09-26T00:00:01.000Z' },
              hashRecord(records.job)
            ),
          { code: 'AI_DATASET_STALE' }
        );
        assert.throws(
          () => store.aiRepository.insert('aiJobAttempt', { ...records.attempt, attemptId: 'attempt-new' }),
          { code: 'AI_REFERENCE_INVALID' }
        );
      });
    }
  }
];

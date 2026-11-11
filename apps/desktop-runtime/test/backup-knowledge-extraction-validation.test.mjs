import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { hashRecord } from '../../api/src/modules/ai/record-contract.ts';
import { extractionCreationHash } from '../../api/src/modules/ai/knowledge-extraction-task-contract.ts';
import { createKnowledgeExtractionJobFixture } from '../../api/test/fixtures/knowledge-extraction-job.fixture.js';
import { createAppContext } from '../../api/src/app.factory.js';
import { createEmptyLocalState } from '../../api/src/infrastructure/local-data-schema.js';
import { createRuntimeBackup, inspectRuntimeBackup } from '../src/backup.mjs';
import { prepareRestoredDirectory } from '../src/restore-directory.mjs';
import { createSqliteDataStore } from '../src/sqlite-data-store.mjs';
import { temporaryDirectory, openWorkspace, removeAiTablesForLegacyFixture } from './helpers.mjs';
import { extractionBackupFixture, copyBackup, treeHashes } from './fixtures/extraction-backup.fixture.mjs';

const extensions = [
  ['knowledge_extraction_commits', 'knowledgeExtractionCommitsVersion', 'receipt_json'],
  ['ai_knowledge_extraction_tasks', 'aiKnowledgeExtractionTasksVersion', 'descriptor_json']
];
function rewriteRecord(db, [table, , column], change, { sign = true, insert = false } = {}) {
  const value = JSON.parse(db.prepare(`SELECT ${column} AS value FROM ${table}`).get().value);
  change(value);
  const field = column === 'receipt_json' ? 'receiptHash' : 'recordHash';
  if (sign) {
    if (field === 'recordHash') value.creationHash = extractionCreationHash(value);
    delete value[field];
    value[field] = hashRecord(value);
  }
  if (insert)
    db.prepare(`INSERT INTO ${table} VALUES (?, ?, ?, ?)`).run(
      value.ownerId,
      value.datasetId,
      value.jobId,
      JSON.stringify(value)
    );
  else db.prepare(`UPDATE ${table} SET ${column} = ?`).run(JSON.stringify(value));
}

function inspectUnchanged(directory, failure) {
  const before = treeHashes(directory);
  if (failure) assert.throws(() => inspectRuntimeBackup(directory), failure);
  else assert.equal(inspectRuntimeBackup(directory).valid, true);
  assert.deepEqual(treeHashes(directory), before, '源备份目录、文件和字节不得变化');
}

test('重签清单不能掩盖提炼提交或任务描述的语义损坏', async t => {
  const f = await extractionBackupFixture(t);
  for (const [table, column] of [
    ['knowledge_extraction_commits', 'receipt_json'],
    ['ai_knowledge_extraction_tasks', 'descriptor_json']
  ]) {
    await t.test(table, () => {
      const directory = copyBackup(f, table, db => db.exec(`UPDATE ${table} SET ${column} = 'null'`));
      const before = treeHashes(directory);
      assert.throws(() => inspectRuntimeBackup(directory), /提炼/);
      assert.deepEqual(treeHashes(directory), before);
    });
  }
});

test('两扩展独立版本和空表结构均校验，未知或不完整扩展不能当成旧备份', async t => {
  const f = await extractionBackupFixture(t);
  for (const [table, metadata, column] of extensions) {
    const cases = {
      future(db) {
        db.prepare('UPDATE metadata SET value = ? WHERE key = ?').run('99', metadata);
      },
      missingTable(db) {
        db.exec(`DROP TABLE ${table}`);
      },
      missingVersion(db) {
        db.prepare('DELETE FROM metadata WHERE key = ?').run(metadata);
      },
      missingColumn(db) {
        db.exec(
          `DROP TABLE ${table}; CREATE TABLE ${table} (owner_id TEXT NOT NULL, dataset_id TEXT NOT NULL, job_id TEXT NOT NULL, PRIMARY KEY(owner_id,dataset_id,job_id))`
        );
      },
      missingPrimaryKey(db) {
        db.exec(
          `DROP TABLE ${table}; CREATE TABLE ${table} (owner_id TEXT NOT NULL, dataset_id TEXT NOT NULL, job_id TEXT NOT NULL, ${column} TEXT NOT NULL)`
        );
      },
      wrongPrimaryKey(db) {
        db.exec(
          `DROP TABLE ${table}; CREATE TABLE ${table} (owner_id TEXT NOT NULL, dataset_id TEXT NOT NULL, job_id TEXT NOT NULL, ${column} TEXT NOT NULL, PRIMARY KEY(job_id,dataset_id,owner_id))`
        );
      },
      nullableColumn(db) {
        db.exec(
          `DROP TABLE ${table}; CREATE TABLE ${table} (owner_id TEXT NOT NULL, dataset_id TEXT NOT NULL, job_id TEXT NOT NULL, ${column} TEXT, PRIMARY KEY(owner_id,dataset_id,job_id))`
        );
      },
      unversionedView(db) {
        db.exec(`DROP TABLE ${table}; CREATE VIEW ${table} AS SELECT 1 AS ignored`);
        db.prepare('DELETE FROM metadata WHERE key = ?').run(metadata);
      }
    };
    for (const [name, mutate] of Object.entries(cases))
      await t.test(`${table}:${name}`, () => {
        inspectUnchanged(copyBackup(f, `${table}-${name}`, mutate), /提炼.*(版本|结构)/);
      });
  }
});

test('重签文件和外层记录hash不能掩盖坏索引、契约hash或引文', async t => {
  const f = await extractionBackupFixture(t);
  for (const extension of extensions) {
    const [table, , column] = extension;
    const hashField = column === 'receipt_json' ? 'receiptHash' : 'recordHash';
    const cases = {
      malformed(db) {
        db.prepare(`UPDATE ${table} SET ${column} = ?`).run('{"private-sentinel":');
      },
      hash(db) {
        rewriteRecord(
          db,
          extension,
          value => {
            value[hashField] = '0'.repeat(64);
          },
          { sign: false }
        );
      },
      extra(db) {
        rewriteRecord(db, extension, value => {
          value.unknown = true;
        });
      },
      index(db) {
        db.exec(`UPDATE ${table} SET owner_id = 'other-owner'`);
      }
    };
    if (column === 'receipt_json') {
      cases.quote = db =>
        rewriteRecord(db, extension, value => {
          value.result.candidates[0].citations[0].quote = '不属于输入的引文';
        });
      cases.plan = db =>
        rewriteRecord(db, extension, value => {
          value.candidates[0].candidateInput.title = '与首次计划不一致';
        });
      cases.outputHash = db =>
        rewriteRecord(db, extension, value => {
          value.outputHash = '0'.repeat(64);
        });
    } else {
      cases.creationHash = db =>
        rewriteRecord(
          db,
          extension,
          value => {
            value.creationHash = '0'.repeat(64);
            delete value.recordHash;
            value.recordHash = hashRecord(value);
          },
          { sign: false }
        );
      cases.profile = db =>
        rewriteRecord(db, extension, value => {
          value.profileVersion = 'unknown-profile';
        });
    }
    for (const [name, mutate] of Object.entries(cases))
      await t.test(`${table}:${name}`, () => {
        const directory = copyBackup(f, `${table}-content-${name}`, mutate);
        inspectUnchanged(directory, error => /提炼/.test(error.message) && !error.message.includes('private-sentinel'));
      });
  }
});

test('只比较提炼历史记录彼此的绑定；重签内外hash后不一致仍拒绝', async t => {
  const f = await extractionBackupFixture(t);
  const cases = {
    orphanDescriptor: db =>
      rewriteRecord(
        db,
        extensions[1],
        value => {
          value.jobId = 'orphan-job';
        },
        { insert: true }
      ),
    descriptorEpoch: db =>
      rewriteRecord(db, extensions[1], value => {
        value.datasetEpoch = 'wrong-epoch';
      }),
    descriptorInput: db =>
      rewriteRecord(db, extensions[1], value => {
        value.inputHash = '1'.repeat(64);
      }),
    descriptorCreatedAt: db =>
      rewriteRecord(db, extensions[1], value => {
        value.createdAt = '2026-10-01T12:00:00.000Z';
      }),
    descriptorScope: db =>
      rewriteRecord(db, extensions[1], value => {
        value.scopeId = 'another-scope';
      }),
    jobModel: db => db.exec("UPDATE ai_jobs SET model_id = 'another-model'"),
    missingSuccessReceipt: db => db.exec('DELETE FROM knowledge_extraction_commits'),
    receiptAttempt: db =>
      rewriteRecord(db, extensions[0], value => {
        value.attemptId = 'another-attempt';
      }),
    jobRequest: db => db.exec("UPDATE ai_jobs SET request_id = 'another-request'"),
    jobOutput: db => db.prepare('UPDATE ai_jobs SET output_hash = ?').run('1'.repeat(64)),
    jobPhase: db => db.exec("UPDATE ai_jobs SET phase = 'generating'"),
    jobStatus: db => db.exec("UPDATE ai_jobs SET status = 'failed'")
  };
  for (const [name, mutate] of Object.entries(cases))
    await t.test(name, () => {
      inspectUnchanged(copyBackup(f, name, mutate), /提炼记录的历史关联/);
    });
});

test('旧版无扩展和旧WAL清单兼容，重复检查不迁移或产生来源sidecar', async t => {
  const f = await extractionBackupFixture(t);
  const directory = copyBackup(f, 'legacy', db => {
    for (const [table, metadata] of extensions) {
      db.exec(`DROP TABLE ${table}`);
      db.prepare('DELETE FROM metadata WHERE key = ?').run(metadata);
    }
    removeAiTablesForLegacyFixture(db);
    db.exec('PRAGMA user_version = 3; PRAGMA journal_mode = WAL');
  });
  const manifestFile = path.join(directory, 'manifest.json'),
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  for (const item of manifest.files) delete item.size;
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  inspectUnchanged(directory);
  inspectUnchanged(directory);
});

test('02A旧配置提交可独立保留；私有任务已清理不影响历史回执检查', async t => {
  const root = temporaryDirectory(t),
    workspace = openWorkspace(path.join(root, 'data'));
  t.after(() => workspace.store.close());
  const app = createAppContext({ dataStore: workspace.store, ownerId: 'demo' });
  const f = await createKnowledgeExtractionJobFixture(app);
  const receipt = app.knowledgeExtractionCommit.commit(f.input);
  assert.equal(receipt.modelId, 'deepseek-flash');
  const backup = createRuntimeBackup(workspace.store, path.join(root, 'data'));
  inspectUnchanged(backup);
  const legacy = copyBackup({ root, backup }, '02A-without-task-extension', db => {
    db.exec(
      "DROP TABLE ai_knowledge_extraction_tasks; DELETE FROM metadata WHERE key = 'aiKnowledgeExtractionTasksVersion'"
    );
  });
  inspectUnchanged(legacy);
  const historical = copyBackup({ root, backup }, 'without-private-runtime', db => {
    db.exec('PRAGMA foreign_keys = OFF');
    for (const table of [
      'ai_knowledge_extraction_tasks',
      'ai_job_events',
      'ai_usage_records',
      'ai_job_attempts',
      'ai_jobs',
      'ai_grants',
      'ai_context_manifests',
      'ai_scope_snapshots'
    ])
      db.exec(`DELETE FROM ${table}`);
  });
  inspectUnchanged(historical);
});

test('未成功、取消、恢复为失败、零候选成功都是合法可检查备份', async t => {
  const f = await extractionBackupFixture(t, { run: false });
  const pending = f.store.aiRepository.get('aiJob', f.job.jobId);
  assert.equal(pending.status, 'pending');
  inspectUnchanged(f.backup);
  await f.service.cancel(f.job.jobId);
  inspectUnchanged(createRuntimeBackup(f.store, f.dataRoot));
  const failed = await f.service.start({ ...f.input, idempotencyKey: 'recover-pending' });
  await f.service.recover();
  assert.equal(f.store.aiRepository.get('aiJob', failed.jobId).status, 'failed');
  inspectUnchanged(createRuntimeBackup(f.store, f.dataRoot));
  assert.equal(f.mock.calls.length, 0, '检查和恢复pending记录不会调用Gateway');
  const empty = await extractionBackupFixture(t, {
    onCall(_request, response) {
      const result = JSON.parse(response.choices[0].message.content);
      result.candidates = [];
      response.choices[0].message.content = JSON.stringify(result);
      return response;
    }
  });
  inspectUnchanged(empty.backup);
  assert.equal(empty.store.state.knowledgeItems.length, 0);
});

test('候选编辑/归档/purge、来源删除、历史授权和恢复epoch均不改变历史完整性', async t => {
  const f = await extractionBackupFixture(t),
    knowledge = f.app.modules.knowledge;
  const receipt = f.store.knowledgeExtractionCommitStore.get(f.store.aiRepository.get('aiJob', f.job.jobId));
  const itemId = receipt.candidates[0].candidateInput.id;
  let item = knowledge.knowledgeItemService.getItem(itemId);
  knowledge.knowledgeItemService.updateItem(itemId, { title: '用户另行修订', expectedUpdatedAt: item.updatedAt });
  inspectUnchanged(createRuntimeBackup(f.store, f.dataRoot));
  item = knowledge.knowledgeItemService.getItem(itemId);
  knowledge.knowledgeItemService.archive(itemId, { expectedUpdatedAt: item.updatedAt });
  inspectUnchanged(createRuntimeBackup(f.store, f.dataRoot));
  item = knowledge.knowledgeItemService.getItem(itemId);
  knowledge.knowledgeItemService.trash(itemId, { expectedUpdatedAt: item.updatedAt });
  item = knowledge.repositories.knowledgeItemRepository.findById(itemId);
  knowledge.permanentlyDeleteKnowledgeItem(itemId, { expectedUpdatedAt: item.updatedAt });
  assert.equal(f.store.state.knowledgeItems.length, 0);
  knowledge.noteService.deleteNote(f.note.id);
  const grant = f.store.aiRepository.list('aiGrant')[0];
  f.store.aiRepository.replace('aiGrant', { ...grant, revokedAt: '2026-10-02T12:06:00.000Z' }, hashRecord(grant));
  const backup = createRuntimeBackup(f.store, f.dataRoot);
  inspectUnchanged(backup);
  const restoredDirectory = prepareRestoredDirectory(f.root, backup);
  const restored = createSqliteDataStore(path.join(restoredDirectory, 'local.sqlite'));
  try {
    assert.notEqual(restored.getStatus().datasetId, receipt.datasetId);
    assert.notEqual(restored.aiRepository.identity().datasetEpoch, receipt.datasetEpoch);
    inspectUnchanged(createRuntimeBackup(restored, restoredDirectory));
    assert.equal(restored.state.knowledgeItems.length, 0, '不能从历史回执复活被清理的候选');
    assert.deepEqual(restored.knowledgeExtractionCommitStore.get(receipt), receipt);
  } finally {
    restored.close();
  }
  assert.equal(f.mock.calls.length, 1, '预检及准备恢复均不重放已完成任务');
});

test('业务快照替换后历史来源空间和scope可以不存在，不据此拒绝历史提炼记录', async t => {
  const f = await extractionBackupFixture(t);
  const historical = f.store.aiRepository.get('aiJob', f.job.jobId);
  f.store.commitImport({ ...f.store.exportSnapshot(), data: createEmptyLocalState() });
  assert.equal(f.store.state.spaces.length, 0);
  assert.equal(f.store.state.analysisScopeSnapshots.length, 0);
  assert.notEqual(f.store.aiRepository.identity().datasetEpoch, historical.datasetEpoch);
  inspectUnchanged(createRuntimeBackup(f.store, f.dataRoot));
  assert.equal(f.mock.calls.length, 1);
});

test('失败重试尚未领取以及第二次attempt接纳成功均可检查，不要求首次成功', async t => {
  const f = await extractionBackupFixture(t, {
    run: false,
    onCall(_request, response, count) {
      if (count === 1) throw new Error('合成第一次响应失败');
      return response;
    }
  });
  await assert.rejects(f.service.run(f.job.jobId), /合成第一次/);
  assert.equal(f.store.aiRepository.get('aiJob', f.job.jobId).status, 'failed');
  inspectUnchanged(createRuntimeBackup(f.store, f.dataRoot));
  await f.service.retry(f.job.jobId);
  assert.equal(f.store.aiRepository.get('aiJob', f.job.jobId).status, 'retrying');
  inspectUnchanged(createRuntimeBackup(f.store, f.dataRoot));
  await f.service.run(f.job.jobId);
  const job = f.store.aiRepository.get('aiJob', f.job.jobId);
  assert.equal(job.status, 'succeeded');
  assert.equal(f.store.aiRepository.get('aiJobAttempt', job.acceptedAttemptId).ordinal, 2);
  inspectUnchanged(createRuntimeBackup(f.store, f.dataRoot));
  assert.equal(f.mock.calls.length, 2);
});

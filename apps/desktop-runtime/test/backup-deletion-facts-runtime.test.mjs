import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { startLocalRuntime } from '../src/runtime-server.mjs';
import { createRuntimeBackup, inspectRuntimeBackup } from '../src/backup.mjs';
import { createSqliteDataStore } from '../src/sqlite-data-store.mjs';
import { factHash } from '../src/sqlite-deletion-facts-contract.mjs';
import { readActiveDirectory } from '../src/restore-directory.mjs';
import { createUnavailableAiRuntime } from '../../api/src/modules/ai/runtime.js';
import { syntheticProvenanceFixture } from '../../api/test/fixtures/knowledge-artifact-provenance.fixture.js';
import { createLegacyKnowledgeArtifactProvenance } from '../../api/src/modules/knowledge/domain/knowledge-artifact-provenance-contract.ts';
import { syncContract } from '../../api/src/modules/sync/protocol-contract.ts';
import { temporaryDirectory } from './helpers.mjs';
import { mutateBackup, treeHashes } from './fixtures/extraction-backup.fixture.mjs';

async function setup(t, overrides = {}) {
  const root = temporaryDirectory(t),
    distRoot = path.join(root, 'dist');
  fs.mkdirSync(distRoot);
  fs.writeFileSync(path.join(distRoot, 'index.html'), '<html><body>合成恢复事实验收</body></html>');
  const options = {
    dataDirectory: path.join(root, 'data'),
    distRoot,
    syncOptions: {
      autoSync: false,
      fetcher: async () => {
        throw new Error('合成测试禁止外部请求');
      }
    },
    logger: { error() {}, warn() {} },
    aiRuntimeFactory: () => createUnavailableAiRuntime('合成测试关闭 AI。'),
    ...overrides
  };
  let runtime = await startLocalRuntime(options),
    cookie;
  const connect = async () => {
    cookie = (await fetch(runtime.launchUrl, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
  };
  await connect();
  t.after(() => runtime.close());
  const request = async (route, method = 'GET', body) => {
    const response = await fetch(`${runtime.origin}${route}`, {
      method,
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-Knowra-Dataset': runtime.store.getStatus().datasetId
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, ...(await response.json()) };
  };
  const created = await request('/api/knowledge/spaces/default', 'POST', {});
  assert.equal(created.status, 201, JSON.stringify(created));
  return {
    root,
    options,
    request,
    space: created.data,
    runtime: () => runtime,
    async backup() {
      const result = await request('/api/local-runtime/backup', 'POST', {});
      assert.equal(result.status, 201, JSON.stringify(result));
      return result.data;
    },
    async tag(id) {
      const result = await request('/api/knowledge/tags', 'POST', {
        id,
        name: id.slice(-25),
        spaceId: created.data.id
      });
      assert.equal(result.status, 201, JSON.stringify(result));
      return result.data;
    },
    async removeTag(id) {
      const result = await request(`/api/knowledge/tags/${id}`, 'DELETE');
      assert.equal(result.status, 200, JSON.stringify(result));
    },
    async restore(backup) {
      return request(`/api/local-runtime/backups/${backup.id}/restore`, 'POST', { confirmBackupId: backup.id });
    },
    async restart() {
      await runtime.close();
      runtime = await startLocalRuntime(options);
      await connect();
    }
  };
}

function state(store) {
  return {
    data: store.exportSnapshot().data,
    outbox: store.readOutbox(),
    facts: store.deletionFacts.list(),
    datasetId: store.getStatus().datasetId
  };
}
function stableAttachmentState(snapshot) {
  const stable = structuredClone(snapshot);
  // 重建 storage owner 会重新核验附件，只有派生的验证时间允许刷新。
  for (const attachment of stable.data.attachments) delete attachment.verifiedAt;
  return stable;
}

const metadata = (store, key) =>
  store.readSync(db => db.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value);
const factRows = store =>
  store.readSync(db => db.prepare('SELECT * FROM deletion_facts ORDER BY collection,entity_id').all());
function setBinding(db, binding) {
  db.exec("DELETE FROM metadata WHERE key IN ('sync:serverUrl','sync:ownerId')");
  for (const [key, value] of Object.entries(binding))
    db.prepare('INSERT INTO metadata VALUES (?,?)').run(`sync:${key}`, JSON.stringify(value));
}
function deleteSyntheticTag(store, spaceId, id) {
  store.runTransaction(() => {
    store.state.tags.push({ id, name: id.slice(-25), spaceId, isSystem: false });
  });
  store.runTransaction(() => {
    store.state.tags = store.state.tags.filter(tag => tag.id !== id);
  });
  assert.equal(store.deletionFacts.has('tags', id), true);
}
async function assertConflict(app, backup, code) {
  const before = state(app.runtime().store),
    bytes = treeHashes(backup.directory);
  assert.equal(inspectRuntimeBackup(backup.directory).valid, true);
  for (const action of ['inspect', 'restore']) {
    const result = await app.request(`/api/local-runtime/backups/${backup.id}/${action}`, 'POST', {
      confirmBackupId: backup.id
    });
    assert.equal(result.status, 409, JSON.stringify(result));
    assert.equal(result.error.code, code);
  }
  assert.deepEqual(state(app.runtime().store), before);
  assert.deepEqual(treeHashes(backup.directory), bytes);
  assert.equal(readActiveDirectory(app.options.dataDirectory), app.options.dataDirectory);
  assert.equal((await app.request('/api/local-runtime/status')).status, 200);
}

test('C2 基线反例：当前删除事实阻止旧备份恢复 subject；intrinsic inspect 仍有效且不变', async t => {
  const app = await setup(t),
    id = 'synthetic-restored-deleted-tag';
  await app.tag(id);
  const backup = await app.backup();
  await app.removeTag(id);
  assert.equal(app.runtime().store.deletionFacts.has('tags', id), true);
  const before = state(app.runtime().store),
    bytes = treeHashes(backup.directory);
  assert.equal(inspectRuntimeBackup(backup.directory).valid, true);
  const checked = await app.request(`/api/local-runtime/backups/${backup.id}/inspect`, 'POST', {});
  const restored = await app.restore(backup);
  t.diagnostic(
    JSON.stringify({
      checked,
      restored,
      sourceUnchanged: JSON.stringify(treeHashes(backup.directory)) === JSON.stringify(bytes)
    })
  );
  assert.equal(checked.status, 409, JSON.stringify(checked));
  assert.equal(checked.error.code, 'LOCAL_RESTORE_DELETION_CONFLICT');
  assert.equal(restored.status, 409, JSON.stringify(restored));
  assert.equal(restored.error.code, 'LOCAL_RESTORE_DELETION_CONFLICT');
  assert.deepEqual(state(app.runtime().store), before);
  assert.equal(readActiveDirectory(app.options.dataDirectory), app.options.dataDirectory);
  assert.deepEqual(treeHashes(backup.directory), bytes);
  assert.equal((await app.request('/api/local-runtime/status')).status, 200);
  await app.tag('synthetic-after-rejection');
});

test('C2 候选自己的删除事实与候选 live subject 冲突，完整格式备份返回409而不是损坏', async t => {
  const app = await setup(t),
    id = 'synthetic-candidate-live';
  const candidateRoot = path.join(app.root, 'candidate'),
    candidate = createSqliteDataStore(path.join(candidateRoot, 'local.sqlite'));
  let backup;
  try {
    candidate.importSnapshot(app.runtime().store.exportSnapshot());
    deleteSyntheticTag(candidate, app.space.id, id);
    const directory = createRuntimeBackup(candidate, candidateRoot, { backupRoot: app.options.dataDirectory });
    backup = { id: path.basename(directory), directory };
  } finally {
    candidate.close();
  }
  assert.equal(
    app.runtime().store.deletionFacts.has('tags', id),
    false,
    '当前库没有这条事实，必须由候选自己的账本拒绝'
  );
  mutateBackup(backup.directory, db => {
    db.prepare('INSERT INTO entities VALUES (?,?,?,?)').run(
      'tags',
      id,
      JSON.stringify({ id, name: '候选自身已删除标签', spaceId: app.space.id, isSystem: false }),
      1
    );
  });
  await assertConflict(app, backup, 'LOCAL_RESTORE_DELETION_CONFLICT');
});

test('C2 无冲突恢复合并两侧事实，current同键原字节优先、scope及coverage起点保持，候选独有事实remap后重启仍拒绝复活', async t => {
  const app = await setup(t),
    current = app.runtime().store;
  deleteSyntheticTag(current, app.space.id, 'synthetic-shared');
  deleteSyntheticTag(current, app.space.id, 'synthetic-current-only');
  const oldBackup = await app.backup();
  const candidateRoot = path.join(app.root, 'candidate'),
    candidate = createSqliteDataStore(path.join(candidateRoot, 'local.sqlite'));
  let backup, candidateUnique;
  try {
    candidate.importSnapshot(current.exportSnapshot());
    deleteSyntheticTag(candidate, app.space.id, 'synthetic-shared');
    deleteSyntheticTag(candidate, app.space.id, 'synthetic-candidate-only');
    candidateUnique = candidate.deletionFacts.list().find(row => row.entityId === 'synthetic-candidate-only');
    candidate.metadataTransaction(db => {
      const coverage = candidate.deletionFacts.getCoverage();
      db.prepare('UPDATE metadata SET value=? WHERE key=?').run(
        JSON.stringify({ ...coverage, recordedSince: '2020-01-01T00:00:00.000Z', legacyHistory: 'incomplete' }),
        'deletionFactsCoverage'
      );
    });
    const directory = createRuntimeBackup(candidate, candidateRoot, { backupRoot: app.options.dataDirectory });
    backup = { id: path.basename(directory), directory };
  } finally {
    candidate.close();
  }
  const scope = metadata(current, 'deletionFactsScope'),
    coverage = current.deletionFacts.getCoverage();
  const rows = factRows(current),
    sourceBytes = treeHashes(backup.directory);
  const checked = await app.request(`/api/local-runtime/backups/${backup.id}/inspect`, 'POST', {});
  assert.equal(checked.status, 200, JSON.stringify(checked));
  const restored = await app.restore(backup);
  assert.equal(restored.status, 200, JSON.stringify(restored));
  assert.equal(restored.data.syncPaused, true);
  const active = app.runtime().store,
    actual = factRows(active);
  assert.equal(actual.length, 3);
  for (const row of rows)
    assert.deepEqual(
      actual.find(item => item.entity_id === row.entity_id),
      row
    );
  assert.equal(metadata(active, 'deletionFactsScope'), scope);
  assert.equal(active.deletionFacts.getCoverage().recordedSince, coverage.recordedSince);
  assert.equal(active.deletionFacts.getCoverage().legacyHistory, 'incomplete');
  const targetScope = JSON.parse(scope),
    remapped = { ...candidateUnique, scopeId: targetScope.scopeId, ownerId: targetScope.ownerId };
  remapped.observationId = factHash([targetScope.scopeId, remapped.collection, remapped.entityId, remapped.source]);
  const uniqueRow = actual.find(row => row.entity_id === remapped.entityId);
  assert.deepEqual(JSON.parse(uniqueRow.record_json), remapped);
  assert.equal(uniqueRow.record_hash, factHash(remapped));
  assert.deepEqual(treeHashes(backup.directory), sourceBytes);
  const retained = createSqliteDataStore(path.join(app.options.dataDirectory, 'local.sqlite'));
  try {
    assert.deepEqual(factRows(retained), rows);
  } finally {
    retained.close();
  }
  await app.restart();
  assert.deepEqual(factRows(app.runtime().store), actual);
  for (const id of ['synthetic-shared', 'synthetic-current-only', 'synthetic-candidate-only']) {
    const result = await app.request('/api/knowledge/tags', 'POST', { id, name: id, spaceId: app.space.id });
    assert.equal(result.status, 409, JSON.stringify(result));
    assert.equal(result.error.code, 'LOCAL_DELETION_FACT_CONFLICT');
  }
  assert.equal(inspectRuntimeBackup(oldBackup.directory).valid, true);
});

const binding = { serverUrl: 'https://synthetic.invalid', ownerId: 'demo' };
for (const side of ['current', 'candidate'])
  for (const key of ['serverUrl', 'ownerId']) {
    test(`C2 partial binding拒绝：${side}仅${key}，另一侧全缺`, async t => {
      const app = await setup(t),
        backup = await app.backup();
      const partial = { [key]: binding[key] };
      if (side === 'current') app.runtime().store.metadataTransaction(db => setBinding(db, partial));
      else mutateBackup(backup.directory, db => setBinding(db, partial));
      await assertConflict(app, backup, 'LOCAL_RESTORE_BINDING_CONFLICT');
    });
  }
for (const scenario of ['both-absent', 'retain-current', 'adopt-candidate', 'same-binding']) {
  test(`C2 binding兼容恢复：${scenario}，保留或接纳完整绑定且同步暂停`, async t => {
    const app = await setup(t),
      backup = await app.backup();
    if (['retain-current', 'same-binding'].includes(scenario))
      app.runtime().store.metadataTransaction(db => setBinding(db, binding));
    if (['adopt-candidate', 'same-binding'].includes(scenario))
      mutateBackup(backup.directory, db => setBinding(db, binding));
    const bytes = treeHashes(backup.directory),
      restored = await app.restore(backup);
    assert.equal(restored.status, 200, JSON.stringify(restored));
    const expected = scenario === 'both-absent' ? {} : binding;
    for (const key of ['serverUrl', 'ownerId'])
      assert.equal(
        metadata(app.runtime().store, `sync:${key}`),
        expected[key] === undefined ? undefined : JSON.stringify(expected[key])
      );
    assert.equal(metadata(app.runtime().store, 'sync:clientPaused'), 'true');
    assert.deepEqual(treeHashes(backup.directory), bytes);
    await app.restart();
    assert.equal(metadata(app.runtime().store, 'sync:clientPaused'), 'true');
    for (const key of ['serverUrl', 'ownerId'])
      assert.equal(
        metadata(app.runtime().store, `sync:${key}`),
        expected[key] === undefined ? undefined : JSON.stringify(expected[key])
      );
  });
}
for (const key of ['serverUrl', 'ownerId']) {
  test(`C2 完整绑定${key}不匹配时拒绝恢复`, async t => {
    const app = await setup(t),
      backup = await app.backup();
    app.runtime().store.metadataTransaction(db => setBinding(db, binding));
    mutateBackup(backup.directory, db =>
      setBinding(db, {
        ...binding,
        [key]: key === 'serverUrl' ? 'https://other-synthetic.invalid' : 'synthetic-other-owner'
      })
    );
    await assertConflict(app, backup, 'LOCAL_RESTORE_BINDING_CONFLICT');
  });
}

async function reached(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('未到达合成恢复边界')), 2000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function addAttachment(app, noteId) {
  const result = await app.request('/api/storage/attachments', 'POST', {
    noteId,
    fileName: 'synthetic.txt',
    contentBase64: Buffer.from('synthetic-preserved-attachment').toString('base64')
  });
  assert.equal(result.status, 201, JSON.stringify(result));
  return result.data;
}

for (const late of ['deletion', 'recorded-provenance', 'partial-binding']) {
  test(
    `C2 final fresh检查：sync.close后AI.close排空中晚提交${late}，409并恢复旧服务/指针/附件/草稿`,
    { timeout: 8000 },
    async t => {
      const stopping = Promise.withResolvers(),
        release = Promise.withResolvers();
      let generations = 0,
        armed = false,
        commitLate,
        expected;
      const app = await setup(t, {
        aiRuntimeFactory: () => {
          const generation = ++generations;
          return {
            agent: {
              recover() {},
              async close() {
                if (generation === 2 && armed) {
                  stopping.resolve();
                  await release.promise;
                  commitLate();
                }
              }
            }
          };
        }
      });
      const synthetic = syntheticProvenanceFixture();
      synthetic.state.knowledgeArtifactProvenance.push(createLegacyKnowledgeArtifactProvenance(synthetic.artifactId));
      app.runtime().store.importSnapshot({ schemaVersion: 7, data: synthetic.state });
      const id = 'synthetic-late-deleted';
      if (late === 'deletion')
        app.runtime().store.runTransaction(() => {
          app.runtime().store.state.tags.push({
            id,
            name: '晚删除合成标签',
            spaceId: synthetic.state.spaces[0].id,
            isSystem: false
          });
        });
      const attachment = await addAttachment(app, synthetic.state.notes[0].id);
      const drafts = {
        version: 1,
        drafts: { 'knowra:note-draft:v1:["synthetic","note"]': { markdown: '合成当前草稿', baseMarkdown: '合成原文' } }
      };
      const draftFile = path.join(app.options.dataDirectory, 'recovery-drafts.json');
      fs.writeFileSync(draftFile, JSON.stringify(drafts));
      const backup = await app.backup();
      assert.equal((await app.restore(backup)).status, 200);
      const oldStore = app.runtime().store,
        oldDirectory = readActiveDirectory(app.options.dataDirectory);
      const pointerFile = path.join(app.options.dataDirectory, 'active-dataset.json');
      const pointerBytes = fs.readFileSync(pointerFile),
        sourceBytes = treeHashes(backup.directory),
        draftBytes = fs.readFileSync(draftFile);
      const attachmentFile = path.join(oldDirectory, 'uploads', `${attachment.id}-${attachment.fileName}`),
        attachmentBytes = fs.readFileSync(attachmentFile);
      assert.equal((await app.request(`/api/local-runtime/backups/${backup.id}/inspect`, 'POST', {})).status, 200);
      commitLate = () => {
        if (late === 'partial-binding')
          oldStore.metadataTransaction(db => setBinding(db, { serverUrl: binding.serverUrl }));
        else
          oldStore.runTransaction(() => {
            if (late === 'deletion') oldStore.state.tags = oldStore.state.tags.filter(tag => tag.id !== id);
            else oldStore.state.knowledgeArtifactProvenance[0] = structuredClone(synthetic.provenance);
          });
        expected = state(oldStore);
      };
      armed = true;
      const restoring = app.restore(backup);
      try {
        await reached(stopping.promise);
        assert.equal((await app.request('/api/local-runtime/status')).status, 503);
        assert.deepEqual(fs.readFileSync(pointerFile), pointerBytes);
        release.resolve();
        const result = await restoring;
        assert.equal(result.status, 409, JSON.stringify(result));
        assert.equal(
          result.error.code,
          {
            deletion: 'LOCAL_RESTORE_DELETION_CONFLICT',
            'recorded-provenance': 'LOCAL_RESTORE_PROVENANCE_CONFLICT',
            'partial-binding': 'LOCAL_RESTORE_BINDING_CONFLICT'
          }[late]
        );
        assert.equal(generations, 3, '失败后重建原资料服务，而不是继续使用已关闭owner');
        assert.deepEqual(stableAttachmentState(state(app.runtime().store)), stableAttachmentState(expected));
        assert.deepEqual(fs.readFileSync(pointerFile), pointerBytes);
        assert.deepEqual(fs.readFileSync(draftFile), draftBytes);
        assert.deepEqual(fs.readFileSync(attachmentFile), attachmentBytes);
        assert.deepEqual(treeHashes(backup.directory), sourceBytes);
        assert.equal(readActiveDirectory(app.options.dataDirectory), oldDirectory);
        assert.equal((await app.request('/api/local-runtime/status')).status, 200);
        const saved = await app.request(`/api/knowledge/notes/${synthetic.state.notes[0].id}`, 'PATCH', {
          rawMarkdown: '合成失败后保存',
          expectedUpdatedAt: app.runtime().store.state.notes[0].updatedAt
        });
        assert.equal(saved.status, 200, JSON.stringify(saved));
        await app.restart();
        assert.equal(app.runtime().store.state.notes[0].rawMarkdown, '合成失败后保存');
        if (late === 'deletion') assert.equal(app.runtime().store.deletionFacts.has('tags', id), true);
        else if (late === 'recorded-provenance')
          assert.equal(app.runtime().store.state.knowledgeArtifactProvenance[0].state, 'recorded');
        else {
          assert.equal(metadata(app.runtime().store, 'sync:serverUrl'), JSON.stringify(binding.serverUrl));
          assert.equal(metadata(app.runtime().store, 'sync:ownerId'), undefined);
        }
      } finally {
        release.resolve();
        await restoring;
      }
    }
  );
}

test('C2 恢复暂停同步且新owner不继承原同步凭据，来源备份也无凭据内容', async t => {
  const requests = [],
    username = 'synthetic-memory-user',
    password = 'synthetic-memory-password';
  const app = await setup(t, {
    syncOptions: {
      autoSync: false,
      fetcher: async (url, options) => {
        requests.push({ url, authorization: options.headers.Authorization });
        if (requests.length === 1)
          return Response.json({
            data: {
              protocolVersion: 1,
              scope: 'notes',
              ...syncContract(),
              ownerId: 'demo',
              datasetEpoch: 'synthetic-epoch'
            }
          });
        return Response.json({ error: { code: 'SYNTHETIC_OFFLINE', message: '合成通道停止同步' } }, { status: 503 });
      }
    }
  });
  app.runtime().store.metadataTransaction(db => setBinding(db, binding));
  const configured = await app.request('/api/local-runtime/sync/configure', 'POST', {
    serverUrl: binding.serverUrl,
    username,
    password
  });
  assert.equal(configured.status, 200, JSON.stringify(configured));
  assert(requests.length >= 2);
  assert(
    requests.every(
      request => request.authorization === `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
    )
  );
  const backup = await app.backup(),
    bytes = fs.readFileSync(path.join(backup.directory, 'local.sqlite'));
  for (const secret of [username, password, requests[0].authorization])
    assert.equal(bytes.includes(Buffer.from(secret)), false);
  assert.equal((await app.restore(backup)).status, 200);
  assert.equal(metadata(app.runtime().store, 'sync:clientPaused'), 'true');
  const count = requests.length;
  assert.equal((await app.request('/api/local-runtime/sync/retry', 'POST', {})).status, 200);
  assert.equal(requests.length, count, '暂停状态不能联系合成同步通道');
  // 只改变测试库暂停标记来观察新owner首次请求；configure会主动重置凭据，不可用于这个断言。
  app
    .runtime()
    .store.metadataTransaction(db =>
      db.prepare('UPDATE metadata SET value=? WHERE key=?').run('false', 'sync:clientPaused')
    );
  assert.equal((await app.request('/api/local-runtime/sync/retry', 'POST', {})).status, 200);
  assert.equal(requests.length, count + 1);
  assert.equal(requests.at(-1).authorization, undefined);
});

for (const failure of ['candidate-transaction', 'pointer-publication']) {
  test(`C2 ${failure}失败保留旧完整资料及指针，重建服务后可编辑`, async t => {
    const app = await setup(t),
      backup = await app.backup();
    assert.equal((await app.restore(backup)).status, 200);
    const sourceScope = { schemaVersion: 1, scopeId: 'synthetic-rollback-candidate-scope', ownerId: 'demo' };
    mutateBackup(backup.directory, db => {
      db.prepare('UPDATE metadata SET value=? WHERE key=?').run(JSON.stringify(sourceScope), 'deletionFactsScope');
    });
    deleteSyntheticTag(app.runtime().store, app.space.id, 'synthetic-rollback-fact');
    const before = state(app.runtime().store),
      sourceBytes = treeHashes(backup.directory);
    const pointerFile = path.join(app.options.dataDirectory, 'active-dataset.json'),
      pointerBytes = fs.readFileSync(pointerFile);
    const oldDirectory = readActiveDirectory(app.options.dataDirectory),
      candidateRows = [];
    const originalExec = DatabaseSync.prototype.exec,
      originalRename = fs.renameSync;
    let injected = 0;
    try {
      if (failure === 'candidate-transaction')
        DatabaseSync.prototype.exec = function (sql) {
          if (sql === 'DELETE FROM deletion_facts' && injected++ === 0) {
            candidateRows.push(...this.prepare('SELECT * FROM deletion_facts ORDER BY collection,entity_id').all());
            throw new Error('synthetic-final-transaction-failure');
          }
          return originalExec.call(this, sql);
        };
      else
        fs.renameSync = function (source, target, ...rest) {
          if (String(target) === pointerFile) {
            injected++;
            throw new Error('synthetic-pointer-failure');
          }
          return originalRename.call(this, source, target, ...rest);
        };
      const result = await app.restore(backup);
      assert.equal(result.status, 422, JSON.stringify(result));
      assert.equal(result.error.code, 'LOCAL_BACKUP_FAILED');
      assert.equal(injected, 1);
    } finally {
      DatabaseSync.prototype.exec = originalExec;
      fs.renameSync = originalRename;
    }
    assert.deepEqual(state(app.runtime().store), before);
    assert.deepEqual(fs.readFileSync(pointerFile), pointerBytes);
    assert.deepEqual(treeHashes(backup.directory), sourceBytes);
    assert.equal(readActiveDirectory(app.options.dataDirectory), oldDirectory);
    if (failure === 'candidate-transaction') {
      const directories = fs
        .readdirSync(path.join(app.options.dataDirectory, 'restored'))
        .map(name => path.join(app.options.dataDirectory, 'restored', name));
      const failed = directories.find(directory => directory !== oldDirectory);
      const db = new DatabaseSync(path.join(failed, 'local.sqlite'), { readOnly: true });
      try {
        assert.deepEqual(db.prepare('SELECT * FROM deletion_facts ORDER BY collection,entity_id').all(), candidateRows);
        assert.equal(
          db.prepare("SELECT value FROM metadata WHERE key='deletionFactsScope'").get().value,
          JSON.stringify(sourceScope),
          '事务失败须回滚已写的current scope'
        );
      } finally {
        db.close();
      }
    }
    await app.tag(`synthetic-${failure}`);
    await app.restart();
    assert.equal(app.runtime().store.deletionFacts.has('tags', 'synthetic-rollback-fact'), true);
  });
}

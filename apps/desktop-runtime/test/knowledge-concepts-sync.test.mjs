import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { once } from 'node:events';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.ts';
import { createAppContext } from '../../api/src/app.factory.ts';
import { createServer } from '../../api/src/server.ts';
import { createAttachmentTransfer } from '../../api/src/modules/sync/attachment-transfer.ts';
import {
  createKnowledgeConceptService,
  createStateBackedConceptStore
} from '../../api/src/modules/knowledge-concepts/service.ts';
import { createSyncEngine } from '../src/sync-engine.mjs';
import { temporaryDirectory, openWorkspace } from './helpers.mjs';

test('概念在两台 SQLite 设备间同步：直接合并、三集合原子迁移、重启和幂等', async t => {
  const root = temporaryDirectory(t);
  const cloudStore = createFileDataStore(path.join(root, 'cloud.json'));
  const context = createAppContext({
    dataStore: cloudStore,
    storageRootDir: root,
    uploadsDir: path.join(root, 'uploads')
  });
  context.modules.knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const server = createServer({ appContext: context, logger: { error() {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const devices = [];
  const device = name => {
    const directory = path.join(root, name);
    const workspace = openWorkspace(directory);
    const concepts = createKnowledgeConceptService({ store: createStateBackedConceptStore(workspace.store) });
    const engine = createSyncEngine(workspace.store, {
      autoSync: false,
      fetcher: fetch,
      noteService: workspace.knowledge.noteService,
      entityTransfer: createAttachmentTransfer({
        uploadsDir: path.join(directory, 'uploads'),
        storageRootDir: directory
      })
    });
    const value = { ...workspace, concepts, engine };
    devices.push(value);
    return value;
  };
  t.after(async () => {
    for (const device of devices) {
      await device.engine.close();
      device.store.close();
    }
  });
  const a = device('a');
  const b = device('b');
  await a.engine.configure({ serverUrl: origin });
  await b.engine.configure({ serverUrl: origin });
  a.knowledge.knowledgeItemService.createCandidate({
    id: 'k',
    title: '手工知识',
    canonicalStatement: '关系说明',
    knowledgeType: 'concept',
    sourceMode: 'manual'
  });
  await a.concepts.execute({
    type: 'createConcept',
    id: 'a',
    name: 'CNN',
    itemIds: ['k'],
    expectedRevision: 0,
    operationId: 'create-a'
  });
  await a.concepts.execute({
    type: 'createConcept',
    id: 'b',
    name: '卷积神经网络',
    itemIds: ['k'],
    expectedRevision: 0,
    operationId: 'create-b'
  });
  await a.concepts.execute({
    type: 'createRelation',
    id: 'a',
    expectedRevision: 1,
    operationId: 'create-r',
    relationId: 'r',
    toConceptId: 'b',
    relationType: 'relatedTo',
    basisItemId: null
  });
  await a.engine.sync();
  await b.engine.sync();
  assert.equal((await b.concepts.list()).concepts.length, 2);
  await a.concepts.execute({
    type: 'mergeConcept',
    id: 'a',
    expectedRevision: 2,
    operationId: 'merge',
    targetId: 'b',
    expectedTargetRevision: 1
  });
  await a.engine.sync();
  await b.engine.sync();
  assert.equal(b.engine.status().entityConflict, null);
  assert.equal((await b.concepts.list()).concepts.length, 1);
  assert.equal((await b.concepts.list()).relations.length, 0);
  assert.equal((await b.concepts.list()).links.length, 1);
  assert.deepEqual((await b.concepts.list()).concepts[0].aliases, ['CNN']);
  assert.equal(cloudStore.state.knowledgeConcepts.find(row => row.id === 'a').mergedInto, 'b');
  await b.engine.close();
  b.store.close();
  devices.splice(devices.indexOf(b), 1);
  const reopened = device('b');
  assert.equal((await reopened.concepts.list()).links.length, 1);
  const revision = (await reopened.concepts.list()).concepts[0].revision;
  await reopened.concepts.execute({
    type: 'mergeConcept',
    id: 'a',
    expectedRevision: 2,
    operationId: 'merge',
    targetId: 'b',
    expectedTargetRevision: 1
  });
  assert.equal((await reopened.concepts.list()).concepts[0].revision, revision);
});

test('SQLite 概念三集合及命令回执随备份保留，复制恢复后可正常读取', async t => {
  const { createRuntimeBackup, inspectRuntimeBackup } = await import('../src/backup.mjs');
  const { createSqliteDataStore } = await import('../src/sqlite-data-store.mjs');
  const fs = await import('node:fs');
  const root = temporaryDirectory(t);
  const directory = path.join(root, 'source');
  const source = openWorkspace(directory);
  t.after(() => source.store.close());
  source.knowledge.knowledgeItemService.createCandidate({
    id: 'k',
    title: '手工知识',
    canonicalStatement: '关系说明',
    knowledgeType: 'concept',
    sourceMode: 'manual'
  });
  const service = createKnowledgeConceptService({ store: createStateBackedConceptStore(source.store) });
  for (const id of ['a', 'b'])
    await service.execute({
      type: 'createConcept',
      id,
      operationId: `create-${id}`,
      expectedRevision: 0,
      name: id,
      itemIds: ['k']
    });
  await service.execute({
    type: 'createRelation',
    id: 'a',
    operationId: 'relation',
    expectedRevision: 1,
    relationId: 'r',
    toConceptId: 'b',
    relationType: 'relatedTo',
    basisItemId: 'k'
  });
  const backup = createRuntimeBackup(source.store, directory);
  assert.doesNotThrow(() => inspectRuntimeBackup(backup));
  const restoredPath = path.join(root, 'restored', 'local.sqlite');
  fs.mkdirSync(path.dirname(restoredPath));
  fs.copyFileSync(path.join(backup, 'local.sqlite'), restoredPath);
  const restored = createSqliteDataStore(restoredPath);
  try {
    assert.equal(restored.state.knowledgeConcepts.length, 2);
    assert.equal(restored.state.knowledgeConceptLinks.length, 2);
    assert.equal(restored.state.knowledgeConceptRelations.length, 1);
    assert.equal(restored.state.knowledgeConcepts.find(row => row.id === 'a').operations.length, 2);
  } finally {
    restored.close();
  }
});

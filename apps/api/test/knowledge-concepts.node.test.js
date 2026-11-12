import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createFileDataStore } from '../src/infrastructure/file-data-store.ts';
import { createAppContext } from '../src/app.factory.ts';
import { createServer } from '../src/server.ts';
import { createKnowledgeConceptService } from '../src/modules/knowledge-concepts/service.ts';
import {
  LOCAL_DATA_SCHEMA_VERSION,
  validatePersistedLocalState,
  createEmptyLocalState
} from '../src/infrastructure/local-data-schema.ts';
import { createPostgresAppContext } from '../src/postgres-app.factory.ts';
import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';

test('概念 HTTP、JSON 重启、幂等和失败事务', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-concepts-api-'));
  const file = path.join(root, 'cloud.json');
  const dataStore = createFileDataStore(file);
  const app = createAppContext({ dataStore, storageRootDir: root });
  const server = createServer({ appContext: app, logger: { error() {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await server.closeAi?.();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/api/knowledge/concepts`;
  const call = command =>
    fetch(`${base}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command })
    });
  const command = { type: 'createConcept', id: 'a', operationId: 'create-a', expectedRevision: 0, name: '链式法则' };
  assert.equal((await call(command)).status, 200);
  assert.equal((await call(command)).status, 200);
  assert.equal(
    (await createAppContext({ dataStore: createFileDataStore(file), storageRootDir: root }).knowledgeConcepts.list())
      .concepts[0].revision,
    1
  );
  assert.equal((await call({ ...command, name: '另一个名称' })).status, 409);
  const invalid = await call({
    type: 'linkItems',
    id: 'a',
    operationId: 'link-missing',
    expectedRevision: 1,
    itemIds: ['missing'],
    role: 'subject'
  });
  assert.equal(invalid.status, 404);
  assert.equal((await app.knowledgeConcepts.list()).concepts[0].revision, 1);
  assert.equal(
    (
      await call({
        type: 'createConcept',
        id: 'b',
        operationId: 'ai-source',
        expectedRevision: 0,
        name: 'AI',
        sourceMode: 'ai'
      })
    ).status,
    422
  );
  const listed = await (await fetch(base)).json();
  assert.equal(listed.data.concepts.length, 1);
  await assert.rejects(createKnowledgeConceptService({ store: null }).list(), {
    code: 'KNOWLEDGE_CONCEPTS_UNAVAILABLE',
    statusCode: 503
  });
});

test('旧 JSON 文件自动补空集合，非法引用拒绝写入', () => {
  const old = createEmptyLocalState();
  delete old.knowledgeConcepts;
  delete old.knowledgeConceptLinks;
  delete old.knowledgeConceptRelations;
  const migrated = validatePersistedLocalState({ schemaVersion: 8, ...old });
  assert.deepEqual(migrated.knowledgeConcepts, []);
  assert.equal(LOCAL_DATA_SCHEMA_VERSION, 9);
});

test(
  '真实 PostgreSQL：概念三集合、跨实例并发与快照恢复',
  { skip: !process.env.KNOWRA_SYNC_TEST_DATABASE_URL },
  async t => {
    const database = await createPostgresTestDatabase();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-concepts-pg-'));
    const app = await createPostgresAppContext({ databaseUrl: database.databaseUrl, storageRootDir: root });
    let peer;
    t.after(async () => {
      await peer?.close();
      await app.close();
      await database.close();
      fs.rmSync(root, { recursive: true, force: true });
    });
    await app.modules.knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
    await app.modules.knowledge.knowledgeItemService.createCandidate({
      id: 'k',
      title: '手工知识',
      canonicalStatement: '关系说明',
      knowledgeType: 'concept',
      sourceMode: 'manual'
    });
    peer = await createPostgresAppContext({
      databaseUrl: database.databaseUrl,
      storageRootDir: path.join(root, 'peer')
    });
    const create = id =>
      app.knowledgeConcepts.execute({
        type: 'createConcept',
        id,
        operationId: `create-${id}`,
        expectedRevision: 0,
        name: id,
        itemIds: ['k']
      });
    await create('a');
    await create('b');
    await app.knowledgeConcepts.execute({
      type: 'createRelation',
      id: 'a',
      operationId: 'relation',
      expectedRevision: 1,
      relationId: 'r',
      toConceptId: 'b',
      relationType: 'relatedTo',
      basisItemId: 'k'
    });
    const conflicts = await Promise.allSettled(
      ['first', 'second'].map((name, index) =>
        (index ? peer : app).knowledgeConcepts.execute({
          type: 'updateConcept',
          id: 'a',
          operationId: name,
          expectedRevision: 2,
          patch: { sense: name }
        })
      )
    );
    assert.equal(conflicts.filter(result => result.status === 'fulfilled').length, 1);
    const snapshot = await app.http.storage.exportKnowledgeBase();
    assert.equal(snapshot.data.knowledgeConcepts.length, 2);
    assert.equal(snapshot.data.knowledgeConceptRelations.length, 1);
    await app.http.storage.importKnowledgeBase(snapshot);
    assert.equal((await app.knowledgeConcepts.list()).relations[0].id, 'r');
    assert.equal((await app.knowledgeConcepts.list()).links.length, 2);
    const item = await app.modules.knowledge.knowledgeItemService.getItem('k');
    const trashed = await app.modules.knowledge.knowledgeItemService.trash('k', { expectedUpdatedAt: item.updatedAt });
    const preview = await app.modules.knowledge.inspectKnowledgePurge('k');
    assert.deepEqual(preview.conceptCleanup, { links: 2, relations: 1 });
    await app.modules.knowledge.permanentlyDeleteKnowledgeItem('k', { expectedUpdatedAt: trashed.updatedAt });
    const after = await app.knowledgeConcepts.list();
    assert.equal(after.links.length, 0);
    assert.equal(after.relations.length, 0);
  }
);

test('JSON 知识点永久删除：预览连带数量，关联和关系同事务软删除，概念版本推进', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-concept-purge-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataStore = createFileDataStore(path.join(root, 'cloud.json'));
  const app = createAppContext({ dataStore, storageRootDir: root });
  const knowledge = app.modules.knowledge;
  knowledge.knowledgeItemService.createCandidate({
    id: 'k',
    title: '手工知识',
    canonicalStatement: '关系说明。',
    knowledgeType: 'concept',
    sourceMode: 'manual'
  });
  for (const id of ['a', 'b'])
    await app.knowledgeConcepts.execute({
      type: 'createConcept',
      id,
      name: id,
      itemIds: ['k'],
      expectedRevision: 0,
      operationId: `create-${id}`
    });
  await app.knowledgeConcepts.execute({
    type: 'createRelation',
    id: 'a',
    expectedRevision: 1,
    operationId: 'relation',
    relationId: 'r',
    toConceptId: 'b',
    relationType: 'relatedTo',
    basisItemId: 'k'
  });
  const item = knowledge.knowledgeItemService.getItem('k');
  const trashed = knowledge.knowledgeItemService.trash('k', { expectedUpdatedAt: item.updatedAt });
  assert.equal((await app.knowledgeConcepts.list()).links.length, 2);
  const preview = knowledge.inspectKnowledgePurge('k');
  assert.deepEqual(preview.conceptCleanup, { links: 2, relations: 1 });
  knowledge.permanentlyDeleteKnowledgeItem('k', { expectedUpdatedAt: trashed.updatedAt });
  const state = await app.knowledgeConcepts.list();
  assert.equal(state.links.length, 0);
  assert.equal(state.relations.length, 0);
  assert.equal(state.concepts.find(row => row.id === 'a').revision, 3);
  assert.equal(dataStore.state.knowledgeConceptLinks.length, 2);
});

import { syncContract } from '../../api/src/modules/sync/protocol-contract.ts';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPostgresAppContext } from '../../api/src/postgres-app.factory.ts';
import { noteContent } from '../../api/src/modules/sync/journal.ts';
import { temporaryDirectory, markText, inlineId } from './helpers.mjs';

import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';

const enabled = Boolean(process.env.KNOWRA_SYNC_TEST_DATABASE_URL);
test(
  '真实 PostgreSQL：两个 API 实例条件竞争、幂等结果及故障回滚保持原子，导入提升世代',
  { skip: !enabled, timeout: 60000 },
  async t => {
    const database = await createPostgresTestDatabase();
    t.after(() => database.close());
    const { databaseUrl } = database;
    const url = new URL(databaseUrl);
    assert(['127.0.0.1', 'localhost'].includes(url.hostname), '只能显式指定回环测试数据库');
    assert.equal(process.env.KNOWRA_SYNC_TEST_ALLOW_WRITES, '1', '需要显式允许临时库测试写入');
    const root = temporaryDirectory(t);
    const a = await createPostgresAppContext({
      databaseUrl,
      storageRootDir: root,
      uploadsDir: path.join(root, 'uploads')
    });
    const b = await createPostgresAppContext({
      databaseUrl,
      storageRootDir: root,
      uploadsDir: path.join(root, 'uploads')
    });
    t.after(async () => {
      await a.close();
      await b.close();
    });
    const space = await a.modules.knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
    const note = await a.modules.knowledge.noteService.createNote({
      title: `Postgres ${randomUUID()}`,
      rawMarkdown: markText('数据库共同基线', 'pg-base'),
      spaceId: space.id
    });
    const annotation = await a.modules.knowledge.contentAnnotationService.getAnnotation(inlineId(note.id, 'pg-base'));
    const source = await a.modules.knowledge.knowledgeItemService.createCandidate({
      title: 'PG 来源',
      canonicalStatement: '保留原文证据',
      sourceMode: 'selection',
      evidence: [{ sourceType: 'annotation', annotationId: annotation.id }]
    });
    const bootstrap = await a.http.sync.bootstrap(syncContract());
    const entry = (await a.http.sync.snapshot({ ...syncContract(), snapshotId: bootstrap.snapshotId })).entries.find(
      item => item.id === note.id
    );
    const operation = {
      protocolVersion: 1,
      ...syncContract(),
      deviceId: 'pg-test',
      operationId: randomUUID(),
      noteId: note.id,
      datasetEpoch: bootstrap.datasetEpoch,
      baseRevision: entry.revision,
      value: { ...noteContent(note), rawMarkdown: '数据库 A 提交' }
    };
    const competing = {
      ...operation,
      operationId: randomUUID(),
      value: { ...operation.value, rawMarkdown: '数据库 B 提交' }
    };
    const results = await Promise.all([a.http.sync.push(operation), b.http.sync.push(competing)]);
    assert.equal(results.filter(result => result.status === 'accepted').length, 1);
    assert.equal(results.filter(result => result.status === 'conflict').length, 1);
    // 外部正文改写需核对来源；历史依据仍存在，不将待检查等同于原文删除。
    assert.equal(
      (await a.prisma.knowledgeEvidence.findUnique({ where: { id: source.evidence[0].id } })).status,
      'stale'
    );
    assert.deepEqual(await a.http.sync.push(operation), results[0]);
    const cursor = (await a.http.sync.status()).cursor;
    const current = await a.modules.knowledge.noteService.getNote(note.id);
    const versionCount = await a.prisma.noteVersion.count({ where: { noteId: note.id } });
    await a.prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION knowra_sync_test_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'sync failure injection'; END $$`
    );
    await a.prisma.$executeRawUnsafe(
      'CREATE TRIGGER knowra_sync_test_reject BEFORE UPDATE ON "SyncJournal" FOR EACH ROW EXECUTE FUNCTION knowra_sync_test_reject()'
    );
    try {
      await assert.rejects(
        () => a.modules.knowledge.noteService.updateNote(note.id, { rawMarkdown: '必须回滚' }),
        error => {
          const messages = [];
          for (let current = error; current; current = current.cause) messages.push(current.message);
          assert(messages.join('\n').includes('sync failure injection'), messages.join('\n'));
          return true;
        }
      );
    } finally {
      await a.prisma.$executeRawUnsafe('DROP TRIGGER knowra_sync_test_reject ON "SyncJournal"');
      await a.prisma.$executeRawUnsafe('DROP FUNCTION knowra_sync_test_reject()');
    }
    assert.equal((await a.modules.knowledge.noteService.getNote(note.id)).rawMarkdown, current.rawMarkdown);
    assert.equal(await a.prisma.noteVersion.count({ where: { noteId: note.id } }), versionCount);
    assert.equal((await a.http.sync.status()).cursor, cursor);
    const snapshot = await a.http.storage.exportKnowledgeBase();
    assert(snapshot.data.annotationRevisions.some(revision => revision.annotationId === annotation.id));
    await a.http.storage.importKnowledgeBase(snapshot);
    assert.equal(
      await a.prisma.annotationRevision.count({ where: { annotationId: annotation.id } }),
      snapshot.data.annotationRevisions.filter(revision => revision.annotationId === annotation.id).length
    );
    assert.notEqual((await a.http.sync.status()).datasetEpoch, bootstrap.datasetEpoch);
    await assert.rejects(
      () => a.http.sync.changes({ ...syncContract(), cursor }),
      failure => failure.code === 'DATASET_CHANGED'
    );
    const importedEpoch = (await a.http.sync.status()).datasetEpoch;
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL('../../../scripts/reset-sync-epoch.mjs', import.meta.url)), '--driver', 'postgres'],
      {
        env: { ...process.env, KNOWRA_SYNC_RESET_DATABASE_URL: databaseUrl },
        timeout: 15000
      }
    );
    assert.notEqual((await a.http.sync.status()).datasetEpoch, importedEpoch);
  }
);

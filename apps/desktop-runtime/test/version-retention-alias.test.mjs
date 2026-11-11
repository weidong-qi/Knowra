import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { createFileDataStore } from '../../api/src/infrastructure/file-data-store.ts';
import { createAppContext } from '../../api/src/app.factory.ts';
import { createPostgresAppContext } from '../../api/src/postgres-app.factory.ts';
import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';
import { NoteVersion } from '../../api/src/modules/knowledge/domain/note-version.ts';
import { temporaryDirectory } from './helpers.mjs';

const DAY = 24 * 3600 * 1000;
async function fixture(t, postgres) {
  const root = temporaryDirectory(t);
  const cloud = postgres ? null : createFileDataStore(path.join(root, 'cloud.json'));
  const database = postgres ? await createPostgresTestDatabase() : null;
  let context;
  t.after(async () => {
    try {
      await context?.close?.();
    } finally {
      await database?.close();
    }
  });
  context = postgres
    ? await createPostgresAppContext({
        databaseUrl: database.databaseUrl,
        uploadsDir: path.join(root, 'uploads'),
        storageRootDir: root
      })
    : createAppContext({ dataStore: cloud, storageRootDir: root });
  const space = await context.modules.knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  return { context, cloud, space };
}

for (const postgres of [false, true])
  test(
    `${postgres ? 'PostgreSQL' : '文件云端'}：本批提交的同正文别名保护规范版本且重试幂等`,
    {
      skip: postgres && !process.env.KNOWRA_SYNC_TEST_DATABASE_URL,
      timeout: 60000
    },
    async t => {
      const { syncContract } = await import('../../api/src/modules/sync/protocol-contract.ts');
      const { syncKey } = await import('../../api/src/modules/sync/journal.ts');
      const f = await fixture(t, postgres);
      const note = await f.context.modules.knowledge.noteService.createNote({
        title: '别名保护',
        rawMarkdown: '当前',
        spaceId: f.space.id
      });
      const oldWeek = Math.floor((Date.now() - 70 * DAY) / (7 * DAY)) * 7 * DAY + 3 * DAY;
      const versions = [0, 1].map(
        i =>
          new NoteVersion({
            id: `old-${i}`,
            noteId: note.id,
            content: `旧正文${i}`,
            createdAt: new Date(oldWeek - i * 3600000).toISOString()
          })
      );
      for (const version of versions)
        await f.context.modules.knowledge.repositories.noteVersionRepository.save(version);
      await f.context.http.sync.status();
      const journal = postgres
        ? (await f.context.prisma.syncJournal.findUnique({ where: { ownerId: 'demo' } })).payload
        : f.cloud.getSyncJournal();
      const alias = { ...versions[1], id: 'device-b-alias' };
      const operation = {
        ...syncContract(),
        protocolVersion: 2,
        deviceId: 'b',
        operationId: 'alias-op',
        sequence: 1,
        datasetEpoch: journal.epoch,
        changes: [{ collection: 'noteVersions', id: alias.id, baseRevision: null, value: alias }],
        dependencies: [{ collection: 'notes', id: note.id, baseRevision: journal.revisions[syncKey('notes', note.id)] }]
      };
      const result = await f.context.http.sync.pushBatch(operation);
      assert.equal(result.status, 'accepted');
      assert.equal(result.entries[0].id, versions[1].id);
      assert.equal(result.entries[0].value?.content, versions[1].content, '上传成功后规范版本必须仍存在');
      assert.deepEqual(await f.context.http.sync.pushBatch(operation), result, '重复批次返回相同回执');
      assert.equal(
        (await f.context.modules.knowledge.noteVersionService.getVersion(versions[1].id, note.id)).content,
        versions[1].content
      );
    }
  );

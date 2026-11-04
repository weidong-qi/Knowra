// 手动基准：PostgreSQL 云端在不同资料量下，单次小改动事务的耗时与读取行数。
// 用法：KNOWRA_SYNC_TEST_DATABASE_URL=… KNOWRA_SYNC_TEST_ALLOW_WRITES=1 node test/sync-postgres-benchmark.mjs [笔记数 …]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { syncContract } from '../../api/src/modules/sync/protocol-contract.ts';
import { calculateContentHash } from '../../api/src/modules/knowledge/domain/note-version.ts';
import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';

const sizes = process.argv.slice(2).map(Number).filter(Boolean);
const body = '段落正文'.repeat(400);
const bodyHash = calculateContentHash(body);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function rowsRead(prisma, schema) {
  await sleep(1300);
  const [row] = await prisma.$queryRawUnsafe(
    `SELECT COALESCE(SUM(seq_tup_read + idx_tup_fetch), 0)::float8 AS rows FROM pg_stat_user_tables WHERE schemaname = $1`,
    schema
  );
  return row.rows;
}

for (const size of sizes.length ? sizes : [200, 1000]) {
  const database = await createPostgresTestDatabase();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-pg-bench-'));
  const { createPostgresAppContext } = await import('../../api/src/postgres-app.factory.js');
  const cloud = await createPostgresAppContext({
    databaseUrl: database.databaseUrl,
    uploadsDir: path.join(root, 'uploads'),
    storageRootDir: root
  });
  try {
    const space = await cloud.modules.knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
    const now = new Date();
    for (let offset = 0; offset < size; offset += 250) {
      const ids = Array.from({ length: Math.min(250, size - offset) }, () => randomUUID());
      await cloud.prisma.note.createMany({
        data: ids.map((id, index) => ({
          id,
          spaceId: space.id,
          title: `笔记 ${offset + index}`,
          rawMarkdown: body,
          plainText: body,
          internalLinks: [],
          contentHash: bodyHash,
          createdAt: now,
          updatedAt: now
        }))
      });
      await cloud.prisma.noteVersion.createMany({
        data: ids.map(id => ({
          id: randomUUID(),
          noteId: id,
          content: body,
          contentHash: bodyHash,
          createdAt: now,
          createdBy: 'user'
        }))
      });
    }
    const target = (await cloud.prisma.note.findFirst({ where: { spaceId: space.id } })).id;
    const before = await rowsRead(cloud.prisma, database.schema);
    const started = performance.now();
    await cloud.modules.knowledge.noteService.updateNote(target, { title: `改动 ${Date.now()}` });
    const elapsedMs = performance.now() - started;
    const after = await rowsRead(cloud.prisma, database.schema);
    // 桌面端实际走的批量上传：仅修改一篇笔记标题。
    const journalRow = await cloud.prisma.syncJournal.findFirst();
    const revision = key => journalRow.payload.revisions[JSON.stringify(key)] ?? null;
    const note = await cloud.modules.knowledge.noteService.getNote(target);
    const batch = {
      protocolVersion: 2,
      ...syncContract(),
      datasetEpoch: journalRow.payload.epoch,
      deviceId: 'bench-device',
      operationId: randomUUID(),
      sequence: 1,
      changes: [
        {
          collection: 'notes',
          id: target,
          baseRevision: revision(['notes', target]),
          value: { ...note, title: `批量 ${Date.now()}` }
        }
      ],
      dependencies: [{ collection: 'spaces', id: space.id, baseRevision: revision(['spaces', space.id]) }]
    };
    const batchStarted = performance.now();
    const batchResult = await cloud.http.sync.pushBatch(batch);
    const batchMs = Math.round(performance.now() - batchStarted);
    if (batchResult.status !== 'accepted')
      throw new Error(`批量上传未被接受：${JSON.stringify(batchResult).slice(0, 300)}`);
    // 日志写满保留窗口后，轮询类接口（status/changes）的单次耗时。
    const row = await cloud.prisma.syncJournal.findFirst();
    const journal = row.payload;
    for (let index = 0; index < 512; index++)
      journal.changes.push({
        sequence: ++journal.head,
        items: [
          {
            collection: 'notes',
            id: randomUUID(),
            revision: 2,
            value: { id: randomUUID(), title: `日志 ${index}`, rawMarkdown: body, plainText: body }
          }
        ]
      });
    journal.changes.splice(0, journal.changes.length - 512);
    await cloud.prisma.syncJournal.update({ where: { ownerId: row.ownerId }, data: { payload: journal } });
    const time = async work => {
      const start = performance.now();
      for (let i = 0; i < 20; i++) await work();
      return Math.round((performance.now() - start) / 20);
    };
    const status = await cloud.http.sync.status();
    const [{ bytes }] = await cloud.prisma.$queryRawUnsafe(
      'SELECT pg_column_size(payload)::int AS bytes FROM "SyncJournal" LIMIT 1'
    );
    const poll = {
      journalBytes: bytes,
      statusMs: await time(() => cloud.http.sync.status()),
      changesMs: await time(() => cloud.http.sync.changes({ cursor: status.cursor, ...syncContract() }))
    };
    console.log(
      JSON.stringify({ notes: size, elapsedMs: Math.round(elapsedMs), rowsRead: after - before, batchMs, ...poll })
    );
  } finally {
    await cloud.close();
    await database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

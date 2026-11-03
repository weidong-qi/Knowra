import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPostgresAppContext } from '../src/postgres-app.factory.js';
import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';
import { calculateContentHash } from '../src/modules/knowledge/domain/note-version.ts';
import { request, lookup } from './fixtures/core-operation-scenarios.js';

async function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-core-pg-'));
  let database;
  const apps = [];
  try {
    database = await createPostgresTestDatabase();
    const ownerId = `core-${randomUUID()}`;
    const start = async () => {
      const app = await createPostgresAppContext({
        databaseUrl: database.databaseUrl,
        ownerId,
        storageRootDir: root,
        uploadsDir: path.join(root, 'uploads')
      });
      apps.push(app);
      return app;
    };
    const app = await start(),
      api = app.http.knowledge,
      space = await api.createDefaultKnowledgeSpace();
    const input = { ...request(space.id), ownerId, actorId: ownerId };
    const apply = async (target, title = '唯一 PG 结果', noteId = 'note-fixed') => {
      const note = await target.http.knowledge.createNote({
        id: noteId,
        title,
        rawMarkdown: '合成正文',
        spaceId: space.id
      });
      const version = await target.repositories.noteVersionRepository.findByNoteIdAndContentHash(
        note.id,
        calculateContentHash(note.rawMarkdown)
      );
      assert(version);
      return {
        saveState: 'localCommitted',
        changes: [
          {
            noteId: note.id,
            beforeVersionId: null,
            afterVersionId: version.id,
            contentHash: version.contentHash,
            metadataBefore: null
          }
        ]
      };
    };
    await run({ app, start, apply, input, space });
  } finally {
    try {
      for (const app of apps.reverse()) {
        try {
          await app.ai?.agent?.close?.();
          await app.ai?.worker?.close?.();
        } finally {
          await app.close();
        }
      }
    } finally {
      try {
        await database?.close();
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
}

export const coreOperationPostgresTests = process.env.KNOWRA_SYNC_TEST_DATABASE_URL
  ? [
      {
        name: 'PostgreSQL 两实例同时提交与响应丢失后恢复只有一篇笔记/版本/核心回执',
        async run() {
          await withFixture(async ({ app, start, apply, input }) => {
            const other = await start();
            let executions = 0;
            const receipts = await Promise.all(
              [app, other].map(target =>
                target.coreOperationStore.commit(input, async () => {
                  executions++;
                  return apply(target);
                })
              )
            );
            assert.equal(executions, 1);
            assert.deepEqual(receipts[0], receipts[1]);
            assert.equal(await app.prisma.note.count(), 1);
            assert.equal(await app.prisma.noteVersion.count(), 1);
            const [{ count }] = await app.prisma.$queryRawUnsafe(
              'SELECT count(*)::int AS count FROM core_operation_receipts'
            );
            assert.equal(count, 1);
            const journal = await app.prisma.syncJournal.findUnique({ where: { ownerId: input.ownerId } });
            assert(JSON.stringify(journal.payload).includes('note-fixed'));
            const restarted = await start();
            assert.deepEqual(
              await restarted.coreOperationStore.commit(input, () => {
                throw new Error('不能再写');
              }),
              receipts[0]
            );
            await assert.rejects(
              restarted.coreOperationStore.commit({ ...input, planHash: 'b'.repeat(64) }, () => {}),
              { code: 'CORE_OPERATION_CONFLICT' }
            );
            await assert.rejects(
              restarted.coreOperationStore.commit({ ...input, datasetEpoch: 'new-epoch' }, () => {}),
              { code: 'CORE_OPERATION_CONFLICT' }
            );
            await assert.rejects(restarted.coreOperationStore.get({ ...lookup(input), ownerId: 'other' }), {
              code: 'CORE_OPERATION_FORBIDDEN'
            });
            assert.equal(await restarted.coreOperationStore.get({ ...lookup(input), datasetId: 'other' }), null);
          });
        }
      },
      {
        name: 'PostgreSQL 核心回执插入故障共同回滚笔记、版本与同步日志，重试可安全提交',
        async run() {
          await withFixture(async ({ app, apply, input }) => {
            const before = await app.prisma.syncJournal.findUnique({ where: { ownerId: input.ownerId } });
            await app.prisma.$executeRawUnsafe(`CREATE FUNCTION fail_core_receipt() RETURNS trigger LANGUAGE plpgsql AS
        'BEGIN RAISE EXCEPTION ''injected receipt failure''; END;'`);
            await app.prisma
              .$executeRawUnsafe(`CREATE TRIGGER fail_core_receipt BEFORE INSERT ON core_operation_receipts
        FOR EACH ROW EXECUTE FUNCTION fail_core_receipt()`);
            try {
              await assert.rejects(
                app.coreOperationStore.commit(input, () => apply(app)),
                /injected receipt failure/
              );
            } finally {
              await app.prisma.$executeRawUnsafe('DROP TRIGGER fail_core_receipt ON core_operation_receipts');
            }
            assert.equal(await app.prisma.note.count(), 0);
            assert.equal(await app.prisma.noteVersion.count(), 0);
            assert.equal(await app.coreOperationStore.get(lookup(input)), null);
            assert.deepEqual(await app.prisma.syncJournal.findUnique({ where: { ownerId: input.ownerId } }), before);
            await assert.rejects(
              app.coreOperationStore.commit(input, () => app.coreOperationStore.commit(input, () => {})),
              /递归/
            );
            let innerRan = false;
            await app.prisma.$transaction(async () => {
              await assert.rejects(
                async () =>
                  app.coreOperationStore.commit(input, () => {
                    innerRan = true;
                  }),
                /最外层/
              );
            });
            assert.equal(innerRan, false);
            await assert.rejects(
              app.coreOperationStore.commit(input, async () => ({ ...(await apply(app)), forged: true })),
              { code: 'CORE_OPERATION_INVALID' }
            );
            assert.equal(await app.prisma.note.count(), 0);
            assert.equal(
              (
                await app.coreOperationStore.commit(input, async () => {
                  await assert.rejects(
                    async () =>
                      app.coreOperationStore.commit({ ...input, operationId: 'different-inner-op' }, () => {
                        innerRan = true;
                        return apply(app, '不能保存的内层', 'unreceipted');
                      }),
                    /嵌套/
                  );
                  return apply(app);
                })
              ).status,
              'applied'
            );
            assert.equal(innerRan, false);
            assert.equal(await app.prisma.note.count(), 1);
          });
        }
      },
      {
        name: 'PostgreSQL 删除隔离测试库的 AI 私有表后核心回执与普通笔记仍可使用',
        async run() {
          await withFixture(async ({ app, apply, input }) => {
            const receipt = await app.coreOperationStore.commit(input, () => apply(app));
            // 仅独立、可删除的测试 schema；正式应用没有此清理入口。
            await app.prisma.$executeRawUnsafe('DROP TABLE ai_jobs CASCADE');
            assert.deepEqual(await app.coreOperationStore.get(lookup(input)), receipt);
            assert.deepEqual(
              await app.coreOperationStore.commit(input, () => {
                throw new Error('不能再写');
              }),
              receipt
            );
            await apply(app, '私有表故障后手工笔记', 'manual-after-ai-fault');
            assert.equal(await app.prisma.note.count(), 2);
          });
        }
      },
      {
        name: 'PostgreSQL 已存在的 JSON null/坏回执/索引不一致在任何领域执行前拒绝并保留',
        async run() {
          await withFixture(async ({ app, apply, input }) => {
            const receipt = await app.coreOperationStore.commit(input, () => apply(app));
            for (const value of [
              null,
              false,
              { ...receipt, schemaVersion: 999 },
              { ...receipt, receiptHash: '0'.repeat(64) }
            ]) {
              await app.prisma.$executeRawUnsafe(
                'UPDATE core_operation_receipts SET receipt_json = $1::jsonb',
                JSON.stringify(value)
              );
              let ran = false;
              await assert.rejects(app.coreOperationStore.get(lookup(input)), { code: 'CORE_OPERATION_INVALID' });
              await assert.rejects(
                app.coreOperationStore.commit(input, () => {
                  ran = true;
                  return apply(app);
                }),
                { code: 'CORE_OPERATION_INVALID' }
              );
              assert.equal(ran, false);
              assert.equal(await app.prisma.note.count(), 1);
              const [row] = await app.prisma.$queryRawUnsafe('SELECT receipt_json FROM core_operation_receipts');
              assert.deepEqual(row.receipt_json, value);
            }
            await app.prisma.$executeRawUnsafe(
              'UPDATE core_operation_receipts SET receipt_json = $1::jsonb, plan_hash = $2',
              JSON.stringify(receipt),
              'b'.repeat(64)
            );
            await assert.rejects(app.coreOperationStore.get(lookup(input)), { code: 'CORE_OPERATION_INVALID' });
          });
        }
      }
    ]
  : [];

import {
  loadPostgresAttachmentReferenceState,
  inspectAttachmentDeletion
} from '../src/infrastructure/attachment-deletion-preflight.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';
import { createPostgresAppContext } from '../src/postgres-app.factory.ts';

async function fixture(run) {
  const database = await createPostgresTestDatabase();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-todos-pg-'));
  const apps = [];
  try {
    for (const name of ['a', 'b'])
      apps.push(
        await createPostgresAppContext({
          databaseUrl: database.databaseUrl,
          storageRootDir: path.join(root, name),
          uploadsDir: path.join(root, name, 'uploads')
        })
      );
    await run({ a: apps[0], b: apps[1] });
  } finally {
    for (const app of apps) await app.close();
    fs.rmSync(root, { recursive: true, force: true });
    await database.close();
  }
}

const journalTodoItems = async app => {
  const row = await app.prisma.syncJournal.findUnique({ where: { ownerId: 'demo' } });
  return (row?.payload?.changes ?? [])
    .flatMap(group => group.items)
    .filter(item => item.collection === 'personalTodos');
};

export const personalTodoPostgresTests = process.env.KNOWRA_SYNC_TEST_DATABASE_URL
  ? [
      {
        name: '真实 PostgreSQL：待办命令写入整条记录、跨实例可见并进入同步日志',
        async run() {
          await fixture(async ({ a, b }) => {
            await a.personalTodos.execute({
              type: 'create',
              id: 'm1',
              parentId: null,
              kind: 'mainline',
              title: '完成分类项目'
            });
            await a.personalTodos.execute({ type: 'create', id: 'c1', parentId: 'm1', title: '训练模型' });
            await a.personalTodos.execute({ type: 'pause', id: 'm1', expectedRevision: 1, reason: '等数据' });
            const listed = await b.personalTodos.list();
            assert.deepEqual(listed.map(todo => [todo.id, todo.status, todo.pausedBy]).sort(), [
              ['c1', 'paused', 'parent'],
              ['m1', 'paused', 'self']
            ]);
            const items = await journalTodoItems(a);
            assert.deepEqual(items.map(item => `${item.id}@${item.revision}`).sort(), ['c1@1', 'c1@2', 'm1@1', 'm1@2']);
            // 暂停父级与随父暂停的下级在同一个日志组内一起提交。
            const row = await a.prisma.syncJournal.findUnique({ where: { ownerId: 'demo' } });
            const last = row.payload.changes.at(-1).items.filter(item => item.collection === 'personalTodos');
            assert.deepEqual(
              last.map(item => item.value.status),
              ['paused', 'paused']
            );
            await a.personalTodos.execute({
              type: 'update',
              id: 'c1',
              expectedRevision: 2,
              patch: { note: '/api/storage/attachments/todo-attachment/content' }
            });
            const references = inspectAttachmentDeletion(
              'todo-attachment',
              await loadPostgresAttachmentReferenceState(a.prisma)
            ).references;
            assert.deepEqual(
              references.map(row => [row.collection, row.id]),
              [['personalTodos', 'c1']]
            );
          });
        }
      },
      {
        name: '真实 PostgreSQL：规则错误整体回滚，并发实例的旧修订被拒绝',
        async run() {
          await fixture(async ({ a, b }) => {
            await a.personalTodos.execute({ type: 'create', id: 's1', parentId: null, title: '办理报销' });
            await a.personalTodos.execute({ type: 'create', id: 's2', parentId: 's1', title: '整理票据' });
            const before = await journalTodoItems(a);
            await assert.rejects(
              b.personalTodos.execute({ type: 'complete', id: 's1', expectedRevision: 1 }),
              error => error.code === 'TODO_HAS_OPEN_CHILDREN' && error.statusCode === 409
            );
            assert.deepEqual(await journalTodoItems(a), before);
            await a.personalTodos.execute({ type: 'update', id: 's1', expectedRevision: 1, patch: { starred: true } });
            await assert.rejects(
              b.personalTodos.execute({ type: 'update', id: 's1', expectedRevision: 1, patch: { title: '旧页面' } }),
              error => error.code === 'TODO_REVISION_CONFLICT'
            );
            assert.equal((await b.personalTodos.list()).find(todo => todo.id === 's1').title, '办理报销');
          });
        }
      }
    ]
  : [];

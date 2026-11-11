import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPersistentAppContext } from '../src/app.factory.ts';
import { createServer } from '../src/server.js';
import { createPersonalTodoService } from '../src/modules/personal-todos/service.ts';

async function withServer(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-todos-'));
  let appContext = createPersistentAppContext({ storageRootDir: directory, ownerId: 'demo' });
  let server = createServer({ appContext, logger: { warn() {}, error() {} } });
  const start = async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}/api/todos`;
  };
  const stop = async () => {
    await new Promise(resolve => server.close(resolve));
    await server.closeAi?.();
    await appContext.close?.();
  };
  let base = await start();
  const call = async (suffix, body) => {
    const response = await fetch(
      base + suffix,
      body === undefined
        ? {}
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    return { status: response.status, body: await response.json() };
  };
  const command = command => call('/commands', { command });
  const reopen = async () => {
    await stop();
    appContext = createPersistentAppContext({ storageRootDir: directory, ownerId: 'demo' });
    server = createServer({ appContext, logger: { warn() {}, error() {} } });
    base = await start();
  };
  try {
    await run({ call, command, reopen, directory });
  } finally {
    await stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

export const personalTodoHttpTests = [
  {
    name: 'personal todos HTTP executes commands, persists JSON and reports rule errors',
    async run() {
      await withServer(async ({ call, command, reopen }) => {
        assert.deepEqual((await call('')).body, { data: { todos: [] } });
        const created = await command({
          type: 'create',
          id: 'm1',
          parentId: null,
          kind: 'mainline',
          title: '完成分类项目'
        });
        assert.equal(created.status, 200);
        assert.equal(created.body.data.changed[0].revision, 1);
        await command({ type: 'create', id: 'c1', parentId: 'm1', title: '准备数据' });
        const incomplete = await command({ type: 'complete', id: 'm1', expectedRevision: 1 });
        assert.equal(incomplete.status, 409);
        assert.equal(incomplete.body.error.code, 'TODO_HAS_OPEN_CHILDREN');
        const stale = await command({ type: 'update', id: 'c1', expectedRevision: 9, patch: { title: '新' } });
        assert.equal(stale.body.error.code, 'TODO_REVISION_CONFLICT');
        assert.equal((await command({ type: 'unknown' })).status, 422);
        const done = await command({ type: 'complete', id: 'm1', expectedRevision: 1, includeChildren: true });
        assert.deepEqual(
          done.body.data.changed.map(todo => todo.status),
          ['done', 'done']
        );

        await reopen();
        const listed = (await call('')).body.data.todos;
        assert.deepEqual(listed.map(todo => [todo.id, todo.status]).sort(), [
          ['c1', 'done'],
          ['m1', 'done']
        ]);
      });
    }
  },
  {
    name: 'personal todos list hides soft-deleted records but restore brings them back',
    async run() {
      await withServer(async ({ call, command }) => {
        await command({ type: 'create', id: 's1', parentId: null, title: '办理报销' });
        await command({ type: 'create', id: 's2', parentId: 's1', title: '整理票据' });
        await command({ type: 'delete', id: 's1', expectedRevision: 1 });
        assert.deepEqual((await call('')).body.data.todos, []);
        await command({ type: 'restore', id: 's1' });
        assert.equal((await call('')).body.data.todos.length, 2);
      });
    }
  },
  {
    name: 'personal todos without a store report an explicit unavailable error',
    async run() {
      const service = createPersonalTodoService({ store: null });
      await assert.rejects(service.list(), error => error.code === 'PERSONAL_TODOS_UNAVAILABLE');
    }
  }
];

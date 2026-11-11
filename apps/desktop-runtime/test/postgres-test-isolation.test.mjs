import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { once } from 'node:events';
import { createPostgresTestDatabase } from '../../../scripts/test-support/postgres-test-database.mjs';

const options = { databaseUrl: 'postgresql://test:unused@127.0.0.1/knowra_sync_test', allowWrites: '1' };
function stub() {
  const calls = [];
  return {
    calls,
    createClient: async () => ({
      async $connect() {
        calls.push('connect');
      },
      async $executeRawUnsafe(sql) {
        calls.push(sql);
      },
      async $disconnect() {
        calls.push('disconnect');
      }
    }),
    migrate: async url => calls.push(new URL(url).searchParams.get('schema'))
  };
}

test('PostgreSQL fixture 拒绝未授权、非回环或非测试库，且不创建连接', async () => {
  for (const config of [
    { allowWrites: '0' },
    { databaseUrl: 'postgresql://test@remote/knowra_sync_test' },
    { databaseUrl: 'postgresql://test@127.0.0.1/knowra' },
    { databaseUrl: 'https://127.0.0.1/knowra_sync_test' }
  ]) {
    let connected = false;
    await assert.rejects(
      createPostgresTestDatabase({
        ...options,
        ...config,
        createClient() {
          connected = true;
          throw new Error('不应连接');
        }
      }),
      /只能显式允许/
    );
    assert.equal(connected, false);
  }
});

test('PostgreSQL fixture 在创建连接前拒绝 host 覆盖（含重复和编码参数）', async () => {
  for (const query of [
    'host=remote.example.com',
    'host=',
    'host=127.0.0.1',
    'host=127.0.0.1&host=remote.example.com',
    'host=remote.example.com&host=127.0.0.1',
    '%68ost=remote.example.com',
    'schema=public&host=%2Ftmp'
  ]) {
    let connected = false,
      migrated = false;
    await assert.rejects(
      createPostgresTestDatabase({
        ...options,
        databaseUrl: `${options.databaseUrl}?${query}`,
        createClient() {
          connected = true;
          throw new Error('不应连接');
        },
        migrate() {
          migrated = true;
          throw new Error('不应迁移');
        }
      }),
      /只能显式允许/
    );
    assert.equal(connected, false, query);
    assert.equal(migrated, false, query);
  }
});

test('PostgreSQL fixture 并发分配唯一 schema；清理只删除自己且可重复调用', async () => {
  const first = stub(),
    second = stub();
  const [a, b] = await Promise.all([
    createPostgresTestDatabase({ ...options, ...first }),
    createPostgresTestDatabase({ ...options, ...second })
  ]);
  assert.notEqual(a.schema, b.schema);
  assert.equal(new URL(a.databaseUrl).searchParams.get('schema'), a.schema);
  await a.close();
  await a.close();
  assert.equal(first.calls.filter(call => call.startsWith('DROP')).length, 1);
  assert(first.calls.includes(`DROP SCHEMA "${a.schema}" CASCADE`));
  assert(!second.calls.some(call => call.startsWith('DROP')));
  await b.close();
});

test('PostgreSQL fixture 迁移失败仍清理；删除 schema 失败仍断开且保留两项错误', async () => {
  const original = new Error('migration failed'),
    cleanup = new Error('drop failed');
  const fixture = stub();
  await assert.rejects(
    createPostgresTestDatabase({
      ...options,
      ...fixture,
      migrate: async () => {
        throw original;
      }
    }),
    error => error === original
  );
  assert(fixture.calls.some(call => call.startsWith('DROP SCHEMA')));
  assert.equal(fixture.calls.at(-1), 'disconnect');
  let disconnected = false;
  await assert.rejects(
    createPostgresTestDatabase({
      ...options,
      createClient: async () => ({
        async $connect() {},
        async $executeRawUnsafe(sql) {
          if (sql.startsWith('DROP')) throw cleanup;
        },
        async $disconnect() {
          disconnected = true;
        }
      }),
      migrate: async () => {
        throw original;
      }
    }),
    error => {
      assert.equal(error.errors[0], original);
      assert.equal(error.errors[1].errors[0], cleanup);
      return true;
    }
  );
  assert(disconnected);
});

test(
  '真实 PostgreSQL：复现共享元数据＋临时目录销毁的 404／快照缺失，并验证并发隔离',
  {
    skip: !process.env.KNOWRA_SYNC_TEST_DATABASE_URL,
    timeout: 120000
  },
  async t => {
    const { createPostgresAppContext } = await import('../../api/src/postgres-app.factory.ts');
    const { createServer } = await import('../../api/src/server.js');
    const { createSyncEngine } = await import('../src/sync-engine.mjs');
    const { createAttachmentTransfer } = await import('../../api/src/modules/sync/attachment-transfer.ts');
    const { openWorkspace } = await import('./helpers.mjs');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-pg-isolation-'));
    const databases = [],
      apps = [];
    let server, engine, workspace;
    t.after(async () => {
      const failures = [];
      for (const cleanup of [
        async () => {
          if (engine) await engine.close();
        },
        () => workspace?.store.close(),
        async () => {
          if (server) await new Promise(resolve => server.close(resolve));
        },
        ...apps.map(app => () => app.close()),
        ...databases.map(database => () => database.close()),
        () => fs.rmSync(root, { recursive: true, force: true })
      ]) {
        try {
          await cleanup();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length) throw new AggregateError(failures, '隔离回归清理失败');
    });
    // 并发建立 fixture；任何一个初始化失败，另一个成功的 fixture 也必须被登记清理。
    const setup = await Promise.allSettled([0, 1].map(async () => databases.push(await createPostgresTestDatabase())));
    const setupFailures = setup.filter(result => result.status === 'rejected').map(result => result.reason);
    if (setupFailures.length) throw new AggregateError(setupFailures, '并发 fixture 初始化失败');
    const [a, b] = databases;
    assert.notEqual(a.schema, b.schema);
    async function open(database, name) {
      const directory = path.join(root, name);
      const app = await createPostgresAppContext({
        databaseUrl: database.databaseUrl,
        storageRootDir: directory,
        uploadsDir: path.join(directory, 'uploads')
      });
      apps.push(app);
      return app;
    }
    const old = await open(a, 'old');
    const space = await old.modules.knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
    const note = await old.modules.knowledge.noteService.createNote({
      spaceId: space.id,
      title: '污染来源',
      rawMarkdown: ''
    });
    const lost = await old.http.storage.uploadAttachment({
      noteId: note.id,
      fileName: 'fixture.txt',
      contentBase64: Buffer.from('fixture attachment').toString('base64')
    });
    await old.close();
    fs.rmSync(path.join(root, 'old'), { recursive: true, force: true });
    const contaminated = await open(a, 'later');
    assert(await contaminated.prisma.attachment.findUnique({ where: { id: lost.id } }), '确认文件销毁后元数据仍残留');
    await assert.rejects(contaminated.http.storage.exportKnowledgeBase(), { code: 'ATTACHMENT_FILE_MISSING' });
    server = createServer({ appContext: contaminated, logger: { error() {} } });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const deviceRoot = path.join(root, 'device');
    workspace = openWorkspace(deviceRoot);
    engine = createSyncEngine(workspace.store, {
      autoSync: false,
      noteService: workspace.knowledge.noteService,
      entityTransfer: createAttachmentTransfer({
        storageRootDir: deviceRoot,
        uploadsDir: path.join(deviceRoot, 'uploads')
      })
    });
    await engine.configure({ serverUrl: `http://127.0.0.1:${server.address().port}` });
    assert.equal(engine.status().error.code, 'NETWORK_ERROR');
    assert.match(engine.status().error.message, /404/);
    t.diagnostic(
      `共享 schema 污染已复现：${lost.id} 元数据存在，原目录已删除；首次同步404、快照ATTACHMENT_FILE_MISSING。`
    );
    const isolated = await open(b, 'isolated');
    assert.equal(await isolated.prisma.attachment.findUnique({ where: { id: lost.id } }), null);
    const ownSpace = await isolated.modules.knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({
      userId: 'demo'
    });
    const ownNote = await isolated.modules.knowledge.noteService.createNote({
      spaceId: ownSpace.id,
      title: '独立附件',
      rawMarkdown: ''
    });
    const file = await isolated.http.storage.uploadAttachment({
      noteId: ownNote.id,
      fileName: 'own.txt',
      contentBase64: Buffer.from('own attachment').toString('base64')
    });
    assert.equal(
      (await isolated.http.storage.getAttachmentContent({ id: file.id })).content.toString(),
      'own attachment'
    );
    await isolated.http.storage.exportKnowledgeBase();
    await contaminated.close();
    await a.close();
    assert.equal(await isolated.prisma.attachment.count(), 1, '清理另一个 fixture 不影响自身元数据');
    assert.equal(
      (await isolated.http.storage.getAttachmentContent({ id: file.id })).content.toString(),
      'own attachment'
    );
  }
);

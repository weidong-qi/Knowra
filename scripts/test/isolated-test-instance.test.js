import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { validateInstance, repositoryRoot } from '../../deploy/isolated-test/config.mjs';
import { startIsolatedInstance } from '../../deploy/isolated-test/runtime.mjs';
import { startLocalRuntime } from '../../apps/desktop-runtime/src/runtime-server.mjs';
const run = promisify(execFile);

test('隔离配置拒绝生产数据库、连接覆盖、端口、目录及符号链接', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-isolation-config-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = {
    instanceId: 'qa',
    dataRoot: path.join(root, 'instance'),
    databaseUrl: 'postgresql://test@127.0.0.1/knowra_acceptance_qa'
  };
  assert.equal(validateInstance(input).ownerId, 'demo');
  for (const override of [
    { databaseUrl: 'postgresql://test@127.0.0.1/knowra_prod' },
    { databaseUrl: input.databaseUrl + '?schema=prod' },
    { databaseUrl: input.databaseUrl + '?host=remote' },
    { dataRoot: '/opt/knowra/storage' },
    { dataRoot: repositoryRoot },
    { dataRoot: path.join(repositoryRoot, 'storage', 'test') },
    { dataRoot: '/' },
    { instanceId: '../prod' },
    { port: 3000 }
  ]) {
    assert.throws(() => validateInstance({ ...input, ...override }));
  }
  fs.symlinkSync(root, path.join(root, 'linked'));
  assert.throws(() => validateInstance({ ...input, dataRoot: path.join(root, 'linked', 'instance') }));
});

test(
  '真实独立数据库/目录、同步双端、附件及重启隔离；拒绝未登记旧库',
  {
    skip: !process.env.KNOWRA_SYNC_TEST_DATABASE_URL,
    timeout: 120000
  },
  async t => {
    const adminUrl = new URL(process.env.KNOWRA_SYNC_TEST_DATABASE_URL);
    assert.equal(process.env.KNOWRA_SYNC_TEST_ALLOW_WRITES, '1');
    assert(['postgres:', 'postgresql:'].includes(adminUrl.protocol));
    assert(['127.0.0.1', 'localhost', '[::1]'].includes(adminUrl.hostname));
    assert(/^\/knowra_[a-z0-9_]*test[a-z0-9_]*$/.test(adminUrl.pathname));
    assert(!adminUrl.searchParams.has('host'));
    adminUrl.search = '';
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } }, log: [] });
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-isolation-real-')));
    const databases = [],
      instances = [],
      devices = [],
      clients = [];
    t.after(async () => {
      for (const device of devices) await device.runtime.close();
      for (const instance of instances) await instance.close();
      for (const client of clients) await client.$disconnect();
      try {
        for (const name of databases) await admin.$executeRawUnsafe(`DROP DATABASE "${name}"`);
      } finally {
        await admin.$disconnect();
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
    async function prepare(prefix) {
      const instanceId = prefix + randomUUID().replaceAll('-', '').slice(0, 12);
      const name = `knowra_acceptance_${instanceId}`;
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      databases.push(name);
      const url = new URL(adminUrl);
      url.pathname = '/' + name;
      execFileSync(
        process.execPath,
        ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
        {
          cwd: repositoryRoot,
          env: { ...process.env, DATABASE_URL: url.toString() },
          stdio: 'pipe',
          timeout: 60000
        }
      );
      return {
        instanceId,
        dataRoot: path.join(root, instanceId),
        databaseUrl: url.toString(),
        port: 0,
        testEphemeralPort: true,
        publicOrigin: 'https://qa.example.test'
      };
    }
    const aConfig = await prepare('a'),
      bConfig = await prepare('b');
    const a = await startIsolatedInstance(aConfig);
    instances.push(a);
    const b = await startIsolatedInstance(bConfig);
    instances.push(b);
    const call = async (origin, route, method = 'GET', body, extra = {}) => {
      const response = await fetch(origin + route, {
        method,
        headers: { 'Content-Type': 'application/json', ...extra },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      return { status: response.status, body: await response.json() };
    };
    const page = await fetch(a.origin);
    assert.equal(page.headers.get('X-Knowra-Test-Instance'), aConfig.instanceId);
    assert((await page.text()).includes('测试环境 · 仅合成资料'));
    assert.equal((await call(a.origin, '/api/health')).body.data.testInstance, aConfig.instanceId);
    assert.equal(
      (await call(a.origin, '/api/ai/model-settings', 'POST', { apiKey: 'synthetic-never-save' })).status,
      503
    );
    await run(process.execPath, ['scripts/verify-isolated-instance.mjs', a.origin, aConfig.instanceId], {
      cwd: repositoryRoot,
      timeout: 10000
    });
    assert.equal(
      (await call(a.origin, '/api/knowledge/spaces/default', 'POST', {}, { Origin: 'https://untrusted.example.test' }))
        .status,
      403
    );
    const space = (await call(a.origin, '/api/knowledge/spaces/default', 'POST', {}, { Origin: aConfig.publicOrigin }))
      .body.data;
    const noteResponse = await call(a.origin, '/api/knowledge/notes', 'POST', {
      spaceId: space.id,
      title: '合成隔离样本',
      rawMarkdown: '独立A正文'
    });
    assert.equal(noteResponse.status, 201);
    const note = noteResponse.body.data;
    assert.equal((await call(b.origin, `/api/knowledge/notes/${note.id}`)).status, 404);
    const attachment = await call(a.origin, '/api/storage/attachments', 'POST', {
      noteId: note.id,
      fileName: '合成.txt',
      contentBase64: Buffer.from('synthetic').toString('base64')
    });
    assert.equal(attachment.status, 201);
    assert.equal((await call(b.origin, '/api/storage/attachments')).body.data.length, 0);
    const statusA = (await call(a.origin, '/api/sync/status')).body.data;
    const statusB = (await call(b.origin, '/api/sync/status')).body.data;
    assert.notEqual(statusA.datasetEpoch, statusB.datasetEpoch);
    assert.equal(statusA.ownerId, 'demo');
    assert.equal(statusB.ownerId, 'demo');
    for (const id of ['device_a', 'device_b']) {
      const directory = path.join(root, id);
      const runtime = await startLocalRuntime({
        dataDirectory: directory,
        distRoot: path.join(repositoryRoot, 'apps/web/dist'),
        syncOptions: { intervalMs: 3600000 }
      });
      const session = await fetch(runtime.launchUrl, { redirect: 'manual' });
      const cookie = session.headers.get('set-cookie').split(';')[0];
      const device = { runtime, directory, cookie };
      devices.push(device);
      const configured = await call(
        runtime.origin,
        '/api/local-runtime/sync/configure',
        'POST',
        { serverUrl: a.origin },
        { Cookie: cookie }
      );
      assert.equal(configured.status, 200);
      assert.equal(configured.body.data.error, null);
      const visibleSpaces = await call(runtime.origin, '/api/knowledge/spaces', 'GET', undefined, { Cookie: cookie });
      assert(
        visibleSpaces.body.data.some(item => item.id === space.id),
        '默认桌面空间列表必须能看到同步空间'
      );
      const defaultSpace = await call(runtime.origin, '/api/knowledge/spaces/default', 'POST', {}, { Cookie: cookie });
      assert.equal(defaultSpace.status, 201);
      assert.equal(defaultSpace.body.data.id, space.id);
      assert.equal(
        (await call(runtime.origin, `/api/knowledge/notes/${note.id}`, 'GET', undefined, { Cookie: cookie })).body.data
          .rawMarkdown,
        '独立A正文'
      );
    }
    assert.equal(
      (
        await call(
          devices[0].runtime.origin,
          `/api/knowledge/notes/${note.id}`,
          'PATCH',
          {
            rawMarkdown: '合成设备离线后提交',
            expectedUpdatedAt: note.updatedAt
          },
          { Cookie: devices[0].cookie }
        )
      ).status,
      200
    );
    for (const device of devices) {
      const synced = await call(
        device.runtime.origin,
        '/api/local-runtime/sync/retry',
        'POST',
        {},
        { Cookie: device.cookie }
      );
      assert.equal(synced.status, 200);
      assert.equal(synced.body.data.error, null);
    }
    assert.equal(
      (
        await call(devices[1].runtime.origin, `/api/knowledge/notes/${note.id}`, 'GET', undefined, {
          Cookie: devices[1].cookie
        })
      ).body.data.rawMarkdown,
      '合成设备离线后提交'
    );
    assert.equal((await call(a.origin, `/api/knowledge/notes/${note.id}`)).body.data.rawMarkdown, '合成设备离线后提交');
    await devices[0].runtime.close();
    const reopenedDevice = await startLocalRuntime({
      dataDirectory: devices[0].directory,
      distRoot: path.join(repositoryRoot, 'apps/web/dist'),
      syncOptions: { intervalMs: 3600000 }
    });
    devices.push({ runtime: reopenedDevice });
    assert.equal(reopenedDevice.store.state.notes.find(item => item.id === note.id).rawMarkdown, '合成设备离线后提交');
    await a.close();
    const restarted = await startIsolatedInstance(aConfig);
    instances.push(restarted);
    await run(
      process.execPath,
      ['scripts/verify-isolated-instance.mjs', restarted.origin, aConfig.instanceId, '--verify-existing'],
      { cwd: repositoryRoot, timeout: 10000 }
    );
    assert.equal(
      (await call(restarted.origin, `/api/knowledge/notes/${note.id}`)).body.data.rawMarkdown,
      '合成设备离线后提交'
    );
    assert.equal((await call(restarted.origin, '/api/storage/attachments')).body.data.length, 1);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(aConfig.dataRoot, 'instance.json'), 'utf8')).instanceId,
      aConfig.instanceId
    );
    const migration = await run(process.execPath, ['scripts/migrate-isolated-test.mjs'], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        KNOWRA_TEST_INSTANCE: aConfig.instanceId,
        KNOWRA_TEST_DATA_ROOT: aConfig.dataRoot,
        KNOWRA_TEST_DATABASE_URL: aConfig.databaseUrl
      },
      timeout: 30000
    });
    assert(migration.stdout.includes('专用测试数据库迁移完成'));
    await assert.rejects(
      run(process.execPath, ['scripts/migrate-isolated-test.mjs'], {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          KNOWRA_TEST_INSTANCE: aConfig.instanceId,
          KNOWRA_TEST_DATA_ROOT: path.join(root, 'wrong_root'),
          KNOWRA_TEST_DATABASE_URL: aConfig.databaseUrl
        },
        timeout: 10000
      }),
      error => error.code === 1
    );
    await assert.rejects(
      startIsolatedInstance({ ...aConfig, dataRoot: path.join(root, 'wrong_root') }),
      /数据库绑定其他实例/
    );
    fs.symlinkSync(bConfig.dataRoot, path.join(aConfig.dataRoot, 'unexpected-link'));
    await assert.rejects(startIsolatedInstance(aConfig), /符号链接/);
    fs.unlinkSync(path.join(aConfig.dataRoot, 'unexpected-link'));
    await b.close();
    const raw = new PrismaClient({ datasources: { db: { url: bConfig.databaseUrl } }, log: [] });
    clients.push(raw);
    await raw.$executeRawUnsafe('DROP TABLE knowra_acceptance_instance');
    await raw.user.create({ data: { id: 'synthetic_existing' } });
    // 构造真正有待应用迁移的非空旧库；后置拒绝无法撤销迁移CLI写入。
    await raw.$executeRawUnsafe('DROP TABLE core_operation_receipts');
    await raw.$executeRawUnsafe("DELETE FROM _prisma_migrations WHERE migration_name = 'f_core_operation_receipts'");
    fs.rmSync(bConfig.dataRoot, { recursive: true });
    const beforeMigrations = await raw.$queryRawUnsafe('SELECT count(*)::text AS count FROM _prisma_migrations');
    await assert.rejects(
      run(process.execPath, ['scripts/migrate-isolated-test.mjs'], {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          KNOWRA_TEST_INSTANCE: bConfig.instanceId,
          KNOWRA_TEST_DATA_ROOT: bConfig.dataRoot,
          KNOWRA_TEST_DATABASE_URL: bConfig.databaseUrl
        },
        timeout: 10000
      }),
      error => {
        assert(!error.stderr.includes(bConfig.databaseUrl));
        return error.code === 1 && error.stderr.includes('专用测试迁移失败');
      }
    );
    assert.deepEqual(
      await raw.$queryRawUnsafe('SELECT count(*)::text AS count FROM _prisma_migrations'),
      beforeMigrations
    );
    assert.equal(
      (await raw.$queryRawUnsafe("SELECT to_regclass('public.core_operation_receipts')::text AS name"))[0].name,
      null
    );
    await assert.rejects(startIsolatedInstance(bConfig), /已有数据/);
    assert.equal(await raw.user.count(), 2);
  }
);

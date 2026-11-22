import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createAppContext } from '../../../api/src/app.factory.ts';
import { createFileDataStore } from '../../../api/src/infrastructure/file-data-store.ts';
import { createServer } from '../../../api/src/server.ts';
import { startLocalRuntime } from '../../src/runtime-server.mjs';
import { temporaryDirectory } from '../helpers.mjs';
import { closeLocalSync, openLocalSync, withWorkspaceStatus } from './helpers/workspace-status.mjs';

async function listen(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('首次使用桌面：离线建笔记和附件，连接失败保留资料，改正地址后上传', { timeout: 60000 }, async t => {
  const root = temporaryDirectory(t);
  const storageRootDir = path.join(root, 'cloud');
  const dataStore = createFileDataStore(path.join(storageRootDir, 'cloud.json'));
  const cloud = await listen(
    t,
    createServer({
      appContext: createAppContext({ dataStore, storageRootDir, uploadsDir: path.join(storageRootDir, 'uploads') })
    })
  );
  const unavailable = await listen(
    t,
    createHttpServer((request, response) => {
      response.writeHead(request.url === '/api/sync/status' ? 503 : 404);
      response.end();
    })
  );
  const runtime = await startLocalRuntime({
    dataDirectory: path.join(root, 'desktop'),
    distRoot: fileURLToPath(new URL('../../../web/dist/', import.meta.url)),
    syncOptions: { autoSync: false }
  });
  t.after(() => runtime.close());
  const browser = await chromium.launch({
    ...(process.env.V4_BROWSER_CHANNEL === 'chrome' ? { channel: 'chrome' } : {})
  });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // 所有资料和服务都是合成夹具；不借外网状态模拟离线。
  await context.route('**/*', route =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
  );
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  await page.goto(runtime.launchUrl);
  const offline = page.getByRole('button', { name: /本地资料.*连接云端/ });
  await expect(offline).toBeVisible();
  await page.goto(`${runtime.origin}/#/materials?scope=root`);
  const index = page.getByRole('article', { name: '笔记索引', exact: true });
  await index
    .getByRole('toolbar', { name: '笔记索引工具栏', exact: true })
    .getByRole('button', { name: '新建', exact: true })
    .click();
  await page.getByRole('menuitem', { name: '新建笔记', exact: true }).click();
  const title = '首启离线笔记';
  const create = page.getByRole('dialog', { name: '新建笔记', exact: true });
  await create.getByRole('textbox', { name: '笔记名称', exact: true }).fill(title);
  const [created] = await Promise.all([
    page.waitForResponse(
      response => response.url() === `${runtime.origin}/api/knowledge/notes` && response.request().method() === 'POST'
    ),
    create.getByRole('button', { name: '创建', exact: true }).click()
  ]);
  assert.equal(created.status(), 201);
  const { id } = (await created.json()).data;
  await expect(create).toBeHidden();
  await index.getByRole('button', { name: title, exact: true }).click();
  const editor = page.locator('.ProseMirror');
  const text = '这段合成正文先保存在本机。';
  await editor.click();
  await page.keyboard.insertText(text);
  await withWorkspaceStatus(page, status => expect(status).toContainText('已保存到本机'));

  const uploadButton = page.getByRole('button', { name: '上传附件', exact: true });
  if (!(await uploadButton.isVisible())) await page.getByRole('button', { name: '切换文档检查器' }).click();
  const fileName = '首启附件.txt';
  const file = Buffer.from('synthetic first-run attachment');
  await page.getByLabel('选择要上传的附件').setInputFiles({ name: fileName, mimeType: 'text/plain', buffer: file });
  await expect(page.getByRole('button', { name: `打开附件 ${fileName}`, exact: true })).toBeVisible();

  async function getData(origin, pathname) {
    const response = await context.request.get(`${origin}${pathname}`);
    assert.equal(response.ok(), true, `HTTP ${response.status()} ${pathname}`);
    return (await response.json()).data;
  }
  const notePath = `/api/knowledge/notes/${id}`;
  const [attachment] = await getData(runtime.origin, `/api/storage/attachments?noteId=${encodeURIComponent(id)}`);
  assert.equal(attachment.fileName, fileName);
  const verifyBytes = async origin => {
    const response = await context.request.get(`${origin}/api/storage/attachments/${attachment.id}/content`);
    assert.equal(response.status(), 200);
    assert.deepEqual(await response.body(), file);
  };
  await expect.poll(async () => (await getData(runtime.origin, notePath)).rawMarkdown).toBe(text);
  const initial = await getData(runtime.origin, '/api/local-runtime/status');
  assert.equal(initial.cloudSync, 'not-configured');
  assert(initial.pendingOperations > 0);

  const dialog = await openLocalSync(page, /本地资料.*连接云端/);
  const status = dialog.getByRole('region', { name: '同步状态', exact: true });
  const address = dialog.getByRole('textbox', { name: '云端服务地址', exact: true });
  const account = dialog.getByLabel('服务账号', { exact: true });
  const password = dialog.getByLabel('服务密码', { exact: true });
  const connect = dialog.getByRole('button', { name: '连接并比较资料', exact: true });
  await expect(status).toContainText('仍可离线编辑');
  await address.fill(unavailable);
  await connect.click();
  await expect(dialog.getByRole('alert')).toContainText('云端服务暂不可用（503）');
  await expect(status).toContainText('本地资料待连接');
  await expect(connect).toBeEnabled();
  await closeLocalSync(page);
  await expect(editor).toContainText(text);
  assert.equal((await getData(runtime.origin, notePath)).rawMarkdown, text);
  await verifyBytes(runtime.origin);
  const afterFailure = await getData(runtime.origin, '/api/local-runtime/status');
  assert.equal(afterFailure.cloudSync, 'not-configured');
  assert.equal(afterFailure.pendingOperations, initial.pendingOperations);
  assert.equal(dataStore.state.notes.length, 0);

  await openLocalSync(page, /本地资料待连接.*连接失败/);
  await address.fill(cloud);
  await account.fill('synthetic-account');
  await password.fill('synthetic-password');
  await connect.click();
  await expect(status).toContainText('云端已同步');
  await expect(status).toContainText(cloud);
  await expect(status).toContainText('上次同步');
  await expect(status.getByRole('button', { name: '立即同步', exact: true })).toBeEnabled();
  await expect(status.getByRole('button', { name: '连接设置', exact: true })).toBeVisible();
  for (const field of [address, account, password]) await expect(field).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  const synced = await getData(runtime.origin, '/api/local-runtime/sync');
  assert.equal(synced.serverUrl, cloud);
  assert.equal(synced.phase, 'synced');
  assert.equal(synced.pendingEntities, 0);
  assert.equal((await getData(cloud, notePath)).rawMarkdown, text);
  await verifyBytes(cloud);
  await status.getByRole('button', { name: '连接设置', exact: true }).click();
  await expect(account).toBeVisible();
  await expect(password).toHaveValue('');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(password).toHaveCount(0);
  await closeLocalSync(page);
  await expect(page.getByRole('button', { name: '本地资料已同步', exact: true })).toBeVisible();
  await expect(editor).toContainText(text);
  assert.deepEqual(problems, []);
});

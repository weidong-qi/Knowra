import { openLocalSync, closeLocalSync, withWorkspaceStatus } from './helpers/workspace-status.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { createFileDataStore } from '../../../api/src/infrastructure/file-data-store.ts';
import { createAppContext } from '../../../api/src/app.factory.ts';
import { createServer } from '../../../api/src/server.ts';
import { startLocalRuntime } from '../../src/runtime-server.mjs';

test('真实页面连接云端、后台刷新正文、三份冲突对照与手动合并', { timeout: 60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-sync-ui-'));
  const dataStore = createFileDataStore(path.join(root, 'cloud.json'));
  const cloud = createAppContext({ dataStore, storageRootDir: root, uploadsDir: path.join(root, 'uploads') });
  const space = cloud.modules.knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const note = cloud.modules.knowledge.noteService.createNote({
    title: '双向同步页面验收',
    rawMarkdown: '页面共同基线',
    spaceId: space.id
  });
  const server = createServer({ appContext: cloud, logger: { error() {} } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  let cloudReachable = false;
  const runtime = await startLocalRuntime({
    dataDirectory: path.join(root, 'local'),
    distRoot: fileURLToPath(new URL('../../../web/dist/', import.meta.url)),
    syncOptions: {
      autoSync: false,
      fetcher: (url, options) =>
        cloudReachable
          ? fetch(url, options)
          : Promise.reject(
              new TypeError('fetch failed', {
                cause: Object.assign(new Error('name lookup failed'), { code: 'ENOTFOUND' })
              })
            )
    }
  });
  const browser = await chromium.launch({
    ...(process.env.V4_BROWSER_CHANNEL === 'chrome' ? { channel: 'chrome' } : {})
  });
  t.after(async () => {
    await browser.close();
    await runtime.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  await page.goto(runtime.launchUrl);
  await openLocalSync(page, /本地资料.*连接云端/);
  await page.getByLabel(/云端服务地址/).fill(origin);
  await page.getByRole('button', { name: '连接并比较资料', exact: true }).click();
  const syncDialog = page.getByRole('dialog', { name: '云端同步', exact: true });
  await expect(syncDialog.getByRole('alert')).toContainText('无法解析云端服务地址');
  await syncDialog.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await expect(syncDialog).toBeHidden();
  await expect(page.getByRole('button', { name: /本地资料待连接.*连接失败/ })).toBeVisible();
  cloudReachable = true;
  await openLocalSync(page, /本地资料待连接.*连接失败/);
  await page.getByRole('button', { name: '连接并比较资料', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '云端同步', exact: true })).toContainText('云端已同步');
  await closeLocalSync(page);
  if (process.env.KNOWRA_E2E_OUTPUT) {
    fs.mkdirSync(process.env.KNOWRA_E2E_OUTPUT, { recursive: true });
    await page.setViewportSize({ width: 960, height: 750 });
    await page.screenshot({
      path: path.join(process.env.KNOWRA_E2E_OUTPUT, 'sync-status-960.png'),
      animations: 'disabled'
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await page.goto(`${runtime.origin}/#/materials/notes/${note.id}`);
  await expect(page.locator('.ProseMirror')).toContainText('页面共同基线');
  const workspaceReads = [];
  const recordReads = request => {
    if (request.method() === 'GET' && request.url().includes('/api/knowledge/')) workspaceReads.push(request.url());
  };
  await openLocalSync(page, '本地资料已同步');
  page.on('request', recordReads);
  for (let round = 0; round < 3; round++) {
    const completed = page.waitForResponse(response => response.url().endsWith('/api/local-runtime/sync/retry'));
    await page.getByRole('button', { name: '立即同步', exact: true }).click();
    await completed;
    await expect(page.getByRole('button', { name: '立即同步', exact: true })).toBeEnabled();
  }
  assert.deepEqual(workspaceReads, [], '无资料变化的同步不能重新加载工作区');
  page.off('request', recordReads);
  const wake = page.waitForRequest(request => request.url().endsWith('/api/local-runtime/sync/wake'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  assert.equal((await wake).postDataJSON().reason, 'focus');
  await closeLocalSync(page);
  // 当前页面保持打开；远端更新后通过同步静默刷新，不需要重新导航。
  cloud.modules.knowledge.noteService.updateNote(note.id, { rawMarkdown: '网页先更新' });
  await openLocalSync(page, '本地资料已同步');
  await page.getByRole('button', { name: '立即同步', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '云端同步', exact: true })).toContainText('云端已同步');
  await closeLocalSync(page);
  await expect(page.locator('.ProseMirror')).toContainText('网页先更新');
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(' 本机保留的段落');
  await withWorkspaceStatus(page, status => expect(status).toContainText('已保存到本机'));
  cloud.modules.knowledge.noteService.updateNote(note.id, { title: '云端重命名', rawMarkdown: '云端并发的段落' });
  await openLocalSync(page, /待同步|云端已同步/);
  await page.getByRole('button', { name: '立即同步', exact: true }).click();
  const conflict = page.getByRole('region', { name: '冲突：双向同步页面验收' });
  await expect(conflict).toContainText('本机保留的段落');
  await expect(conflict).toContainText('云端并发的段落');
  await expect(conflict.locator('[data-diff="removed"]').filter({ hasText: '本机保留的段落' })).toBeVisible();
  await expect(conflict.locator('[data-diff="added"]').filter({ hasText: '云端并发的段落' })).toBeVisible();
  const titleRow = conflict
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: '标题', exact: true }) });
  await expect(titleRow).toContainText('云端重命名');
  await expect(titleRow).toContainText('已变化');
  await expect(
    conflict.getByRole('row').filter({ has: page.getByRole('rowheader', { name: '对象状态', exact: true }) })
  ).toContainText('存在');
  await conflict.getByLabel('正文比较', { exact: false }).first().click();
  await page.getByRole('option', { name: '共同基线 → 本机' }).click();
  await expect(conflict).toContainText('网页先更新');
  await expect(conflict.locator('[data-diff="removed"]')).toContainText('网页先更新');
  await conflict.getByLabel('正文比较', { exact: false }).first().click();
  await page.getByRole('option', { name: '共同基线 → 云端' }).click();
  await expect(conflict.locator('[data-diff="added"]')).toContainText('云端并发的段落');
  const screenshots = process.env.KNOWRA_E2E_OUTPUT;
  if (screenshots) {
    fs.mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, 'sync-conflict-overview.png'), animations: 'disabled' });
    await conflict.getByRole('region', { name: '共同基线与云端的正文差异' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(screenshots, 'sync-conflict.png'), animations: 'disabled' });
  }
  await conflict.getByRole('button', { name: '手动合并', exact: true }).click();
  await conflict.getByLabel('合并后的正文', { exact: false }).fill('手动合并：保留本机和云端两段');
  await conflict.getByRole('button', { name: '保存合并结果', exact: true }).click();
  await expect(conflict).toHaveCount(0);
  await closeLocalSync(page);
  await expect(page.locator('.ProseMirror')).toContainText('手动合并：保留本机和云端两段');
  assert.equal(cloud.modules.knowledge.noteService.getNote(note.id).rawMarkdown, '手动合并：保留本机和云端两段');
  const versions = (
    await (await context.request.get(`${runtime.origin}/api/knowledge/notes/${note.id}/versions`)).json()
  ).data;
  assert.equal(new Set(versions.map(version => version.contentHash)).size, versions.length);
  assert.deepEqual(problems, []);
  if (screenshots) await page.screenshot({ path: path.join(screenshots, 'sync-resolved.png') });
  await openLocalSync(page, '本地资料已同步');
  await page.getByRole('button', { name: '暂停云端同步', exact: true }).click();
  await closeLocalSync(page);
  await expect(page.getByRole('button', { name: /仅使用本地资料.*云端同步已暂停/ })).toBeVisible();
});

import { knowledgeCreateButton } from './helpers/knowledge-index.mjs';
import { openLocalSync, closeLocalSync } from './helpers/workspace-status.mjs';
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
import { createV4WebServer } from '../../../web/server/app.mjs';
import { startLocalRuntime } from '../../src/runtime-server.mjs';
import { inlineId } from '../helpers.mjs';

test('真实页面：标注来源审核与过期保护；桌面离线新建、确认和重载回读', { timeout: 60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-knowledge-ui-'));
  const file = path.join(root, 'cloud.json');
  const dataStore = createFileDataStore(file);
  const cloud = createAppContext({ dataStore, storageRootDir: root, uploadsDir: path.join(root, 'uploads') });
  const k = cloud.modules.knowledge;
  const space = k.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  // 章节重点写在正文标记里，服务端派生重点行。
  const raw = '# 注意力机制 <!--k attention s=section-->\n根据相关程度对信息加权。';
  const note = k.noteService.createNote({ title: '知识流程验收', rawMarkdown: raw, spaceId: space.id });
  const annotation = k.contentAnnotationService.getAnnotation(inlineId(note.id, 'attention'));
  const server = createServer({ appContext: cloud });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const distRoot = fileURLToPath(new URL('../../../web/dist/', import.meta.url));
  const web = createV4WebServer({ distRoot, getApiOrigin: () => origin });
  web.listen(0, '127.0.0.1');
  await once(web, 'listening');
  const webOrigin = `http://127.0.0.1:${web.address().port}`;
  const runtime = await startLocalRuntime({
    dataDirectory: path.join(root, 'local'),
    distRoot,
    syncOptions: { autoSync: false }
  });
  let browser;
  t.after(async () => {
    await browser?.close();
    await runtime.close();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => web.close(resolve))]);
    fs.rmSync(root, { recursive: true, force: true });
  });
  browser = await chromium.launch({
    ...(process.env.KNOWRA_TEST_BROWSER_CHANNEL ? { channel: process.env.KNOWRA_TEST_BROWSER_CHANNEL } : {}),
    ...(process.env.KNOWRA_TEST_BROWSER_EXECUTABLE
      ? { executablePath: process.env.KNOWRA_TEST_BROWSER_EXECUTABLE }
      : {})
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${webOrigin}/#/materials/notes/${note.id}`);
  await expect(page.locator('.ProseMirror')).toContainText('根据相关程度');
  if (!(await page.getByRole('tab', { name: '标注', exact: true }).isVisible()))
    await page.getByRole('button', { name: '切换文档检查器' }).click();
  await page.getByRole('tab', { name: '标注', exact: true }).click();
  await page.getByRole('button', { name: '重点 1 更多操作' }).click();
  await page.getByRole('menuitem', { name: '创建知识候选' }).click();
  const dialog = page.getByRole('dialog', { name: '从标注创建知识候选' });
  await dialog.getByLabel('标题', { exact: true }).fill('注意力加权');
  await dialog.getByLabel('核心陈述').fill('注意力机制依据相关程度为信息分配权重。');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: '知识库', exact: true })).toBeVisible();
  await expect.poll(() => dataStore.state.knowledgeItems.length).toBe(1);
  const candidate = dataStore.state.knowledgeItems[0];
  assert.equal(candidate.reviewStatus, 'candidate');
  const evidence = dataStore.state.knowledgeEvidence[0];
  assert.equal(evidence.annotationId, annotation.id);
  assert.equal(evidence.quoteText, annotation.quoteText);
  await page.getByRole('button', { name: '确认知识', exact: true }).click();
  await expect.poll(() => dataStore.state.knowledgeItems[0].reviewStatus).toBe('confirmed');
  await page.reload();
  await expect(page.getByRole('heading', { name: '注意力加权', exact: true })).toBeVisible();
  const persisted = createFileDataStore(file);
  assert.equal(persisted.state.knowledgeItems[0].reviewStatus, 'confirmed');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const edit = page.getByRole('dialog', { name: '编辑知识' });
  await edit.getByLabel('核心陈述').fill('本页未保存的修改');
  k.knowledgeItemService.updateItem(candidate.id, {
    canonicalStatement: '另一个页面已更新',
    expectedUpdatedAt: dataStore.state.knowledgeItems[0].updatedAt
  });
  await edit.getByRole('button', { name: '保存', exact: true }).click();
  await expect(edit.getByRole('alert')).toBeVisible();
  await expect(edit.getByLabel('核心陈述')).toHaveValue('本页未保存的修改');
  assert.equal(dataStore.state.knowledgeItems[0].canonicalStatement, '另一个页面已更新');
  await edit.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole('article', { name: '知识详情', exact: true }).getByText('另一个页面已更新', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: '归档', exact: true }).click();
  await page.getByRole('button', { name: '确认归档', exact: true }).click();
  await expect.poll(() => dataStore.state.knowledgeItems[0].reviewStatus).toBe('archived');
  await page.getByRole('button', { name: '恢复为候选', exact: true }).click();
  await expect.poll(() => dataStore.state.knowledgeItems[0].reviewStatus).toBe('candidate');
  await expect(page.getByRole('button', { name: '确认知识', exact: true })).toBeEnabled();
  if (process.env.KNOWRA_E2E_OUTPUT) {
    fs.mkdirSync(process.env.KNOWRA_E2E_OUTPUT, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.KNOWRA_E2E_OUTPUT, 'knowledge-workflow.png'),
      animations: 'disabled'
    });
  }
  await page.goto(`${runtime.launchUrl}`);
  await page.getByRole('navigation', { name: '工作域导航' }).getByRole('button', { name: /知识/ }).click();
  await knowledgeCreateButton(page).click();
  const localDialog = page.getByRole('dialog', { name: '新建知识候选', exact: true });
  await localDialog.getByLabel('标题', { exact: true }).fill('离线知识');
  await localDialog.getByLabel('核心陈述').fill('没有云端连接也能保存知识候选。');
  await localDialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: '离线知识', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '确认知识', exact: true }).click();
  await expect.poll(() => runtime.store.state.knowledgeItems[0]?.reviewStatus).toBe('confirmed');
  await page.reload();
  await expect(page.getByRole('heading', { name: '离线知识', exact: true })).toBeVisible();
  assert.equal(runtime.store.state.knowledgeItems[0].canonicalStatement, '没有云端连接也能保存知识候选。');
  assert(runtime.store.getStatus().pendingOperations > 0);
  const offlineId = runtime.store.state.knowledgeItems[0].id;
  await openLocalSync(page, /本地资料.*连接云端/);
  await page.getByLabel(/云端服务地址/).fill(origin);
  await page.getByRole('button', { name: '连接并比较资料', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '云端同步', exact: true })).toContainText('云端已同步');
  await closeLocalSync(page);
  assert.equal(dataStore.state.knowledgeItems.find(item => item.id === offlineId).reviewStatus, 'confirmed');
  await expect(page.getByRole('button', { name: /注意力加权/ })).toBeVisible();
  const cloudOffline = dataStore.state.knowledgeItems.find(item => item.id === offlineId);
  k.knowledgeItemService.updateItem(offlineId, {
    canonicalStatement: '云端改动同步后自动显示。',
    expectedUpdatedAt: cloudOffline.updatedAt
  });
  const syncReply = await page.request.post(`${runtime.origin}/api/local-runtime/sync/retry`, { data: {} });
  assert.equal(syncReply.status(), 200);
  // 面板关闭后的空闲状态查询间隔为 10 秒。
  await expect(page.getByRole('article', { name: '知识详情', exact: true })).toContainText('云端改动同步后自动显示。', {
    timeout: 15000
  });
  assert.deepEqual(errors, []);
});

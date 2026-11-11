import { knowledgeCreateButton, selectKnowledgeStatus } from './helpers/knowledge-index.mjs';
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
import { createAppContext } from '../../../api/src/app.factory.js';
import { createServer } from '../../../api/src/server.js';
import { startLocalRuntime } from '../../src/runtime-server.mjs';

// 合成资料、真实 HTTP 云端、生产 V4 和 SQLite；不替换页面 API。
async function fixture(t, title, withSource = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-knowledge-lifecycle-ui-'));
  const dataStore = createFileDataStore(path.join(root, 'cloud.json'));
  const cloud = createAppContext({ dataStore, storageRootDir: root, uploadsDir: path.join(root, 'uploads') });
  const service = cloud.modules.knowledge.knowledgeItemService;
  cloud.modules.knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  const { item, evidence } = service.createCandidate({
    title,
    canonicalStatement: '合成知识的共同基线',
    sourceMode: withSource ? 'annotation' : 'manual',
    ...(withSource ? { evidence: [{ sourceType: 'manual', quoteText: '保留的合成来源摘录' }] } : {})
  });
  service.confirmItem(item.id);
  const server = createServer({ appContext: cloud });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const options = {
    dataDirectory: path.join(root, 'local'),
    distRoot: fileURLToPath(new URL('../../../web/dist/', import.meta.url)),
    syncOptions: { autoSync: false }
  };
  let runtime = await startLocalRuntime(options);
  let browser;
  t.after(async () => {
    await browser?.close();
    await runtime.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  browser = await chromium.launch({
    ...(process.env.KNOWRA_TEST_BROWSER_CHANNEL ? { channel: process.env.KNOWRA_TEST_BROWSER_CHANNEL } : {}),
    ...(process.env.KNOWRA_TEST_BROWSER_EXECUTABLE
      ? { executablePath: process.env.KNOWRA_TEST_BROWSER_EXECUTABLE }
      : {})
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', route =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  async function syncRequest(action, data) {
    const response =
      data === undefined
        ? await context.request.get(`${runtime.origin}/api/local-runtime/sync${action}`)
        : await context.request.post(`${runtime.origin}/api/local-runtime/sync${action}`, { data });
    assert.equal(response.status(), 200, await response.text());
    return (await response.json()).data;
  }
  async function openSync() {
    await openLocalSync(page, /本地资料|云端|同步|需要核对/);
    return page.getByRole('dialog', { name: '云端同步', exact: true });
  }
  await page.goto(runtime.launchUrl);
  // 首次资料加载会从 loading 切换为 api；状态详情内的同步入口依赖真实资料模式。
  // 先等待真实本地工作区可写，避免在初始化期间点开随后被重挂载的面板。
  await page.getByRole('navigation', { name: '工作域导航' }).getByRole('button', { name: /知识/ }).click();
  await expect(knowledgeCreateButton(page)).toBeEnabled();
  const sync = await openSync();
  await sync.getByLabel(/云端服务地址/).fill(origin);
  await sync.getByRole('button', { name: '连接并比较资料', exact: true }).click();
  await expect(sync.locator('p[role="status"]')).toContainText('云端已同步');
  await closeLocalSync(page);
  await page.getByRole('navigation', { name: '工作域导航' }).getByRole('button', { name: /知识/ }).click();
  await page.getByRole('button', { name: new RegExp(title) }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  return {
    page,
    context,
    dataStore,
    item,
    evidence,
    errors,
    origin,
    openSync,
    syncRequest,
    get runtime() {
      return runtime;
    },
    async restart() {
      await runtime.close();
      runtime = await startLocalRuntime(options);
      await page.goto(runtime.launchUrl);
    },
    async screenshot(name) {
      if (!process.env.KNOWRA_E2E_OUTPUT) return;
      fs.mkdirSync(process.env.KNOWRA_E2E_OUTPUT, { recursive: true });
      await page.screenshot({ path: path.join(process.env.KNOWRA_E2E_OUTPUT, name), animations: 'disabled' });
    }
  };
}

test('生产页面：知识撤回、回收站、SQLite重启、显式恢复与重新采用来源同步收敛', { timeout: 90000 }, async t => {
  const f = await fixture(t, '回收站生命周期验收', true);
  const { page, item } = f;
  await page.getByRole('button', { name: '撤回适用性', exact: true }).click();
  await page
    .getByRole('dialog', { name: '撤回这条来源的适用性？' })
    .getByRole('button', { name: '确认移除', exact: true })
    .click();
  await expect.poll(() => f.runtime.store.state.knowledgeEvidence[0]?.applicabilityStatus).toBe('withdrawn');
  await page.getByRole('button', { name: '移入回收站', exact: true }).click();
  await page
    .getByRole('dialog', { name: '移入知识回收站？' })
    .getByRole('button', { name: '确认移入回收站', exact: true })
    .click();
  await selectKnowledgeStatus(page, /^回收站/);
  await page.getByRole('button', { name: /回收站生命周期验收/ }).click();
  await expect(page.getByRole('button', { name: '从回收站恢复', exact: true })).toBeVisible();
  assert(f.runtime.store.state.knowledgeItems.find(row => row.id === item.id).deletedAt);
  await expect(page.getByRole('button', { name: '重新采用', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0);
  await f.screenshot('knowledge-trash.png');
  await f.restart();
  await page.getByRole('navigation', { name: '工作域导航' }).getByRole('button', { name: /知识/ }).click();
  await selectKnowledgeStatus(page, /^回收站/);
  await page.getByRole('button', { name: /回收站生命周期验收/ }).click();
  await expect(page.getByRole('article', { name: '知识详情' })).toContainText('保留的合成来源摘录');
  await expect(page.getByRole('button', { name: '从回收站恢复', exact: true })).toBeVisible();
  await f.screenshot('knowledge-trash-after-restart.png');
  await page.getByRole('button', { name: '从回收站恢复', exact: true }).click();
  await expect.poll(() => f.runtime.store.state.knowledgeItems.find(row => row.id === item.id).deletedAt).toBe(null);
  assert.equal(f.runtime.store.state.knowledgeItems.find(row => row.id === item.id).reviewStatus, 'needsRevision');
  assert.equal(f.runtime.store.state.knowledgeEvidence[0].applicabilityStatus, 'withdrawn');
  await selectKnowledgeStatus(page, /^全部未归档/);
  await page.getByRole('button', { name: /回收站生命周期验收/ }).click();
  await expect(page.getByRole('button', { name: '确认知识', exact: true })).toBeDisabled();
  await f.screenshot('knowledge-restored-withdrawn.png');
  await page.getByRole('button', { name: '重新采用', exact: true }).click();
  await expect.poll(() => f.runtime.store.state.knowledgeEvidence[0].applicabilityStatus).toBe('active');
  await page.getByRole('button', { name: '确认知识', exact: true }).click();
  await expect
    .poll(() => f.runtime.store.state.knowledgeItems.find(row => row.id === item.id).reviewStatus)
    .toBe('confirmed');
  const sync = await f.openSync();
  await sync.getByRole('button', { name: '更新登录并同步', exact: true }).click();
  await expect(sync.locator('p[role="status"]')).toContainText('云端已同步');
  assert.equal(f.dataStore.state.knowledgeItems.find(row => row.id === item.id).deletedAt, null);
  assert.equal(f.dataStore.state.knowledgeEvidence[0].applicabilityStatus, 'active');
  assert.equal(f.dataStore.state.knowledgeItems.find(row => row.id === item.id).reviewStatus, 'confirmed');
  await f.screenshot('knowledge-readopt-synced.png');
  await f.restart();
  assert.equal(f.runtime.store.state.knowledgeEvidence[0].applicabilityStatus, 'active');
  assert.equal(f.runtime.store.state.knowledgeItems.find(row => row.id === item.id).reviewStatus, 'confirmed');
  assert.equal((await f.syncRequest('')).pendingKnowledgeEntities, 0);
  assert.deepEqual(f.errors, []);
});

test('生产页面：云端回收站与离线旧编辑冲突跨重启保全，采用云端后显式恢复', { timeout: 90000 }, async t => {
  const f = await fixture(t, '知识删除冲突验收');
  const { page, item, context } = f;
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const edit = page.getByRole('dialog', { name: '编辑知识', exact: true });
  await edit.getByLabel('核心陈述').fill('需要保全的离线编辑');
  await edit.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('article', { name: '知识详情' })).toContainText('需要保全的离线编辑');
  const cloudTrash = await context.request.post(`${f.origin}/api/knowledge/items/${item.id}/trash`, {
    data: { expectedUpdatedAt: f.dataStore.state.knowledgeItems[0].updatedAt }
  });
  assert.equal(cloudTrash.status(), 200, await cloudTrash.text());
  const status = await f.syncRequest('/retry', {});
  assert(status.entityConflict);
  const id = status.entityConflict.id;
  const sync = await f.openSync();
  await expect(sync.getByRole('button', { name: '采用本地', exact: true })).toBeDisabled();
  await expect(sync.getByRole('row', { name: /对象状态/ })).toContainText('已移入回收站');
  await expect(sync).toContainText('再从回收站显式恢复');
  await f.screenshot('knowledge-trash-conflict.png');
  const bypass = await context.request.post(`${f.runtime.origin}/api/local-runtime/sync/resolve`, {
    data: { conflictId: id, choice: 'local' }
  });
  assert.equal(bypass.status(), 422);
  assert.equal((await bypass.json()).error.code, 'SYNC_RESTORE_REQUIRED');
  assert.equal((await f.syncRequest('')).entityConflict.id, id);
  await f.restart();
  assert.equal((await f.syncRequest('')).entityConflict.id, id);
  const reopened = await f.openSync();
  await expect(reopened.getByRole('button', { name: '采用本地', exact: true })).toBeDisabled();
  await expect(reopened).toContainText('需要保全的离线编辑');
  await f.screenshot('knowledge-trash-conflict-after-restart.png');
  await reopened.getByRole('button', { name: '采用本地', exact: true }).scrollIntoViewIfNeeded();
  await f.screenshot('knowledge-trash-conflict-actions.png');
  await reopened.getByRole('button', { name: '采用云端', exact: true }).click();
  await expect(reopened.getByRole('button', { name: '采用云端', exact: true })).toHaveCount(0);
  const recovery = await f.syncRequest('/recovery');
  assert(
    recovery.some(record =>
      record.local?.knowledgeItems.some(row => row.id === item.id && row.canonicalStatement === '需要保全的离线编辑')
    )
  );
  assert(f.runtime.store.state.knowledgeItems.find(row => row.id === item.id).deletedAt);
  await closeLocalSync(page);
  await page.getByRole('navigation', { name: '工作域导航' }).getByRole('button', { name: /知识/ }).click();
  await selectKnowledgeStatus(page, /^回收站/);
  await page.getByRole('button', { name: /知识删除冲突验收/ }).click();
  await page.getByRole('button', { name: '从回收站恢复', exact: true }).click();
  await expect.poll(() => f.runtime.store.state.knowledgeItems.find(row => row.id === item.id).deletedAt).toBe(null);
  const finalStatus = await f.syncRequest('/configure', { serverUrl: f.origin });
  assert.equal(finalStatus.entityConflict, null);
  assert.equal(finalStatus.pendingKnowledgeEntities, 0);
  assert.equal(f.dataStore.state.knowledgeItems.find(row => row.id === item.id).deletedAt, null);
  assert.equal(
    f.dataStore.state.knowledgeItems.find(row => row.id === item.id).canonicalStatement,
    '合成知识的共同基线'
  );
  assert.deepEqual(f.errors, []);
});

test('生产页面：云端永久删除知识后禁用采用本地，并保全离线内容恢复记录', { timeout: 60000 }, async t => {
  const f = await fixture(t, '知识永久删除冲突验收');
  const { page, item, context } = f;
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const edit = page.getByRole('dialog', { name: '编辑知识', exact: true });
  await edit.getByLabel('核心陈述').fill('永久删除前的离线编辑');
  await edit.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('article', { name: '知识详情' })).toContainText('永久删除前的离线编辑');
  const cloudTrash = await context.request.post(`${f.origin}/api/knowledge/items/${item.id}/trash`, {
    data: { expectedUpdatedAt: f.dataStore.state.knowledgeItems[0].updatedAt }
  });
  assert.equal(cloudTrash.status(), 200, await cloudTrash.text());
  const trashed = (await cloudTrash.json()).data;
  const purged = await context.request.delete(`${f.origin}/api/knowledge/items/${item.id}/permanent`, {
    data: { expectedUpdatedAt: trashed.updatedAt }
  });
  assert.equal(purged.status(), 200, await purged.text());
  assert.equal(
    f.dataStore.state.knowledgeItems.some(row => row.id === item.id),
    false
  );
  const status = await f.syncRequest('/retry', {});
  assert(status.entityConflict);
  const sync = await f.openSync();
  await expect(sync.getByRole('row', { name: /对象状态/ })).toContainText('已永久删除');
  await expect(sync.getByRole('button', { name: '采用本地', exact: true })).toBeDisabled();
  await expect(sync).toContainText('云端资产已永久删除，不能采用本地恢复原编号');
  await sync
    .getByRole('button', { name: '采用本地', exact: true })
    .evaluate(button => button.scrollIntoView({ block: 'end' }));
  await expect(sync.getByRole('button', { name: '采用本地', exact: true })).toBeInViewport();
  await f.screenshot('knowledge-permanent-conflict-actions.png');
  await sync.getByRole('button', { name: '采用云端', exact: true }).click();
  await expect(sync.getByRole('button', { name: '采用云端', exact: true })).toHaveCount(0);
  const recovery = await f.syncRequest('/recovery');
  assert(
    recovery.some(record =>
      record.local?.knowledgeItems.some(row => row.id === item.id && row.canonicalStatement === '永久删除前的离线编辑')
    )
  );
  assert.equal(
    f.runtime.store.state.knowledgeItems.some(row => row.id === item.id),
    false
  );
  assert.equal((await f.syncRequest('')).entityConflict, null);
  assert.deepEqual(f.errors, []);
});

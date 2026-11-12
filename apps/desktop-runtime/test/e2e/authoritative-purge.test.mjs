import { openLocalSync } from './helpers/workspace-status.mjs';
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
import { trainingAssets } from '../../../api/test/authoritative-asset-purge.test.js';

const labels = { question: '题目', examFocus: '考点', learningObjective: '学习目标', examProfile: '考试配置' };
async function fixture(t, { activeTrainingParents = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-purge-page-'));
  const store = createFileDataStore(path.join(root, 'cloud.json'));
  const app = createAppContext({ dataStore: store, storageRootDir: root, uploadsDir: path.join(root, 'uploads') });
  const knowledge = app.modules.knowledge;
  knowledge.knowledgeSpaceService.createDefaultKnowledgeSpace({ userId: 'demo' });
  function trashed(title) {
    const { item } = knowledge.knowledgeItemService.createCandidate({
      title,
      canonicalStatement: '仅合成资料，供清理页面验收',
      sourceMode: 'manual'
    });
    knowledge.knowledgeItemService.trash(item.id);
    return item;
  }
  const item = trashed('合成安全知识清理');
  const training = await trainingAssets(knowledge);
  for (const [type, , asset] of training) {
    if (!activeTrainingParents || type === 'question')
      knowledge.trainingAssetLifecycle.trash(type, asset.id, { expectedUpdatedAt: asset.updatedAt });
  }
  const { item: blocked } = knowledge.knowledgeItemService.createCandidate({
    title: '合成引用阻塞知识',
    canonicalStatement: '保留关联目标',
    sourceMode: 'manual'
  });
  knowledge.knowledgeItemService.confirmItem(blocked.id);
  knowledge.learningObjectiveService.createCandidate({
    knowledgeItemId: blocked.id,
    objective: '引用仍保留',
    actionVerb: 'explain',
    cognitiveLevel: 'understand'
  });
  knowledge.knowledgeItemService.trash(blocked.id);
  const unknown = trashed('合成未知结果知识');
  const server = createServer({ appContext: app });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  let offline = false,
    loseNextDeletion = false,
    executions = 0;
  let deletionHold, activeDeletionHold;
  const options = {
    dataDirectory: path.join(root, 'local'),
    distRoot: fileURLToPath(new URL('../../../web/dist/', import.meta.url)),
    syncOptions: {
      autoSync: false,
      fetcher: async (url, init) => {
        if (offline) throw new Error('合成离线，不访问任何外部服务');
        const response = await fetch(url, init);
        if (init?.method === 'DELETE' || (init?.method === 'POST' && url.endsWith('/purge'))) {
          executions++;
          if (loseNextDeletion) {
            loseNextDeletion = false;
            offline = true;
            throw new Error('合成服务端提交成功后丢响应');
          }
          if (deletionHold) {
            const hold = deletionHold;
            deletionHold = null;
            activeDeletionHold = hold;
            hold.entered();
            await hold.gate;
            activeDeletionHold = null;
          }
        }
        return response;
      }
    }
  };
  let runtime = await startLocalRuntime(options);
  let browser;
  t.after(async () => {
    activeDeletionHold?.release();
    deletionHold?.release();
    await browser?.close();
    await runtime.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  browser = await chromium.launch({
    ...(process.env.KNOWRA_TEST_BROWSER_EXECUTABLE
      ? { executablePath: process.env.KNOWRA_TEST_BROWSER_EXECUTABLE }
      : {})
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.route('**/*', route =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
  );
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(runtime.launchUrl);
  const response = await context.request.post(`${runtime.origin}/api/local-runtime/sync/configure`, {
    data: { serverUrl: origin }
  });
  assert.equal(response.status(), 200, await response.text());
  assert.equal((await response.json()).data.error, null);
  await page.reload();
  return {
    page,
    context,
    get runtime() {
      return runtime;
    },
    store,
    item,
    blocked,
    unknown,
    training,
    errors,
    setOffline(value) {
      offline = value;
    },
    loseDeletionResponse() {
      loseNextDeletion = true;
    },
    executions: () => executions,
    holdDeletionResponse() {
      let entered, release;
      const ready = new Promise(resolve => {
          entered = resolve;
        }),
        gate = new Promise(resolve => {
          release = resolve;
        });
      deletionHold = { entered, gate, release };
      return { ready, release };
    },
    async restart() {
      await runtime.close();
      runtime = await startLocalRuntime(options);
      await page.goto(runtime.launchUrl);
    },
    async knowledgePage(target) {
      await page.goto(`${runtime.origin}/#/knowledge?item=${target.id}`);
      await expect(page.getByRole('heading', { name: target.title, exact: true })).toBeVisible();
    },
    async screenshot(name) {
      if (!process.env.KNOWRA_E2E_OUTPUT) return;
      fs.mkdirSync(process.env.KNOWRA_E2E_OUTPUT, { recursive: true });
      await page.screenshot({ path: path.join(process.env.KNOWRA_E2E_OUTPUT, name), animations: 'disabled' });
    }
  };
}

test('生产页面：五类手工资产联网权威清理，引用阻塞与通用笔记清理能力保持关闭', { timeout: 90000 }, async t => {
  const f = await fixture(t),
    { page, runtime } = f;
  await f.knowledgePage(f.blocked);
  await page.getByRole('button', { name: '永久删除…', exact: true }).click();
  const blocked = page.getByRole('dialog', { name: '永久删除知识点？', exact: true });
  await expect(blocked).toContainText('关联对象');
  await expect(blocked.getByRole('button', { name: '确认永久删除', exact: true })).toBeDisabled();
  await f.screenshot('purge-knowledge-reference-blocked.png');
  await blocked.getByRole('button', { name: '返回回收站', exact: true }).click();
  assert(f.store.state.knowledgeItems.some(row => row.id === f.blocked.id));
  await f.knowledgePage(f.item);
  const confirmations = [];
  page.on('request', request => {
    if (request.method() === 'DELETE' && request.url().endsWith('/permanent'))
      confirmations.push(request.postDataJSON());
  });
  await page.getByRole('button', { name: '永久删除…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '永久删除知识点？', exact: true });
  await expect(dialog.getByRole('button', { name: '确认永久删除', exact: true })).toBeEnabled();
  await f.screenshot('purge-knowledge-confirmation.png');
  await dialog.getByRole('button', { name: '确认永久删除', exact: true }).click();
  await expect.poll(() => runtime.store.state.knowledgeItems.some(row => row.id === f.item.id)).toBe(false);
  assert.equal(
    f.store.state.knowledgeItems.some(row => row.id === f.item.id),
    false
  );
  assert.equal(confirmations.length, 1);
  assert(confirmations[0].confirmationToken);
  assert(confirmations[0].expectedDatasetEpoch);
  assert(
    runtime.store.deletionFacts.list().some(fact => fact.entityId === f.item.id && fact.source.kind === 'remote-delete')
  );
  await f.screenshot('purge-knowledge-confirmed.png');
  await page.goto(`${runtime.origin}/#/training`);
  await page.getByRole('group', { name: '生命周期状态' }).getByRole('button', { name: '回收站', exact: true }).click();
  for (const [type, , asset] of f.training) {
    await page
      .getByRole('group', { name: '训练资产类型' })
      .getByRole('button', { name: labels[type], exact: true })
      .click();
    await page.getByRole('button', { name: '永久清理…', exact: true }).click();
    const preview = page.getByRole('dialog', { name: `永久清理${labels[type]}？`, exact: true });
    await expect(preview.getByRole('button', { name: '确认永久清理', exact: true })).toBeEnabled();
    if (type === 'question') await f.screenshot('purge-question-confirmation.png');
    await preview.getByRole('button', { name: '确认永久清理', exact: true }).click();
    await expect(preview).toHaveCount(0);
    assert(
      runtime.store.deletionFacts
        .list()
        .some(fact => fact.entityId === asset.id && fact.source.kind === 'remote-delete')
    );
  }
  assert.equal(f.executions(), 5);
  const denied = await f.context.request.delete(
    `${runtime.origin}/api/knowledge/notes/synthetic-nonexistent/permanent`
  );
  assert.equal(denied.status(), 409);
  await f.screenshot('purge-training-confirmed.png');
  assert.deepEqual(f.errors, []);
});

for (const type of ['knowledgeItem', 'question'])
  test(
    `生产页面：${type === 'knowledgeItem' ? '知识' : '题目'}清理期间真实恢复编辑，跨SQLite重启保全冲突及恢复记录`,
    { timeout: 90000 },
    async t => {
      const f = await fixture(t, { activeTrainingParents: type === 'question' }),
        { page, context } = f;
      const asset = type === 'knowledgeItem' ? f.item : f.training.find(([kind]) => kind === 'question')[2];
      const collection = type === 'knowledgeItem' ? 'knowledgeItems' : 'questions';
      const route = type === 'knowledgeItem' ? 'items' : 'questions';
      const field = type === 'knowledgeItem' ? 'canonicalStatement' : 'stem';
      const text = `${type === 'knowledgeItem' ? '知识' : '题目'}清理期间需要保全的本地编辑`;
      if (type === 'knowledgeItem') await f.knowledgePage(asset);
      else {
        // 先等工作区就绪，再进入训练回收站。
        await f.knowledgePage(f.item);
        await page.goto(`${f.runtime.origin}/#/training`);
        await page
          .getByRole('group', { name: '生命周期状态' })
          .getByRole('button', { name: '回收站', exact: true })
          .click();
      }
      await page
        .getByRole('button', { name: type === 'knowledgeItem' ? '永久删除…' : '永久清理…', exact: true })
        .click();
      const dialog = page.getByRole('dialog', {
        name: type === 'knowledgeItem' ? '永久删除知识点？' : '永久清理题目？',
        exact: true
      });
      const confirm = dialog.getByRole('button', {
        name: type === 'knowledgeItem' ? '确认永久删除' : '确认永久清理',
        exact: true
      });
      await expect(confirm).toBeEnabled();
      const hold = f.holdDeletionResponse();
      await confirm.click();
      await hold.ready;
      try {
        // 云端已经实际提交；本地请求走融合后的正常恢复/编辑路由，不改SQLite或伪造响应。
        const current = f.runtime.store.state[collection].find(row => row.id === asset.id);
        const headers = { 'X-Knowra-Dataset': f.runtime.store.getStatus().datasetId };
        const restored = await context.request.post(
          `${f.runtime.origin}/api/knowledge/${route}/${asset.id}/restore-deleted`,
          { headers, data: { expectedUpdatedAt: current.updatedAt } }
        );
        assert.equal(restored.status(), 200, await restored.text());
        const baseline = (await restored.json()).data;
        const edited = await context.request.patch(`${f.runtime.origin}/api/knowledge/${route}/${asset.id}`, {
          headers,
          data: { expectedUpdatedAt: baseline.updatedAt, [field]: text }
        });
        assert.equal(edited.status(), 200, await edited.text());
      } finally {
        hold.release();
      }
      await expect(
        page.getByText('云端已清理，本地修改仍保留，请从同步恢复记录中处理。', { exact: true })
      ).toBeVisible();
      assert.equal(
        f.store.state[collection].some(row => row.id === asset.id),
        false
      );
      assert.equal(f.runtime.store.state[collection].find(row => row.id === asset.id)[field], text);
      const before = (await (await context.request.get(`${f.runtime.origin}/api/local-runtime/sync`)).json()).data;
      assert(before.entityConflict);
      assert.equal(before.authoritativePurge.result.localState, 'recovery-required');
      assert(
        f.runtime.store.deletionFacts
          .list()
          .some(fact => fact.entityId === asset.id && fact.source.kind === 'remote-delete')
      );
      await f.screenshot(`purge-${type}-edit-recovery-required.png`);
      await f.restart();
      assert.equal(f.runtime.store.state[collection].find(row => row.id === asset.id)[field], text);
      const after = (await (await context.request.get(`${f.runtime.origin}/api/local-runtime/sync`)).json()).data;
      assert.equal(after.entityConflict.id, before.entityConflict.id);
      assert.equal(after.authoritativePurge.result.localState, 'recovery-required');
      const pending = (await (await context.request.get(`${f.runtime.origin}/api/local-runtime/sync/recovery`)).json())
        .data;
      assert(
        pending.some(
          record =>
            record.kind === 'pending-local-data' &&
            record.snapshot[collection].some(row => row.id === asset.id && row[field] === text)
        )
      );
      await openLocalSync(page, /资料待核对/);
      const sync = page.getByRole('dialog', { name: '云端同步', exact: true });
      await expect(sync).toContainText(text);
      await expect(sync.getByRole('button', { name: '采用本地', exact: true })).toBeDisabled();
      await sync.getByRole('button', { name: '采用本地', exact: true }).scrollIntoViewIfNeeded();
      await f.screenshot(`purge-${type}-edit-conflict-after-restart.png`);
      await sync.getByRole('button', { name: '采用云端', exact: true }).click();
      await expect(sync.getByRole('button', { name: '采用云端', exact: true })).toHaveCount(0);
      const recovery = (await (await context.request.get(`${f.runtime.origin}/api/local-runtime/sync/recovery`)).json())
        .data;
      assert(
        recovery.some(
          record =>
            record.kind === 'entity-conflict' &&
            record.local[collection].some(row => row.id === asset.id && row[field] === text)
        )
      );
      assert.equal(
        f.runtime.store.state[collection].some(row => row.id === asset.id),
        false
      );
      assert.equal(f.executions(), 1);
      await f.restart();
      const retained = (await (await context.request.get(`${f.runtime.origin}/api/local-runtime/sync/recovery`)).json())
        .data;
      assert(
        retained.some(
          record =>
            record.kind === 'entity-conflict' &&
            record.local[collection].some(row => row.id === asset.id && row[field] === text)
        )
      );
      assert.deepEqual(f.errors, []);
    }
  );

test('生产页面：离线预检保留原件；云端已提交但丢响应时结果待核对且不自动重发', { timeout: 90000 }, async t => {
  const f = await fixture(t),
    { page, runtime } = f;
  await f.knowledgePage(f.unknown);
  f.setOffline(true);
  await page.getByRole('button', { name: '永久删除…', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/云端|网络/);
  assert(runtime.store.state.knowledgeItems.some(row => row.id === f.unknown.id));
  assert.equal(f.executions(), 0);
  await f.screenshot('purge-offline-original-retained.png');
  f.setOffline(false);
  await page.getByRole('button', { name: '永久删除…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '永久删除知识点？', exact: true });
  await expect(dialog.getByRole('button', { name: '确认永久删除', exact: true })).toBeEnabled();
  f.loseDeletionResponse();
  await dialog.getByRole('button', { name: '确认永久删除', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '核对清理结果', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: '确认永久删除', exact: true })).toBeDisabled();
  assert.equal(
    f.store.state.knowledgeItems.some(row => row.id === f.unknown.id),
    false
  );
  assert(runtime.store.state.knowledgeItems.some(row => row.id === f.unknown.id));
  assert.equal(f.executions(), 1);
  await dialog.getByRole('button', { name: '返回回收站', exact: true }).click();
  await expect(page.getByText(/清理结果待核对，原件已保留/)).toBeVisible();
  await f.screenshot('purge-result-pending.png');
  await page.reload();
  await expect(page.getByRole('button', { name: '核对清理结果', exact: true })).toBeVisible();
  assert(runtime.store.state.knowledgeItems.some(row => row.id === f.unknown.id));
  f.setOffline(false);
  const sync = await f.context.request.post(`${runtime.origin}/api/local-runtime/sync/retry`, { data: {} });
  assert.equal(sync.status(), 200, await sync.text());
  await page.getByRole('button', { name: '核对清理结果', exact: true }).click();
  await expect(page.getByText(/本机已收到删除事实/)).toBeVisible();
  assert.equal(
    runtime.store.state.knowledgeItems.some(row => row.id === f.unknown.id),
    false
  );
  assert.equal(f.executions(), 1);
  await f.screenshot('purge-result-reconciled.png');
  assert.deepEqual(f.errors, []);
});

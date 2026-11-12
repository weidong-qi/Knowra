import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { createFileDataStore } from '../../../api/src/infrastructure/file-data-store.ts';
import { startExtractionWeb } from '../fixtures/knowledge-extraction-web.mjs';
import { withPageFailureDiagnostics } from '../fixtures/page-failure-diagnostics.mjs';

const demoLabel = '模拟演示，结果仅用于流程验收';
const previewDialog = page => page.getByRole('dialog', { name: '确认分析范围', exact: true });
const taskDialog = page => page.getByRole('dialog', { name: '知识提炼任务', exact: true });
const jobRecords = host => host.dataStore.aiRepository.list('aiJob', { jobKind: 'knowledgeExtraction' });
const latestJob = host => jobRecords(host).at(-1);

async function screenshot(page, name) {
  if (!process.env.KNOWRA_E2E_OUTPUT) return;
  fs.mkdirSync(process.env.KNOWRA_E2E_OUTPUT, { recursive: true });
  await page.screenshot({
    path: path.join(process.env.KNOWRA_E2E_OUTPUT, `extraction-${name}.png`),
    animations: 'disabled'
  });
}

async function openAI(page, host, { navigate = true } = {}) {
  if (navigate) await page.goto(`${host.origin}/#/materials/notes/${host.note.id}`);
  await expect(page.locator('.ProseMirror')).toContainText('数据增强通过变换样本');
  if (!(await page.getByRole('tab', { name: 'AI', exact: true }).isVisible()))
    await page.getByRole('button', { name: '切换文档检查器' }).click();
  await page.getByRole('tab', { name: 'AI', exact: true }).click();
  await expect(page.getByRole('button', { name: '分析整篇', exact: true })).toBeVisible();
}

async function preview(page) {
  await page.getByRole('button', { name: '分析整篇', exact: true }).click();
  await expect(previewDialog(page)).toBeVisible();
  await expect(previewDialog(page)).toContainText('数据增强通过变换样本增加训练变化。');
}

async function closeTasksWithEscape(page) {
  const dialog = taskDialog(page);
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
}

async function start(page, host, step = 'success') {
  const before = jobRecords(host).length;
  host.next(step);
  await preview(page);
  await expect(previewDialog(page)).toContainText(demoLabel);
  if (before === 0) await screenshot(page, 'mock-scope-preview');
  await previewDialog(page).getByRole('button', { name: '开始提炼', exact: true }).click();
  await expect.poll(() => jobRecords(host).length).toBe(before + 1);
  await expect(taskDialog(page)).toBeVisible();
  return latestJob(host).jobId;
}

async function withPage(t, options, run) {
  const host = await startExtractionWeb(options);
  let browser;
  t.after(async () => {
    await browser?.close();
    await host.close();
  });
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await withPageFailureDiagnostics(
    page,
    () => run(page, host),
    () => host.inspect()
  );
  assert.deepEqual(errors, []);
}

test('提炼页面默认关闭：仍可核对并保存真实范围，不产生任务或候选', { timeout: 45_000 }, async t => {
  await withPage(t, { enabled: false }, async (page, host) => {
    await openAI(page, host);
    await preview(page);
    await expect(previewDialog(page)).toContainText('知识提炼暂不可用');
    await expect(previewDialog(page).getByRole('button', { name: '开始提炼', exact: true })).toHaveCount(0);
    await screenshot(page, 'default-unavailable');
    await previewDialog(page).getByRole('button', { name: '保存范围快照', exact: true }).click();
    await expect(previewDialog(page)).toHaveCount(0);
    assert.equal(host.dataStore.state.analysisScopeSnapshots.length, 1);
    assert.equal(jobRecords(host).length, 0);
    assert.equal(host.dataStore.state.knowledgeItems.length, 0);
    assert.equal(host.calls.length, 0);
    const capabilities = await page.request.get(`${host.origin}/api/ai/capabilities`);
    assert.equal(capabilities.status(), 200);
    assert.equal((await capabilities.json()).data.knowledgeExtraction.canStart, false);
  });
});

test('真实 Web Mock 提炼：关闭和刷新不取消，候选对照、个人编辑与人工确认落盘', { timeout: 75_000 }, async t => {
  await withPage(t, {}, async (page, host) => {
    const starts = [];
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/ai/jobs')
        starts.push(request.postDataJSON());
    });
    await openAI(page, host);
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('当前草稿必须先保存，再进入固定范围。');
    const id = await start(page, host, 'hold');
    await expect.poll(() => host.calls.length).toBe(1);
    assert(host.calls[0].messages.some(message => message.content.includes('当前草稿必须先保存，再进入固定范围。')));
    await expect(taskDialog(page).getByRole('button', { name: '停止任务', exact: true })).toBeEnabled();
    await expect(taskDialog(page)).toContainText(demoLabel);
    await screenshot(page, 'running-desktop');
    await page.setViewportSize({ width: 390, height: 843 });
    const dialog = taskDialog(page);
    assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
    await expect(dialog.getByRole('button', { name: '停止任务', exact: true })).toBeVisible();
    await screenshot(page, 'running-390');
    await page.keyboard.press('Tab');
    assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(dialog.getByRole('button', { name: '停止任务', exact: true })).toBeEnabled();
    await page.setViewportSize({ width: 390, height: 843 });
    await expect(dialog.getByRole('button', { name: '停止任务', exact: true })).toBeEnabled();
    assert.equal(starts.length, 1);
    await closeTasksWithEscape(page);
    await expect(page.getByRole('dialog', { name: '文档检查器', exact: true })).toBeVisible();
    assert.equal((await host.app.knowledgeExtractionTasks.get(id)).status, 'running');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await openAI(page, host, { navigate: false });
    await page.getByRole('button', { name: '查看提炼任务', exact: true }).click();
    await expect(taskDialog(page).getByRole('button', { name: '停止任务', exact: true })).toBeEnabled();
    assert.equal(starts.length, 1);
    host.release(1);
    await expect.poll(async () => (await host.app.knowledgeExtractionTasks.get(id)).status).toBe('succeeded');
    await expect(taskDialog(page).getByRole('button', { name: '查看候选 1', exact: true })).toBeVisible();
    assert.equal(host.dataStore.state.knowledgeItems.length, 1);
    assert.equal(host.dataStore.state.knowledgeItems[0].reviewStatus, 'candidate');
    await screenshot(page, 'candidate-ready');
    await taskDialog(page).getByRole('button', { name: '查看候选 1', exact: true }).click();
    await expect(page.getByRole('heading', { name: '数据增强', exact: true })).toBeVisible();
    await expect(page.getByText(demoLabel, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '对照来源', exact: true }).click();
    const comparison = page.getByRole('dialog', { name: '来源对照', exact: true });
    await expect(comparison.getByLabel('历史版本正文', { exact: true })).toContainText(
      '数据增强通过变换样本增加训练变化。'
    );
    await screenshot(page, 'source-comparison');
    await comparison.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    const edit = page.getByRole('dialog', { name: '编辑知识', exact: true });
    await edit.getByLabel('核心陈述', { exact: true }).fill('人工修订：数据增强通过样本变换增加训练变化。');
    await edit.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('article', { name: '知识详情' })).toContainText(
      '人工修订：数据增强通过样本变换增加训练变化。'
    );
    await page.reload();
    await expect(page.getByRole('article', { name: '知识详情' })).toContainText(
      '人工修订：数据增强通过样本变换增加训练变化。'
    );
    assert.equal(createFileDataStore(host.file).state.knowledgeItems[0].reviewStatus, 'candidate');
    assert.equal(host.calls.length, 1);
    await screenshot(page, 'candidate-edited');
    await page.getByRole('button', { name: '确认知识', exact: true }).click();
    await expect.poll(() => host.dataStore.state.knowledgeItems[0].reviewStatus).toBe('confirmed');
    const persisted = createFileDataStore(host.file);
    assert.equal(persisted.state.knowledgeItems[0].reviewStatus, 'confirmed');
    assert.equal(persisted.state.knowledgeItems[0].canonicalStatement, '人工修订：数据增强通过样本变换增加训练变化。');
    assert.equal(starts.length, 1);
    await screenshot(page, 'candidate-confirmed');
  });
});

test('真实 Web Mock 提炼：取消晚响应、显式重试、失效授权和空候选分别呈现', { timeout: 90_000 }, async t => {
  await withPage(t, {}, async (page, host) => {
    await openAI(page, host);
    const cancelled = await start(page, host, 'hold');
    await expect.poll(() => host.calls.length).toBe(1);
    await taskDialog(page).getByRole('button', { name: '停止任务', exact: true }).click();
    await expect(taskDialog(page).getByRole('heading', { name: '已停止', exact: true })).toBeVisible();
    host.release(1);
    await host.app.knowledgeExtractionTasks.idle();
    assert.equal((await host.app.knowledgeExtractionTasks.get(cancelled)).status, 'cancelled');
    assert.equal(host.dataStore.state.knowledgeItems.length, 0);
    await screenshot(page, 'cancelled');
    await closeTasksWithEscape(page);

    const failed = await start(page, host, 'fail');
    await expect(taskDialog(page).getByRole('button', { name: '重试任务', exact: true })).toBeEnabled();
    assert.equal((await host.app.knowledgeExtractionTasks.get(failed)).status, 'failed');
    await expect(taskDialog(page)).not.toContainText('仅测试的供应商原始错误');
    await screenshot(page, 'retryable-failure');
    host.next('success');
    await taskDialog(page).getByRole('button', { name: '重试任务', exact: true }).click();
    await expect(taskDialog(page).getByRole('button', { name: '查看候选 1', exact: true })).toBeVisible();
    assert.equal(jobRecords(host).length, 2);
    assert.equal(host.calls.length, 3);
    assert.equal(host.dataStore.state.knowledgeItems.length, 1);
    await closeTasksWithEscape(page);

    const expired = await start(page, host, 'fail');
    await expect(taskDialog(page).getByRole('button', { name: '重试任务', exact: true })).toBeEnabled();
    host.advance(300_001);
    let releaseRefresh, capturedRefresh;
    const refreshHeld = new Promise(resolve => {
      releaseRefresh = resolve;
    });
    const refreshReady = new Promise(resolve => {
      capturedRefresh = resolve;
    });
    const refreshRoute = `**/api/ai/jobs/${expired}`;
    // Hold the real response so a fast local request cannot hide focus loss while pending.
    await page.route(refreshRoute, async route => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      capturedRefresh();
      await refreshHeld;
      await route.fulfill({ response });
    });
    const refreshButton = taskDialog(page).getByRole('button', { name: '刷新任务', exact: true });
    try {
      await refreshButton.click();
      await refreshReady;
      await expect(taskDialog(page).getByText('正在读取或提交任务…', { exact: true })).toBeVisible();
      await expect(refreshButton).toBeFocused();
    } finally {
      releaseRefresh();
    }
    await expect(taskDialog(page)).toContainText('本次授权或来源已失效');
    await expect(taskDialog(page).getByRole('button', { name: '重试任务', exact: true })).toHaveCount(0);
    await expect(refreshButton).toBeFocused();
    await page.unroute(refreshRoute);
    assert.equal((await host.app.knowledgeExtractionTasks.get(expired)).status, 'failed');
    assert.equal(host.calls.length, 4);
    await screenshot(page, 'expired-authorization');
    await closeTasksWithEscape(page);

    const empty = await start(page, host, 'empty');
    await expect(taskDialog(page)).toContainText('未发现可提炼内容，没有新增知识候选。');
    assert.deepEqual((await host.app.knowledgeExtractionTasks.get(empty)).candidateIds, []);
    assert.equal(host.dataStore.state.knowledgeItems.length, 1);
    assert.equal(host.calls.length, 5);
    await taskDialog(page).getByRole('button', { name: '刷新任务', exact: true }).click();
    for (const jobId of [cancelled, failed, expired, empty]) {
      await expect(taskDialog(page).getByRole('button', { name: `查看任务 ${jobId}`, exact: true })).toBeVisible();
    }
    await screenshot(page, 'empty-success');
    await closeTasksWithEscape(page);
    await page.reload();
    await openAI(page, host, { navigate: false });
    await page.getByRole('button', { name: '查看提炼任务', exact: true }).click();
    for (const jobId of [cancelled, failed, expired, empty]) {
      await expect(taskDialog(page).getByRole('button', { name: `查看任务 ${jobId}`, exact: true })).toBeVisible();
    }
    await screenshot(page, 'space-task-history');
  });
});

test('真实 Web Mock 提炼：关闭延迟读取后仍接纳新开始，旧列表不覆盖新任务', { timeout: 60_000 }, async t => {
  await withPage(t, {}, async (page, host) => {
    let release,
      captured,
      delayed = false;
    const hold = new Promise(resolve => {
      release = resolve;
    });
    const ready = new Promise(resolve => {
      captured = resolve;
    });
    const starts = [];
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/ai/jobs')
        starts.push(request.postDataJSON());
    });
    await page.route('**/api/ai/jobs?**', async route => {
      if (delayed) return route.continue();
      delayed = true;
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      assert.deepEqual((await response.json()).data.items, []);
      captured();
      await hold;
      await route.fulfill({ response });
    });
    try {
      await openAI(page, host);
      await page.getByRole('button', { name: '查看提炼任务', exact: true }).click();
      await ready;
      await closeTasksWithEscape(page);
      const id = await start(page, host);
      await expect(taskDialog(page).getByRole('button', { name: '查看候选 1', exact: true })).toBeVisible();
      assert.equal(starts.length, 1);
      assert.equal(jobRecords(host).length, 1);
      assert.equal(host.calls.length, 1);
      release();
      await taskDialog(page).getByRole('button', { name: '刷新任务', exact: true }).click();
      await expect(taskDialog(page).getByRole('button', { name: `查看任务 ${id}`, exact: true })).toBeVisible();
      await expect(taskDialog(page).getByRole('button', { name: '查看候选 1', exact: true })).toBeVisible();
      assert.equal(host.dataStore.state.analysisScopeSnapshots.length, 1);
      await screenshot(page, 'closed-read-new-start');
    } finally {
      release();
    }
  });
});

test('真实 Web Mock 提炼：服务端已创建但响应丢失，精确查询和刷新复用原任务', { timeout: 60_000 }, async t => {
  await withPage(t, {}, async (page, host) => {
    let dropped = false,
      lookupDropped = false,
      submittedId;
    const starts = [],
      lookups = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname !== '/api/ai/jobs') return;
      if (request.method() === 'POST') starts.push(request.postDataJSON());
      else if (url.searchParams.has('idempotencyKey')) lookups.push(url.searchParams.get('idempotencyKey'));
    });
    // 真正执行上游 HTTP 后仅丢弃一次传输响应；没有替换服务端结果或注入候选。
    await page.route('**/api/ai/jobs', async route => {
      if (route.request().method() !== 'POST' || dropped) return route.continue();
      dropped = true;
      const response = await route.fetch();
      assert.equal(response.status(), 202);
      submittedId = (await response.json()).data.jobId;
      await route.abort('failed');
    });
    // 同时丢一次恢复查询，随后刷新整页，必须保留原意图而非仅依赖组件内存。
    await page.route('**/api/ai/jobs?**', route => {
      const url = new URL(route.request().url());
      if (dropped && !lookupDropped && url.searchParams.has('idempotencyKey')) {
        lookupDropped = true;
        return route.abort('failed');
      }
      return route.continue();
    });
    await openAI(page, host);
    const id = await start(page, host);
    await expect(taskDialog(page)).toContainText('任务状态未知');
    assert.equal(dropped, true);
    assert.equal(lookupDropped, true);
    assert.equal(id, submittedId);
    assert.equal(starts.length, 1);
    assert.equal(host.calls.length, 1);
    await screenshot(page, 'lost-response-unknown');
    await page.reload();
    await openAI(page, host, { navigate: false });
    await page.getByRole('button', { name: '查看提炼任务', exact: true }).click();
    await expect(taskDialog(page).getByRole('button', { name: '查看候选 1', exact: true })).toBeVisible();
    assert.equal(jobRecords(host).length, 1);
    assert.equal(host.dataStore.state.analysisScopeSnapshots.length, 1);
    assert.equal(host.dataStore.state.knowledgeItems.length, 1);
    assert.equal(starts.length, 1);
    assert.equal(host.calls.length, 1);
    assert(lookups.length >= 2);
    assert(lookups.every(key => key === starts[0].idempotencyKey));
    await screenshot(page, 'lost-response-recovered');
  });
});

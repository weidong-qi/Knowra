import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { startLocalRuntime } from '../../src/runtime-server.mjs';
import { syntheticPdf } from '../../../../scripts/test-support/pdf-fixtures.mjs';

test('PDF 标注恢复：回执丢失后继续编辑、删除及重开后的并发核对', { timeout: 90000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-pdf-recovery-'));
  const runtime = await startLocalRuntime({
    dataDirectory: root,
    distRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
    syncOptions: { autoSync: false }
  });
  const browser = await chromium.launch(
    process.env.KNOWRA_TEST_BROWSER_CHANNEL ? { channel: process.env.KNOWRA_TEST_BROWSER_CHANNEL } : {}
  );
  t.after(async () => {
    await browser.close();
    await runtime.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.clock.install({ time: new Date('2026-11-04T00:00:00Z') });
  let page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(runtime.launchUrl);
  const space = (
    await (await context.request.post(`${runtime.origin}/api/knowledge/spaces/default`, { data: {} })).json()
  ).data;
  const imported = await context.request.post(
    `${runtime.origin}/api/storage/pdf-imports?${new URLSearchParams({
      operationId: 'recovery',
      spaceId: space.id,
      fileName: '保存恢复.pdf'
    })}`,
    { headers: { 'Content-Type': 'application/pdf' }, data: syntheticPdf() }
  );
  assert.equal(imported.status(), 201);
  const note = (await imported.json()).data;
  const annotationsUrl = `${runtime.origin}/api/pdf/${note.id}/annotations`;
  const noteUrl = `${runtime.origin}/#/materials/notes/${note.id}`;
  async function createMark(id) {
    const response = await context.request.put(`${annotationsUrl}/${id}`, {
      data: {
        operationId: `create-${id}`,
        expectedRevision: 0,
        type: 'region',
        segments: [{ pageIndex: 0, rect: [10, 10, 80, 80] }],
        comment: '原评论'
      }
    });
    assert.equal(response.status(), 200);
    return (await response.json()).data;
  }
  async function listMarks() {
    return (await (await context.request.get(annotationsUrl)).json()).data;
  }
  const mark = await createMark('retry');
  await page.goto(`${noteUrl}?pdfAnnotation=${mark.id}`);
  await page.reload();
  const comment = page.getByRole('textbox', { name: '评论', exact: true });
  await expect(comment).toHaveValue('原评论');
  await expect(page.locator('.textLayer').first()).toBeVisible();
  const requests = [];
  await page.route(`${annotationsUrl}/${mark.id}`, async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    requests.push(route.request().postDataJSON());
    if (requests.length !== 1) return route.continue();
    // 服务端已经提交，但客户端未收到成功回执。
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'TEST_LOST_RECEIPT', message: '模拟成功回执丢失' } })
    });
  });
  await comment.fill('第一版评论');
  await expect(page.getByRole('alert')).toContainText('模拟成功回执丢失');
  await comment.fill('失败后继续修改的最新评论');
  await expect(page.getByText('标注已保存', { exact: true })).toBeVisible();
  await expect(comment).toHaveValue('失败后继续修改的最新评论');
  assert.equal(requests.length, 3);
  assert.deepEqual(requests[1], requests[0]);
  assert.equal(requests[2].expectedRevision, mark.revision + 1);
  assert.equal((await listMarks())[0].comment, '失败后继续修改的最新评论');

  const deleted = page.waitForResponse(
    response => response.url() === `${annotationsUrl}/${mark.id}` && response.request().method() === 'DELETE'
  );
  await page.getByRole('button', { name: '删除标注', exact: true }).click();
  assert.equal((await deleted).status(), 200);
  await expect(page.getByText('标注已保存', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /定位标注/ })).toHaveCount(0);
  await expect(page.locator('[data-knowra-pdf-overlay] rect')).toHaveCount(0);
  assert.deepEqual(await listMarks(), []);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('menuitem', { name: '导出摘录', exact: true }).click();
  assert.doesNotMatch(fs.readFileSync(await (await download).path(), 'utf8'), /失败后继续修改的最新评论/);

  const recovered = await createMark('recovered');
  await page.goto(`${noteUrl}?pdfAnnotation=${recovered.id}`);
  await page.reload();
  await expect(comment).toHaveValue('原评论');
  // 暂停浏览器时钟，确保关闭页面时草稿尚未进入自动保存请求。
  await context.clock.pauseAt(new Date('2026-11-04T01:00:00Z'));
  await comment.fill('重开后仍要保留的本机评论');
  const drafts = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith('knowra:pdf-draft:v1:'));
    return JSON.parse(localStorage.getItem(key)).drafts;
  });
  assert.equal(drafts[0].task, undefined);
  await page.close();
  const remoteUpdate = await context.request.put(`${annotationsUrl}/${recovered.id}`, {
    data: { operationId: 'other-window', expectedRevision: recovered.revision, comment: '另一窗口的新评论' }
  });
  assert.equal(remoteUpdate.status(), 200);
  await context.clock.resume();
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${noteUrl}?pdfAnnotation=${recovered.id}`);
  await expect(page.getByRole('alert')).toContainText('已恢复未保存');
  await expect(page.getByRole('textbox', { name: '评论', exact: true })).toHaveValue('重开后仍要保留的本机评论');
  const conflict = page.waitForResponse(
    response => response.url() === `${annotationsUrl}/${recovered.id}` && response.request().method() === 'PUT'
  );
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  const response = await conflict;
  assert.equal(response.request().postDataJSON().expectedRevision, recovered.revision);
  assert.equal(response.status(), 409);
  assert.equal((await listMarks())[0].comment, '另一窗口的新评论');
  await page.getByRole('button', { name: '核对最新标注', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '核对标注修改' })).toContainText('另一窗口的新评论');
  await page.getByRole('button', { name: '保留本机修改', exact: true }).click();
  await expect(page.getByText('标注已保存', { exact: true })).toBeVisible();
  const saved = (await listMarks())[0];
  assert.equal(saved.comment, '重开后仍要保留的本机评论');
  assert.equal(saved.revision, recovered.revision + 2);
  assert.deepEqual(errors, []);
});

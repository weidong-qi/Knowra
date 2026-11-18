import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { syntheticPdf } from '../../../../scripts/test-support/pdf-fixtures.mjs';
import { startLocalRuntime } from '../../src/runtime-server.mjs';

test('PDF 新增、修改、删除批注后，无需刷新页面即可更新索引日期与最近更新排序', { timeout: 90000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-pdf-activity-'));
  const runtime = await startLocalRuntime({
    dataDirectory: root,
    distRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
    syncOptions: { autoSync: false }
  });
  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await runtime.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const api = async (url, method = 'GET', data) => {
    const response = await page.request.fetch(`${runtime.origin}${url}`, { method, ...(data ? { data } : {}) });
    assert(response.ok(), await response.text());
    return (await response.json()).data;
  };
  await page.goto(runtime.launchUrl);
  const space = await api('/api/knowledge/spaces/default', 'POST', {});
  const params = new URLSearchParams({ operationId: 'activity', spaceId: space.id, fileName: '批注活动.pdf' });
  const response = await page.request.post(`${runtime.origin}/api/storage/pdf-imports?${params}`, {
    headers: { 'Content-Type': 'application/pdf' },
    data: syntheticPdf()
  });
  assert.equal(response.status(), 201);
  const pdf = (await response.json()).data;
  const other = await api('/api/knowledge/notes', 'POST', {
    spaceId: space.id,
    title: '原先较新的笔记',
    rawMarkdown: ''
  });
  const oldDate = '2026-01-01T00:00:00.000Z';
  runtime.store.runTransaction(() => {
    runtime.store.state.notes.find(item => item.id === pdf.id).updatedAt = oldDate;
    runtime.store.state.notes.find(item => item.id === other.id).updatedAt = '2026-02-01T00:00:00.000Z';
    runtime.store.flush();
  });
  await page.reload();
  await page.evaluate(() => {
    window.pdfActivityVisit = 'same-document';
  });
  await page.goto(`${runtime.origin}/#/materials?scope=root`);
  await page.getByRole('button', { name: '列表视图', exact: true }).click();
  const row = page.locator(`[data-entry-key="note:${pdf.id}"]`);
  const rows = page.locator('tr[data-entry-key^="note:"]');
  await expect(rows.first()).toHaveAttribute('data-entry-key', `note:${other.id}`);
  let previousDate = oldDate;
  const verifyIndex = async () => {
    const latest = await api(`/api/knowledge/notes/${pdf.id}`);
    assert.ok(latest.updatedAt > previousDate);
    assert.equal(latest.createdAt, pdf.createdAt);
    previousDate = latest.updatedAt;
    await page.getByRole('button', { name: '返回资料库', exact: true }).click();
    await page.getByRole('button', { name: '列表视图', exact: true }).click();
    const formatted = await page.evaluate(
      value =>
        new Intl.DateTimeFormat('zh-CN', {
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        }).format(new Date(value)),
      latest.updatedAt
    );
    // “全部资料”走服务端分页查询，“笔记库”使用本地工作区快照。
    await expect(rows.first()).toHaveAttribute('data-entry-key', `note:${pdf.id}`);
    await expect(row).toContainText(formatted);
    await page.goto(`${runtime.origin}/#/materials?scope=root`);
    await expect(rows.first()).toHaveAttribute('data-entry-key', `note:${pdf.id}`);
    await expect(row).toContainText(formatted);
    assert.equal(await page.evaluate(() => window.pdfActivityVisit), 'same-document');
  };
  const open = async () => {
    await row.getByRole('button', { name: '批注活动', exact: true }).click();
    await expect(page.locator('.textLayer').first()).toBeVisible({ timeout: 25000 });
  };
  await open();
  await page
    .locator('.textLayer')
    .first()
    .evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element.querySelector('span'));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
  await page.getByRole('button', { name: '标注为重点', exact: true }).click();
  await expect(page.getByText('标注已保存', { exact: true })).toBeVisible();
  await verifyIndex();
  await open();
  const inspector = page.getByRole('complementary', { name: 'PDF 检查器' });
  await inspector.getByRole('button', { name: /定位标注/ }).click();
  await inspector.getByRole('group', { name: '批注内容，双击或按 Enter 编辑' }).dblclick();
  await inspector.getByRole('textbox', { name: '评论', exact: true }).fill('修改后也推进 PDF 时间');
  await expect(page.getByText('标注已保存', { exact: true })).toBeVisible();
  await verifyIndex();
  await open();
  await inspector.getByRole('button', { name: /定位标注/ }).click();
  await inspector.getByRole('button', { name: '删除标注', exact: true }).click();
  await expect(page.locator('[data-pdf-annotation-id]')).toHaveCount(0);
  await expect(page.getByText('标注已保存', { exact: true })).toBeVisible();
  await verifyIndex();
  assert.deepEqual(errors, []);
});

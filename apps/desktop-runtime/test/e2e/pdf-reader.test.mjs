import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { startLocalRuntime } from '../../src/runtime-server.mjs';
import { jsPDF } from 'jspdf';
import { syntheticPdf, syntheticCjkPdf } from '../../../../scripts/test-support/pdf-fixtures.mjs';

test('PDF 真实页面：导入、选择高亮、区域、评论、旋转、重开与摘录', { timeout: 90000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-pdf-page-'));
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
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') console.log('BROWSER', message.text());
  });
  await page.goto(runtime.launchUrl);
  const space = (
    await (await context.request.post(`${runtime.origin}/api/knowledge/spaces/default`, { data: {} })).json()
  ).data;
  const bytes = syntheticPdf({
    pages: [
      { text: 'Knowra PDF first page text', width: 420, height: 595, rotation: 0 },
      { text: 'Second page selectable words', width: 500, height: 400, rotation: 90 }
    ]
  });
  await page.reload();
  await page.goto(`${runtime.origin}/#/materials`);
  await page.getByRole('main').getByRole('button', { name: '新建', exact: true }).click();
  await page.getByRole('menuitem', { name: '导入 PDF', exact: true }).click();
  await page
    .getByRole('dialog')
    .locator('input[type="file"]')
    .setInputFiles({ name: '阅读验收.pdf', mimeType: 'application/pdf', buffer: bytes });
  const importedResponse = page.waitForResponse(
    response => response.url().includes('/api/storage/pdf-imports') && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: '导入并打开', exact: true }).click();
  const response = await importedResponse;
  assert.equal(response.status(), 201, await response.text());
  const note = (await response.json()).data;
  await expect(page.getByRole('region', { name: 'PDF 阅读与标注', exact: true })).toBeVisible();
  await expect(page.locator('.textLayer').first()).toContainText('Knowra PDF first page text', { timeout: 25000 });
  assert.deepEqual(errors, []);
  await page
    .locator('.textLayer')
    .first()
    .evaluate(element => {
      const text = element.querySelector('span');
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(text);
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
  await page.getByRole('button', { name: '高亮选区', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '评论', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '评论', exact: true }).fill('PDF 评论持久保存');
  await expect(page.getByText('标注已保存', { exact: true })).toBeVisible();
  let marks = (await (await context.request.get(`${runtime.origin}/api/pdf/${note.id}/annotations`)).json()).data;
  assert.equal(marks.length, 1);
  assert.equal(marks[0].comment, 'PDF 评论持久保存');
  assert(marks[0].segments.length > 0);
  const canonical = JSON.stringify(marks[0].segments);
  for (let rotation = 0; rotation < 4; rotation++) {
    await page.getByRole('button', { name: '旋转', exact: true }).click();
    await expect(page.locator('[data-knowra-pdf-overlay] rect').first()).toBeVisible();
  }
  await page.getByRole('button', { name: '区域框选', exact: true }).click();
  const canvas = page.locator('.page').first().locator('.canvasWrapper');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 80, box.y + 170);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 240, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByText('标注已保存', { exact: true })).toBeVisible();
  marks = (await (await context.request.get(`${runtime.origin}/api/pdf/${note.id}/annotations`)).json()).data;
  assert.equal(marks.length, 2);
  assert(marks.some(mark => mark.type === 'region'));
  assert.equal(JSON.stringify(marks.find(mark => mark.type === 'highlight').segments), canonical);
  await page.reload();
  await expect(page.locator('.textLayer').first()).toBeVisible({ timeout: 25000 });
  await expect(page.getByRole('button', { name: /定位标注.*Knowra/ })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('menuitem', { name: '导出摘录', exact: true }).click();
  const file = await (await download).path();
  assert.match(fs.readFileSync(file, 'utf8'), /PDF 评论持久保存/);
  const evidence = process.env.KNOWRA_E2E_OUTPUT;
  if (evidence) {
    fs.mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: path.join(evidence, 'pdf-reader-desktop.png') });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '标注', exact: true }).click();
  await expect
    .poll(async () => {
      const rect = await page.locator('.textLayer').first().boundingBox();
      return Boolean(rect && rect.width <= 390 && rect.x >= 0);
    })
    .toBe(true);
  if (evidence) await page.screenshot({ path: path.join(evidence, 'pdf-reader-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(
    `${runtime.origin}/#/materials/notes/${note.id}?pdfAnnotation=${marks.find(mark => mark.type === 'highlight').id}`
  );
  await expect(page.getByRole('textbox', { name: '评论', exact: true })).toHaveValue('PDF 评论持久保存');
  // Search and cross-page selection use the real PDF.js text layers.
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByRole('searchbox', { name: '在 PDF 中搜索', exact: true }).fill('Knowra');
  await page.getByRole('searchbox', { name: '在 PDF 中搜索', exact: true }).press('Enter');
  await expect(page.locator('.textLayer .highlight').first()).toBeVisible();
  await page.getByRole('spinbutton', { name: '页码', exact: true }).fill('2');
  await page.getByRole('spinbutton', { name: '页码', exact: true }).press('Enter');
  await expect(page.locator('.textLayer').nth(1)).toContainText('Second page');
  await page.locator('[aria-label="PDF 页面"]').evaluate(container => {
    const spans = container.querySelectorAll('.textLayer span[role="presentation"]');
    const range = document.createRange();
    range.setStart(spans[0].firstChild, 0);
    range.setEnd(spans[spans.length - 1].firstChild, spans[spans.length - 1].textContent.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('button', { name: '高亮选区', exact: true }).click();
  await expect(page.getByText('标注已保存', { exact: true })).toBeVisible();
  const multiple = (await (await context.request.get(`${runtime.origin}/api/pdf/${note.id}/annotations`)).json()).data;
  assert(multiple.some(mark => new Set(mark.segments.map(segment => segment.pageIndex)).size === 2));
  const edited = multiple.find(mark => new Set(mark.segments.map(segment => segment.pageIndex)).size === 2);
  const changedRemote = await context.request.put(`${runtime.origin}/api/pdf/${note.id}/annotations/${edited.id}`, {
    data: { expectedRevision: edited.revision, operationId: 'remote-edit', comment: '另一窗口的评论' }
  });
  assert.equal(changedRemote.status(), 200);
  await page.getByRole('textbox', { name: '评论', exact: true }).fill('用户核对后的本机评论');
  await page.getByRole('button', { name: '核对最新标注', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '核对标注修改' })).toContainText('另一窗口的评论');
  await page.getByRole('button', { name: '保留本机修改', exact: true }).click();
  await expect(page.getByText('标注已保存', { exact: true })).toBeVisible();
  const reconciled = (
    await (await context.request.get(`${runtime.origin}/api/pdf/${note.id}/annotations`)).json()
  ).data.find(mark => mark.id === edited.id);
  assert.equal(reconciled.comment, '用户核对后的本机评论');
  assert.equal(reconciled.revision, edited.revision + 2);
  await page.goto(`${runtime.origin}/#/materials/notes/${note.id}`);
  await page.getByRole('spinbutton', { name: '页码', exact: true }).fill('2');
  await page.getByRole('spinbutton', { name: '页码', exact: true }).press('Enter');
  await expect(page.locator('.page').nth(1).locator('canvas')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('spinbutton', { name: '页码', exact: true })).toHaveValue('2');
  async function openSynthetic(id, fileName, bytes) {
    const params = new URLSearchParams({ operationId: id, spaceId: space.id, fileName });
    const result = await context.request.post(`${runtime.origin}/api/storage/pdf-imports?${params}`, {
      headers: { 'Content-Type': 'application/pdf' },
      data: bytes
    });
    assert.equal(result.status(), 201);
    const value = (await result.json()).data;
    await page.goto(`${runtime.origin}/#/materials`);
    await page.reload();
    await page.goto(`${runtime.origin}/#/materials/notes/${value.id}`);
    return value;
  }
  const chinese = await openSynthetic('chinese', '中文双栏与扫描.pdf', syntheticCjkPdf());
  await expect(page.locator('.textLayer').first()).toContainText('知境阅读与标注', { timeout: 15000 });
  await expect(page.locator('.annotationLayer img')).toBeVisible();
  const icon = await page.locator('.annotationLayer img').getAttribute('src');
  assert.equal((await context.request.get(new URL(icon, runtime.origin).href)).status(), 200);
  assert.equal(
    (await (await context.request.get(`${runtime.origin}/api/pdf/${chinese.id}/annotations`)).json()).data.length,
    0
  );
  if (evidence) await page.screenshot({ path: path.join(evidence, 'pdf-reader-chinese.png') });
  await page.getByRole('spinbutton', { name: '页码', exact: true }).fill('2');
  await page.getByRole('spinbutton', { name: '页码', exact: true }).press('Enter');
  await expect(page.locator('.page').nth(1).locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: '区域框选', exact: true }).click();
  const scanned = await page.locator('.page').nth(1).locator('.canvasWrapper').boundingBox();
  await page.mouse.move(scanned.x + 50, scanned.y + 80);
  await page.mouse.down();
  await page.mouse.move(scanned.x + 150, scanned.y + 140, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByText('标注已保存', { exact: true })).toBeVisible();
  assert.equal(
    (await (await context.request.get(`${runtime.origin}/api/pdf/${chinese.id}/annotations`)).json()).data[0].type,
    'region'
  );
  const encrypted = new jsPDF({
    encryption: { userPassword: 'synthetic-password', ownerPassword: 'synthetic-owner', userPermissions: ['copying'] }
  });
  encrypted.text('Password unlocked fixture', 20, 30);
  await openSynthetic('password', '加密.pdf', Buffer.from(encrypted.output('arraybuffer')));
  await expect(page.getByRole('dialog', { name: '解锁 PDF' })).toBeVisible();
  await page.getByLabel('PDF 密码', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: '解锁', exact: true }).click();
  await expect(page.getByText('密码不正确，请重新输入。', { exact: true })).toBeVisible();
  await page.getByLabel('PDF 密码', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: '解锁', exact: true }).click();
  await expect(page.locator('.textLayer')).toContainText('Password unlocked fixture');
  assert.equal(
    await page.evaluate(() =>
      JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }).includes('synthetic-password')
    ),
    false
  );

  await openSynthetic('broken', '损坏.pdf', Buffer.from('%PDF-1.7\nnot a complete PDF'));
  await expect(page.getByRole('alert')).toContainText(/PDF|Invalid/);
  assert.deepEqual(errors, []);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { syntheticPdf } from '../../../../../scripts/test-support/pdf-fixtures.mjs';

export async function exercisePdfDictionary(page) {
  const origin = new URL(page.url()).origin;
  const errors = [];
  const external = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (/^https?:/.test(route.request().url()) && new URL(route.request().url()).origin !== origin) {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  const space = (await (await page.request.post(`${origin}/api/knowledge/spaces/default`, { data: {} })).json()).data;
  const params = new URLSearchParams({
    operationId: 'dictionary-pdf',
    spaceId: space.id,
    fileName: '离线查词验收.pdf'
  });
  const response = await page.request.post(`${origin}/api/storage/pdf-imports?${params}`, {
    headers: { 'Content-Type': 'application/pdf' },
    data: syntheticPdf({ pages: [{ text: 'Gradients and zzzqvunknown', width: 420, height: 595 }] })
  });
  assert.equal(response.status(), 201);
  const note = (await response.json()).data;
  const marks = async () => (await (await page.request.get(`${origin}/api/pdf/${note.id}/annotations`)).json()).data;
  await page.reload();
  await page.goto(`${origin}/#/materials/notes/${note.id}`);
  await expect(page.locator('.textLayer')).toContainText('Gradients', { timeout: 25000 });
  const wordPoint = word =>
    page.locator('.textLayer').evaluate((layer, word) => {
      const span = [...layer.querySelectorAll('span')].find(el => el.textContent.includes(word));
      const start = span.textContent.indexOf(word);
      const range = document.createRange();
      range.setStart(span.firstChild, start);
      range.setEnd(span.firstChild, start + word.length);
      const box = range.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }, word);
  const openWord = async word => {
    const point = await wordPoint(word);
    await page.mouse.dblclick(point.x, point.y, { delay: 70 });
    await expect(page.getByRole('dialog', { name: 'PDF 查词' })).toBeVisible();
  };
  const lookup = page.getByRole('dialog', { name: 'PDF 查词' });
  await openWord('Gradients');
  await expect(lookup).toContainText('原文 Gradients → 原形 gradient');
  await expect(lookup).toContainText('梯度');
  assert.equal((await marks()).length, 0, '查询不会自动创建标注');
  // 结果由点击触发，鼠标移开后仍能阅读、滚动和选择释义。
  await page.mouse.move(5, 5);
  await lookup.getByRole('button', { name: '保存的释义' }).click();
  await page.getByRole('option', { name: /n\. 倾斜度, 梯度/ }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  if (process.env.KNOWRA_E2E_OUTPUT) {
    fs.mkdirSync(process.env.KNOWRA_E2E_OUTPUT, { recursive: true });
    await page.screenshot({ path: path.join(process.env.KNOWRA_E2E_OUTPUT, 'pdf-dictionary.png') });
  }
  await lookup.getByRole('button', { name: '保存为标注' }).click();
  await expect(lookup).toHaveCount(0);
  await expect.poll(async () => (await marks()).length).toBe(1);
  const saved = (await marks())[0];
  assert.equal(saved.quoteText, 'Gradients');
  assert.equal(saved.kind, 'supplement');
  assert.match(saved.comment, /词典 · ECDICT\ngradient/);
  assert.match(saved.comment, /梯度/);
  assert.doesNotMatch(saved.comment, /a\. 渐升的/);
  // 同一位置再保存同一释义，直接定位已有标注。
  await openWord('Gradients');
  await lookup.getByRole('button', { name: '保存的释义' }).click();
  await page.getByRole('option', { name: /n\. 倾斜度, 梯度/ }).click();
  await lookup.getByRole('button', { name: '保存为标注' }).click();
  assert.equal((await marks()).length, 1);
  await page.getByRole('button', { name: '撤销标注操作' }).click();
  await expect.poll(async () => (await marks()).length).toBe(0);
  await page.getByRole('button', { name: '重做标注操作' }).click();
  await expect.poll(async () => (await marks()).length).toBe(1);
  await page.reload();
  await expect(page.locator('.textLayer')).toContainText('Gradients');
  assert.equal((await marks())[0].comment, saved.comment);
  const point = await wordPoint('Gradients');
  await page.mouse.move(point.x, point.y);
  await expect(page.getByRole('tooltip')).toContainText('梯度');
  // 未收录词给出明确提示，不能误存空标注。
  await openWord('zzzqvunknown');
  await expect(lookup).toContainText('本地词典未收录');
  await expect(lookup.getByRole('button', { name: '保存为标注' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(lookup).toHaveCount(0);
  // 拖选词组后，从已有标注工具条进入查询。
  await page.locator('.textLayer').evaluate(layer => {
    const range = document.createRange();
    range.selectNodeContents(layer.querySelector('span'));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    layer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('button', { name: '查词', exact: true }).click();
  await expect(lookup).toContainText('本地词典未收录');
  await lookup.getByRole('button', { name: '关闭' }).click();
  assert.equal((await marks()).length, 1);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
}

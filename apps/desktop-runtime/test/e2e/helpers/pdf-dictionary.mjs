import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { syntheticPdf } from '../../../../../scripts/test-support/pdf-fixtures.mjs';

export async function exercisePdfDictionary(page) {
  const origin = new URL(page.url()).origin;
  // 走页面的真实会话；Electron 的中文应用名可能出现在 UA 中，Node 请求上下文不能编码该请求头。
  const api = (url, method = 'GET', data) =>
    page.evaluate(
      async ({ url, method, data }) => {
        const response = await fetch(url, {
          method,
          ...(data ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {})
        });
        const result = await response.json();
        if (!response.ok) throw new Error(JSON.stringify(result));
        return result.data;
      },
      { url, method, data }
    );
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
  const space = await api('/api/knowledge/spaces/default', 'POST', {});
  const params = new URLSearchParams({
    operationId: 'dictionary-pdf',
    spaceId: space.id,
    fileName: '离线查词验收.pdf'
  });
  const note = await page.evaluate(
    async ({ params, bytes }) => {
      const response = await fetch(`/api/storage/pdf-imports?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf' },
        body: new Uint8Array(bytes)
      });
      const result = await response.json();
      if (response.status !== 201) throw new Error(JSON.stringify(result));
      return result.data;
    },
    {
      params: String(params),
      bytes: [...syntheticPdf({ pages: [{ text: 'Gradients and zzzqvunknown', width: 420, height: 595 }] })]
    }
  );
  const marks = () => api(`/api/pdf/${note.id}/annotations`);
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

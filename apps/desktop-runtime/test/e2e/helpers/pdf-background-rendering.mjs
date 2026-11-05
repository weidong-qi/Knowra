import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { syntheticPdf } from '../../../../../scripts/test-support/pdf-fixtures.mjs';

/** 延迟真实 Worker 的第二页文字请求，在第一页操作浮层打开后再放行。 */
export async function exercisePdfBackgroundRendering(page) {
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    const pending = [];
    let released = false;
    window.releasePdfBackgroundText = () => {
      released = true;
      for (const send of pending.splice(0)) send();
    };
    window.pdfBackgroundTextWaiting = false;
    Worker.prototype.postMessage = function (message, ...args) {
      if (!released && message?.action === 'GetTextContent' && message.data?.pageIndex === 1) {
        pending.push(() => post.call(this, message, ...args));
        window.pdfBackgroundTextWaiting = true;
        return;
      }
      return post.call(this, message, ...args);
    };
  });
  const origin = new URL(page.url()).origin;
  const api = async (url, method = 'GET', data) => {
    const response = await page.request.fetch(`${origin}${url}`, { method, ...(data ? { data } : {}) });
    assert(response.ok(), await response.text());
    return (await response.json()).data;
  };
  const space = await api('/api/knowledge/spaces/default', 'POST', {});
  const bytes = syntheticPdf({
    pages: ['First editable text', 'Second page loaded later'].map(text => ({ text, width: 420, height: 260 }))
  });
  const query = new URLSearchParams({ operationId: 'background-pdf', spaceId: space.id, fileName: '后台渲染.pdf' });
  const imported = await page.request.post(`${origin}/api/storage/pdf-imports?${query}`, {
    headers: { 'Content-Type': 'application/pdf' },
    data: bytes
  });
  assert.equal(imported.status(), 201);
  const note = (await imported.json()).data;
  const marksUrl = `/api/pdf/${note.id}/annotations`;
  await api(`${marksUrl}/background-mark`, 'PUT', {
    type: 'highlight',
    kind: 'important',
    quoteText: 'First editable text',
    comment: '',
    segments: [{ pageIndex: 0, rect: [40, 185, 210, 205] }],
    expectedRevision: 0,
    operationId: 'background-mark'
  });
  for (const mode of ['editor', 'actions']) {
    await page.reload();
    await page.goto(`${origin}/#/materials/notes/${note.id}`);
    await expect(page.locator('.textLayer').first()).toContainText('First editable text');
    await expect.poll(() => page.evaluate(() => window.pdfBackgroundTextWaiting)).toBe(true);
    await expect(page.locator('.page[data-page-number="2"] canvas')).toBeVisible();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const mark = page.locator('[data-pdf-annotation-id="background-mark"]');
    const rect = await mark.boundingBox();
    assert(rect);
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const actions = page.getByRole('dialog', { name: 'PDF 标注操作', exact: true });
    await expect(actions).toBeVisible();
    if (mode === 'editor') {
      await actions.getByRole('button', { name: '添加批注', exact: true }).click();
      const editor = page.getByRole('dialog', { name: '编辑 PDF 批注', exact: true });
      const field = editor.getByRole('textbox', { name: '批注内容' });
      await expect(field).toBeFocused();
      await page.keyboard.type('hel');
      const original = await field.elementHandle();
      assert(original);
      await page.evaluate(() => window.releasePdfBackgroundText());
      await expect(page.locator('.textLayer').nth(1)).toContainText('Second page loaded later');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(editor).toBeVisible();
      assert.equal(await original.evaluate(el => el.isConnected && document.activeElement === el), true);
      await page.keyboard.type('lo');
      await expect(field).toHaveValue('hello');
      await expect(field).toBeFocused();
      await expect.poll(async () => (await api(marksUrl))[0].comment).toBe('hello');
      await original.dispose();
      await editor.getByRole('button', { name: '完成', exact: true }).click();
    } else {
      await page.evaluate(() => window.releasePdfBackgroundText());
      await expect(page.locator('.textLayer').nth(1)).toContainText('Second page loaded later');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(actions).toBeVisible();
      await actions.getByRole('button', { name: '编辑批注', exact: true }).click();
      await expect(page.getByRole('textbox', { name: '批注内容' })).toHaveValue('hello');
    }
  }
}

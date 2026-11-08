import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { createOptionalAiRuntime } from '../../../api/src/modules/ai/runtime.js';
import { syntheticPdf } from '../../../../scripts/test-support/pdf-fixtures.mjs';
import { startLocalRuntime } from '../../src/runtime-server.mjs';

test('PDF 选区翻译经桌面接口返回译文，并保存为可重开的标注', { timeout: 60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-pdf-translation-e2e-'));
  const requests = [],
    errors = [];
  let runtime, browser;
  t.after(async () => {
    await browser?.close();
    await runtime?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  runtime = await startLocalRuntime({
    dataDirectory: root,
    distRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
    syncOptions: { autoSync: false },
    aiRuntimeFactory: options =>
      createOptionalAiRuntime({
        ...options,
        allowExternal: false,
        modelSettings: {
          credentialReference: async () => ({ modelId: 'deepseek-flash', credentialRef: 'synthetic' }),
          resolveCredential: async () => {
            throw new Error('合成验收不得读取真实凭据');
          }
        },
        priceProfile: {
          version: 'translation-e2e-synthetic-v1',
          modelId: 'deepseek-flash',
          expiresAt: '2030-01-01T00:00:00Z',
          inputMicrounitsPerMillion: 2000000,
          outputMicrounitsPerMillion: 8000000
        },
        providerAdapter: {
          provider: 'mock',
          capabilities: () => ({ provider: 'mock' }),
          async *stream() {},
          async complete(request) {
            requests.push(request);
            return {
              choices: [{ finish_reason: 'stop', message: { content: '注意力就是你所需要的一切。' } }],
              usage: { prompt_tokens: 40, completion_tokens: 20 }
            };
          }
        }
      })
  });
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(runtime.launchUrl);
  const api = async (url, method = 'GET', data) => {
    const response = await page.request.fetch(`${runtime.origin}${url}`, { method, ...(data ? { data } : {}) });
    assert(response.ok(), await response.text());
    return (await response.json()).data;
  };
  const space = await api('/api/knowledge/spaces/default', 'POST', {});
  const query = new URLSearchParams({ operationId: 'pdf-translation', spaceId: space.id, fileName: '翻译验收.pdf' });
  const response = await page.request.post(`${runtime.origin}/api/storage/pdf-imports?${query}`, {
    headers: { 'Content-Type': 'application/pdf' },
    data: syntheticPdf({ pages: [{ text: 'Attention is all you need.', width: 420, height: 595 }] })
  });
  assert.equal(response.status(), 201);
  const note = (await response.json()).data;
  await page.reload();
  await page.goto(`${runtime.origin}/#/materials/notes/${note.id}`);
  const textLayer = page.locator('.textLayer').first();
  await expect(textLayer).toContainText('Attention is all you need.', { timeout: 25000 });
  await textLayer.evaluate(layer => {
    const range = document.createRange();
    range.selectNodeContents(layer.querySelector('span'));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    layer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await expect(page.getByRole('button', { name: '翻译', exact: true })).toBeVisible();
  assert.equal(requests.length, 0, '选择文字时不调用模型');
  await page.getByRole('button', { name: '翻译', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'PDF 翻译' });
  await expect(dialog).toContainText('注意力就是你所需要的一切。');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].messages[1].content, '<source>\nAttention is all you need.\n</source>');
  assert.deepEqual(requests[0].tools, []);
  await dialog.getByRole('button', { name: '查看原文', exact: true }).click();
  await expect(dialog).toContainText('Attention is all you need.');
  await dialog.getByRole('button', { name: '保存为标注', exact: true }).click();
  const marks = () => api(`/api/pdf/${note.id}/annotations`);
  await expect.poll(async () => (await marks()).length).toBe(1);
  const saved = (await marks())[0];
  assert.equal(saved.kind, 'supplement');
  assert.equal(saved.quoteText, 'Attention is all you need.');
  assert.equal(saved.comment, '翻译 · deepseek-flash\n注意力就是你所需要的一切。');
  await page.reload();
  await expect(page.locator('.textLayer').first()).toContainText('Attention is all you need.');
  assert.equal((await marks())[0].comment, saved.comment);
  assert.equal(requests.length, 1, '重新打开资料不自动翻译');
  assert.deepEqual(errors, []);
});

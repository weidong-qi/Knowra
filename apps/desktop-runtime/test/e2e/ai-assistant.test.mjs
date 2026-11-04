import { withPageFailureDiagnostics } from '../fixtures/page-failure-diagnostics.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { startLocalRuntime } from '../../src/runtime-server.mjs';

test(
  '桌面真实页面声明本机执行、笔记读取需授权；未连接云端时使用本机预算，不再因云端不可用而禁止发送',
  { timeout: 60000 },
  async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-ai-desktop-page-'));
    const credentialSource = {
      credentialReference: async () => ({
        provider: 'deepseek',
        modelId: 'deepseek-flash',
        credentialRef: 'synthetic-ref'
      }),
      resolveCredential: async () => {
        throw new Error('页面合成验收不得读取真实密钥');
      }
    };
    const runtime = await startLocalRuntime({
      dataDirectory: directory,
      distRoot: fileURLToPath(new URL('../../../web/dist/', import.meta.url)),
      credentialSource,
      syncOptions: { autoSync: false }
    });
    const browser = await chromium.launch();
    t.after(async () => {
      await browser.close();
      await runtime.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });
    const page = await browser.newPage();
    await withPageFailureDiagnostics(page, async () => {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(runtime.launchUrl);
      const space = (
        await (await page.request.post(`${runtime.origin}/api/knowledge/spaces/default`, { data: {} })).json()
      ).data;
      const note = (
        await (
          await page.request.post(`${runtime.origin}/api/knowledge/notes`, {
            data: {
              spaceId: space.id,
              title: '合成会议笔记',
              rawMarkdown: '合成事实：会议定在十月三日。'
            }
          })
        ).json()
      ).data;
      await page.goto('about:blank');
      await page.goto(`${runtime.origin}/#/assistant?noteId=${encodeURIComponent(note.id)}`);
      await expect(page.getByRole('heading', { name: 'AI 助手', exact: true })).toBeVisible();
      await expect(page.getByText('本机执行')).toBeVisible();
      await expect(page.getByText('来自笔记「合成会议笔记」；授权后才能读取。')).toBeVisible();
      // 没有连接任何云端：预算账本在本机，助手可用，不出现“预算服务不可用”。
      await expect(page.getByText(/预算服务不可用|预算账本不可用/)).toHaveCount(0);
      const status = (await page.evaluate(() => fetch('/api/ai/assistant/status').then(response => response.json())))
        .data;
      assert.equal(status.generationAvailable, true, JSON.stringify(status));
      assert.equal(status.budget.limitMicrounits, 20_000_000);
      assert.equal(status.budget.availableMicrounits, 20_000_000);
      await page.getByRole('textbox', { name: '消息' }).fill('会议日期是什么？');
      await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
      await page.getByRole('button', { name: /资料范围：/ }).click();
      await page.getByRole('menuitem', { name: '设置读取范围', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '授权助手读取资料' })).toBeVisible();
      assert.equal((await runtime.store.aiRepository.list('aiJob')).length, 0);
      assert.deepEqual(errors, []);
    });
  }
);

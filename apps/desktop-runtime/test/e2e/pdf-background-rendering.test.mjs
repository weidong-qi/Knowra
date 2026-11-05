import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium } from '@playwright/test';
import { startLocalRuntime } from '../../src/runtime-server.mjs';
import { exercisePdfBackgroundRendering } from './helpers/pdf-background-rendering.mjs';

test('PDF 后台文字渲染不关闭第一页批注编辑器或操作菜单，输入和焦点保持', { timeout: 90000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-pdf-background-'));
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  await page.goto(runtime.launchUrl);
  await exercisePdfBackgroundRendering(page);
});

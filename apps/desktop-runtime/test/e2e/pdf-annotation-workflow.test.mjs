import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium } from '@playwright/test';
import { startLocalRuntime } from '../../src/runtime-server.mjs';
import { exercisePdfAnnotationWorkflow } from './helpers/pdf-annotation-workflow.mjs';

test('PDF 标注工作流：保存前后撤销重做、直接编辑、筛选搜索与重开', { timeout: 90000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-pdf-workflow-'));
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
  await page.goto(runtime.launchUrl);
  await exercisePdfAnnotationWorkflow(page);
});

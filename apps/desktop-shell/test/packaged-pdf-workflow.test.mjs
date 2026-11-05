import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { _electron as electron, expect } from '@playwright/test';
import { executablePath } from './packaged-app-path.mjs';
import { launchTestApplication, closeTestApplication } from './app-lifecycle.mjs';
import { exercisePdfAnnotationWorkflow } from '../../desktop-runtime/test/e2e/helpers/pdf-annotation-workflow.mjs';

test('Mac PDF：原生撤销快捷键、直接编辑退出保存、组合筛选与重开', { timeout: 120000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-pdf-workflow-app-'));
  let app;
  let completed = false;
  t.after(async () => {
    if (!completed && app) {
      try {
        t.diagnostic(await (await app.firstWindow()).locator('body').ariaSnapshot());
      } catch {
        /* 保留原始失败。 */
      }
    }
    await closeTestApplication(app);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const launch = async () => {
    fs.rmSync(path.join(directory, 'ready.json'), { force: true });
    const started = await launchTestApplication(electron, {
      executablePath,
      env: { ...process.env, KNOWRA_DESKTOP_SMOKE_DIR: directory },
      timeout: 30000
    });
    await expect.poll(() => fs.existsSync(path.join(directory, 'ready.json')), { timeout: 30000 }).toBe(true);
    return started;
  };
  app = await launch();
  let page = await app.firstWindow();
  const result = await exercisePdfAnnotationWorkflow(page);
  await closeTestApplication(app);
  app = null;
  app = await launch();
  page = await app.firstWindow();
  await page.goto(new URL(new URL(result.url).hash, page.url()).href);
  await expect(page.locator('.textLayer').first()).toContainText('First selected text', { timeout: 30000 });
  await page.getByRole('button', { name: /定位标注.*First selected text/ }).click();
  await expect(page.getByRole('textbox', { name: '评论', exact: true })).toHaveValue(result.comment);
  await expect(page.getByRole('button', { name: '撤销标注操作', exact: true })).toBeDisabled();
  completed = true;
});

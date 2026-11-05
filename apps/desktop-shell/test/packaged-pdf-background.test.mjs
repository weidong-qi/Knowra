import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { _electron as electron, expect } from '@playwright/test';
import { executablePath } from './packaged-app-path.mjs';
import { launchTestApplication, closeTestApplication } from './app-lifecycle.mjs';
import { exercisePdfBackgroundRendering } from '../../desktop-runtime/test/e2e/helpers/pdf-background-rendering.mjs';

test('Mac PDF：其他页文字加载完成后继续编辑批注，操作菜单保持可用', { timeout: 90000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-pdf-background-app-'));
  let app;
  t.after(async () => {
    await closeTestApplication(app);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  app = await launchTestApplication(electron, {
    executablePath,
    env: { ...process.env, KNOWRA_DESKTOP_SMOKE_DIR: directory },
    timeout: 30000
  });
  await expect.poll(() => fs.existsSync(path.join(directory, 'ready.json')), { timeout: 30000 }).toBe(true);
  await exercisePdfBackgroundRendering(await app.firstWindow());
});

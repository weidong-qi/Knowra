import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { _electron as electron, expect } from '@playwright/test';
import { executablePath } from './packaged-app-path.mjs';
import { closeTestApplication, launchTestApplication } from './app-lifecycle.mjs';
import { exercisePdfDictionary } from '../../desktop-runtime/test/e2e/helpers/pdf-dictionary.mjs';

test('Mac 离线查词：内置词库、真实双击、释义标注与重开', { timeout: 90000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-packaged-dictionary-'));
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
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await exercisePdfDictionary(page);
});

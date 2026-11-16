import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { _electron as electron, expect } from '@playwright/test';
import { executablePath } from './packaged-app-path.mjs';
import { closeTestApplication, launchTestApplication } from './app-lifecycle.mjs';
import {
  prepareDefinitionDraft,
  recoverDefinitionDraft
} from '../../desktop-runtime/test/e2e/helpers/concept-definition-recovery.mjs';

test('Mac 定义草稿：恢复退出后保留原候选与目标，重开保存后挂回主体', { timeout: 90000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-definition-recovery-'));
  let app;
  t.after(async () => {
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
  await page.waitForLoadState('domcontentloaded');
  const draft = await prepareDefinitionDraft(page);
  // 只选择真实退出确认中的“恢复退出”，不替换保存或退出协议。
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 2 });
  });
  const closed = app.waitForEvent('close');
  await app.evaluate(({ app: nativeApp }) => nativeApp.quit());
  await closed;
  app = null;
  const records = JSON.parse(fs.readFileSync(path.join(directory, 'offline/recovery-drafts.json'), 'utf8')).drafts;
  const saved = Object.values(records).find(value => value.candidateId === draft.candidateId);
  assert.deepEqual(saved, draft);
  app = await launch();
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await recoverDefinitionDraft(page, draft, 'restore');
});

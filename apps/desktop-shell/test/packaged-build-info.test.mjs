import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { _electron as electron, expect } from '@playwright/test';
import { executablePath } from './packaged-app-path.mjs';
import { closeTestApplication, launchTestApplication } from './app-lifecycle.mjs';
import { assertDesktopBuild } from '../../../scripts/release-artifact.mjs';

test('真实隔离 APP 的设置、前端文件和启动回执显示相同构建身份', { timeout: 60000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-build-smoke-'));
  const application = path.resolve(path.dirname(executablePath), '../..');
  const info = assertDesktopBuild(application);
  const app = await launchTestApplication(electron, { executablePath, env: { ...process.env, KNOWRA_DESKTOP_SMOKE_DIR: directory }, timeout: 20000 });
  t.after(async () => { await closeTestApplication(app); fs.rmSync(directory, { recursive: true, force: true }); });
  const page = await app.firstWindow();
  await page.getByRole('button', { name: '账户与设置', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: /关于知境/ }).click();
  await expect(page.getByRole('heading', { name: '关于知境·Knowra' })).toBeVisible();
  await expect(page.getByText(info.version, { exact: true })).toBeVisible();
  await expect(page.getByText(info.commit || '未知', { exact: true })).toBeVisible();
  await expect(page.getByText(info.builtAt, { exact: true })).toBeVisible();
  const state = { clean: '已提交（clean）', dirty: '含未提交修改（dirty）', unknown: '无法确认（unknown）' }[info.state];
  await expect(page.getByText(state, { exact: true })).toBeVisible();
  assert.deepEqual(await page.evaluate(async () => (await fetch('/build-info.json')).json()), info);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'ready.json'), 'utf8')).buildInfo, info);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 700));
  const information = page.locator('dl').filter({ hasText: '完整提交 SHA' });
  assert.equal(await information.evaluate(element => element.scrollWidth <= element.clientWidth), true);
  if (process.env.KNOWRA_RELEASE_EVIDENCE_DIR) {
    fs.mkdirSync(process.env.KNOWRA_RELEASE_EVIDENCE_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.KNOWRA_RELEASE_EVIDENCE_DIR, `about-${info.state}.png`) });
  }
});

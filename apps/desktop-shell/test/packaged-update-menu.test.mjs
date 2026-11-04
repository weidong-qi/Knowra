import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { _electron as electron, expect } from '@playwright/test';
import { executablePath } from './packaged-app-path.mjs';
import { closeTestApplication, launchTestApplication } from './app-lifecycle.mjs';

test('隔离打包 APP 的原生菜单提供检查更新入口（不发起网络请求）', { timeout: 60000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-update-menu-'));
  let app;
  t.after(async () => { await closeTestApplication(app); fs.rmSync(directory, { recursive: true, force: true }); });
  app = await launchTestApplication(electron, { executablePath, env: { ...process.env, KNOWRA_DESKTOP_SMOKE_DIR: directory }, timeout: 20000 });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // main.tsx 在渲染 React 前注册保存退出握手；不能在 firstWindow 的空白启动阶段退出。
  await expect(page.getByRole('button', { name: '账户与设置', exact: true })).toBeVisible();
  const item = await app.evaluate(({ Menu }) => {
    const find = menu => {
      for (const entry of menu?.items || []) {
        if (entry.label === '检查更新…') return { label: entry.label, enabled: entry.enabled, visible: entry.visible };
        const found = find(entry.submenu);
        if (found) return found;
      }
      return null;
    };
    return find(Menu.getApplicationMenu());
  });
  assert.deepEqual(item, { label: '检查更新…', enabled: true, visible: true });
  const closed = app.waitForEvent('close', { timeout: 45000 });
  await app.evaluate(({ app: nativeApp }) => nativeApp.quit());
  await closed;
  app = null;
});

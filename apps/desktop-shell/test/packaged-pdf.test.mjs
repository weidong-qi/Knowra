import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { _electron as electron, expect } from '@playwright/test';
import { executablePath } from './packaged-app-path.mjs';
import { PACKAGED_STARTUP_TIMEOUT_MS } from './editor-readiness.mjs';
import { closeTestApplication, launchTestApplication } from './app-lifecycle.mjs';
import { syntheticCjkPdf } from '../../../scripts/test-support/pdf-fixtures.mjs';

test('打包 APP 离线 PDF：本地字体、区域标注、原生下载及退出评论保存', { timeout: 90000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-packaged-pdf-'));
  let app;
  let completed = false;
  t.after(async () => {
    if (!completed && app) {
      try {
        const failedPage = await app.firstWindow();
        t.diagnostic(`PDF 验收失败页面：${failedPage.url()}\n${await failedPage.locator('body').ariaSnapshot()}`);
      } catch (error) {
        t.diagnostic(`PDF 失败页面读取失败：${error.message}`);
      }
    }
    await closeTestApplication(app);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const launch = () =>
    launchTestApplication(electron, {
      executablePath,
      env: { ...process.env, KNOWRA_DESKTOP_SMOKE_DIR: directory },
      timeout: PACKAGED_STARTUP_TIMEOUT_MS
    });
  // 主进程在 loadURL 完成后才写 ready.json；等它出现再操作页面，
  // 否则 goto/reload 会与应用自身的启动导航竞争（慢机器上丢失路由）。
  const ready = path.join(directory, 'ready.json');
  const launchReady = async () => {
    fs.rmSync(ready, { force: true });
    const started = await launch();
    await expect.poll(() => fs.existsSync(ready), { timeout: 30000 }).toBe(true);
    return started;
  };
  app = await launchReady();
  let page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const foreign = [];
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1') foreign.push(request.url());
  });
  const bytes = syntheticCjkPdf();
  const note = await page.evaluate(
    async bytes => {
      const space = (
        await (
          await fetch('/api/knowledge/spaces/default', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
          })
        ).json()
      ).data;
      const params = new URLSearchParams({ operationId: 'native-pdf', spaceId: space.id, fileName: '离线.pdf' });
      const response = await fetch(`/api/storage/pdf-imports?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf' },
        body: new Uint8Array(bytes)
      });
      if (!response.ok) throw new Error(await response.text());
      return (await response.json()).data;
    },
    [...bytes]
  );
  const route = `/#/materials/notes/${note.id}`;
  await page.goto(new URL(route, page.url()).href);
  await page.reload();
  await expect(page.locator('.textLayer').first()).toContainText('知境阅读与标注', { timeout: 30000 });
  await page.getByRole('button', { name: '区域框选', exact: true }).click();
  const bounds = await page.locator('.canvasWrapper').first().boundingBox();
  assert(bounds);
  await page.mouse.move(bounds.x + 30, bounds.y + 60);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 140, bounds.y + 120);
  await page.mouse.up();
  await page.getByRole('button', { name: '标注为重点', exact: true }).click();
  const mark = page.getByRole('button', { name: /^定位标注 第 \d+ 页 区域标注$/ });
  await expect(mark).toBeVisible();
  const markLabel = await mark.getAttribute('aria-label');
  assert(markLabel);
  t.diagnostic(`本次区域标注：${markLabel}`);
  const comment = page.getByRole('textbox', { name: '评论', exact: true });
  await comment.fill('退出前的本机评论');
  // 在 450ms 防抖结束前退出，必须由现有退出握手提交。
  await closeTestApplication(app);
  app = null;
  app = await launchReady();
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.goto(new URL(route, page.url()).href);
  await page.reload();
  await expect(page.locator('.textLayer').first()).toContainText('知境阅读与标注', { timeout: 30000 });
  await page.getByRole('button', { name: markLabel, exact: true }).click();
  await expect(page.getByRole('textbox', { name: '评论', exact: true })).toHaveValue('退出前的本机评论', {
    timeout: 30000
  });
  const savedMark = await page.locator('[data-knowra-pdf-overlay] [data-type="region"]').boundingBox();
  assert(savedMark);
  await page.mouse.move(savedMark.x + savedMark.width / 2, savedMark.y + savedMark.height / 2);
  await expect(page.getByRole('tooltip')).toContainText('退出前的本机评论');
  await page.mouse.move(5, 5);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  const destination = path.join(directory, '原 PDF.pdf');
  await app.evaluate(({ dialog }, destination) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
  }, destination);
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('menuitem', { name: '下载原文件', exact: true }).click();
  await expect.poll(() => fs.existsSync(destination)).toBe(true);
  assert.deepEqual(fs.readFileSync(destination), bytes);
  assert.deepEqual(foreign, []);
  if (process.env.KNOWRA_E2E_OUTPUT) {
    fs.mkdirSync(process.env.KNOWRA_E2E_OUTPUT, { recursive: true });
    await page.screenshot({ path: path.join(process.env.KNOWRA_E2E_OUTPUT, 'packaged-pdf.png') });
  }
  completed = true;
});

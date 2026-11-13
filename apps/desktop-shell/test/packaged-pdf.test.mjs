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
import { capturePdfNavigation, navigateToPackagedPdf } from './pdf-navigation.mjs';

test('打包 APP 离线 PDF：本地字体、区域标注、原生下载及退出评论保存', { timeout: 90000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-packaged-pdf-'));
  let app;
  let completed = false;
  const navigationEvents = [];
  let navigation;
  t.after(async () => {
    if (!completed) t.diagnostic(`PDF 导航诊断：${JSON.stringify(navigationEvents)}`);
    if (!completed && app) {
      try {
        const failedPage = await app.firstWindow();
        t.diagnostic(`PDF 验收失败页面：${failedPage.url()}\n${await failedPage.locator('body').ariaSnapshot()}`);
      } catch (error) {
        t.diagnostic(`PDF 失败页面读取失败：${error.message}`);
      }
    }
    navigation?.dispose();
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
  navigation = capturePdfNavigation(page, 'initial-import', navigationEvents);
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
  let expectedUrl = await navigateToPackagedPdf(page, note.id, {
    refreshWorkspace: true,
    diagnostic: navigation.checkpoint
  });
  await expect(page.locator('.textLayer').first()).toContainText('知境阅读与标注', { timeout: 30000 });
  assert.equal(page.url(), expectedUrl, '首次 PDF 文字层就绪后必须仍在目标笔记。');
  navigation.checkpoint({ phase: 'text-layer-ready', url: page.url(), expectedUrl });
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
  navigation.dispose();
  app = null;
  app = await launchReady();
  page = await app.firstWindow();
  navigation = capturePdfNavigation(page, 'after-restart', navigationEvents);
  await page.waitForLoadState('domcontentloaded');
  expectedUrl = await navigateToPackagedPdf(page, note.id, { diagnostic: navigation.checkpoint });
  await expect(page.locator('.textLayer').first()).toContainText('知境阅读与标注', { timeout: 30000 });
  assert.equal(page.url(), expectedUrl, '重启后 PDF 文字层就绪时必须仍在目标笔记。');
  navigation.checkpoint({ phase: 'text-layer-ready', url: page.url(), expectedUrl });
  await page.getByRole('button', { name: markLabel, exact: true }).click();
  await expect(page.getByRole('textbox', { name: '评论', exact: true })).toHaveValue('退出前的本机评论', {
    timeout: 30000
  });
  await page.getByRole('button', { name: '关闭 PDF 检查器', exact: true }).click();
  const savedRegion = page.locator('[data-knowra-pdf-overlay] [data-type="region"]');
  // 定位后的延迟布局可能改变阅读位置，用当前可见标注的坐标悬停。
  await expect
    .poll(async () => {
      const savedMark = await savedRegion.boundingBox();
      const frame = await page.getByLabel('PDF 页面', { exact: true }).boundingBox();
      if (!savedMark || !frame) return '';
      const x = savedMark.x + savedMark.width / 2,
        y = savedMark.y + savedMark.height / 2;
      if (x < frame.x || x > frame.x + frame.width || y < frame.y || y > frame.y + frame.height) {
        await savedRegion.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center' }));
        return '';
      }
      await page.mouse.move(x, y);
      return (await page.getByRole('tooltip').allTextContents()).join('');
    })
    .toContain('退出前的本机评论');
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
  const pdfCanvas = page.locator('.canvasWrapper').first();
  const originalSize = await pdfCanvas.boundingBox();
  assert(originalSize);
  const cdp = await page.context().newCDPSession(page);
  const pinch = scaleFactor =>
    cdp.send('Input.synthesizePinchGesture', {
      x: originalSize.x + originalSize.width / 2,
      y: originalSize.y + 140,
      scaleFactor,
      gestureSourceType: 'mouse'
    });
  await pinch(1.25);
  await expect.poll(async () => (await pdfCanvas.boundingBox()).width).toBeGreaterThan(originalSize.width * 1.1);
  const zoomedSize = await pdfCanvas.boundingBox();
  await pinch(0.8);
  await expect.poll(async () => (await pdfCanvas.boundingBox()).width).toBeLessThan(zoomedSize.width * 0.9);
  assert.equal(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()),
    1
  );
  await cdp.detach();
  await page.getByRole('button', { name: '适合宽度', exact: true }).click();
  // 捏合结束后的延迟绘制会重建文字层；等待新文字层能产生选区色条，再创建标注。
  await expect
    .poll(async () => {
      await page
        .locator('.textLayer')
        .first()
        .evaluate(layer => {
          const span = [...layer.querySelectorAll('span')].find(el => el.textContent === '知境阅读与标注');
          const range = document.createRange();
          range.selectNodeContents(span);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          layer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        });
      return page.getByRole('button', { name: '标注为疑问', exact: true }).isVisible();
    })
    .toBe(true);
  await page.getByRole('button', { name: '标注为疑问', exact: true }).click();
  await expect(page.getByText('标注已保存', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭 PDF 检查器', exact: true }).click();
  const textHighlight = page.locator('[data-knowra-pdf-overlay] [data-type="highlight"]');
  await expect(textHighlight).toBeVisible();
  const textMark = await textHighlight.boundingBox();
  assert(textMark);
  await page.mouse.click(textMark.x + textMark.width / 2, textMark.y + textMark.height / 2);
  await expect(page.getByRole('dialog', { name: 'PDF 标注操作' })).toBeVisible();
  await app.evaluate(async ({ clipboard, ClipboardItem }) => {
    globalThis.pdfTestClipboard = await Promise.all(
      (await clipboard.read()).map(
        async item =>
          new ClipboardItem(
            Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)])))
          )
      )
    );
  });
  try {
    await page.getByRole('button', { name: '复制', exact: true }).click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('知境阅读与标注');
  } finally {
    await app.evaluate(async ({ clipboard }) => {
      await clipboard.write(globalThis.pdfTestClipboard);
      delete globalThis.pdfTestClipboard;
    });
  }
  assert.deepEqual(foreign, []);
  if (process.env.KNOWRA_E2E_OUTPUT) {
    fs.mkdirSync(process.env.KNOWRA_E2E_OUTPUT, { recursive: true });
    await page.screenshot({ path: path.join(process.env.KNOWRA_E2E_OUTPUT, 'packaged-pdf.png') });
  }
  completed = true;
});

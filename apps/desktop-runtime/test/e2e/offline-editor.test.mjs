import { withFailureDiagnostics } from './helpers/failure-diagnostics.mjs';
import { withWorkspaceStatus } from './helpers/workspace-status.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';

test(
  '真实 V4 页面断外网编辑、保存状态、强制终止运行服务并重新打开',
  { timeout: 60000 },
  withFailureDiagnostics(offlineEditor)
);

async function offlineEditor(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-offline-e2e-'));
  const browser = await chromium.launch({
    ...(process.env.V4_BROWSER_CHANNEL === 'chrome' ? { channel: 'chrome' } : {})
  });
  let child;
  t.after(async () => {
    await browser.close();
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const start = async () => {
    child = fork(fileURLToPath(new URL('../../src/main.mjs', import.meta.url)), ['--data-dir', root], {
      stdio: ['ignore', 'ignore', 'inherit', 'ipc']
    });
    const [message] = await once(child, 'message');
    assert.equal(message.type, 'ready');
    return message;
  };
  let runtime = await start();
  let context = await browser.newContext();
  let page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  // 阻断所有非回环流量，保留实际本地 HTTP；不 Mock 任何业务 API。
  await context.route('**/*', route =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
  );
  await page.goto(runtime.launchUrl);
  const request = context.request;
  const space = (await (await request.post(`${runtime.origin}/api/knowledge/spaces/default`, { data: {} })).json())
    .data;
  const note = (
    await (
      await request.post(`${runtime.origin}/api/knowledge/notes`, {
        data: { spaceId: space.id, title: '离线页面验收', rawMarkdown: '原始内容' }
      })
    ).json()
  ).data;
  // 通过 API 建立夹具后刷新主页，再使用真实入口打开笔记。
  await page.goto(runtime.origin);
  await page.reload();
  await page
    .getByRole('list', { name: '最近编辑', exact: true })
    .getByRole('button', { name: '继续编辑 离线页面验收', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: '离线页面验收', exact: true })).toBeVisible();
  const editor = page.locator('.ProseMirror');
  await expect(editor).toContainText('原始内容');
  await expect(page.getByRole('button', { name: '插入图片', exact: true })).toBeEnabled();
  // 仅延后首个真实 PATCH 的放行，不替换响应，给弹层留出确定的“保存中”验收窗口。
  const noteUrl = `${runtime.origin}/api/knowledge/notes/${note.id}`;
  let releaseSave, reportSaveStarted;
  const saveBarrier = new Promise(resolve => {
    releaseSave = resolve;
  });
  const saveStarted = new Promise(resolve => {
    reportSaveStarted = resolve;
  });
  const holdSave = async route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    reportSaveStarted();
    await saveBarrier;
    await route.continue();
  };
  await page.route(noteUrl, holdSave);
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(' 离线新增中文正文');
  await saveStarted;
  try {
    await withWorkspaceStatus(page, async status => {
      await expect(status).toContainText('保存中');
      releaseSave();
      await expect(status).toContainText('已保存到本机');
    });
  } finally {
    releaseSave();
    await page.unroute(noteUrl, holdSave);
  }
  await expect(page.getByRole('button', { name: /本地资料.*连接云端/ })).toBeVisible();
  await editor.press('ControlOrMeta+a');
  await page.getByRole('button', { name: '标记重点（普通）', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`${runtime.origin}/api/knowledge/annotations?noteId=${note.id}`)).json()).data.length
    )
    .toBe(1);
  // 在浏览器执行原生默认动作前观察应用是否已经收起选区。
  // 不恢复/修改选区，不新增点击或等待；保留原来的 Ctrl+A、标记、End 操作。
  await page.evaluate(() => {
    window.__knowraEndObservation = null;
    const observeEnd = event => {
      if (event.key !== 'End') return;
      const selection = window.getSelection();
      const editor = document.querySelector('.ProseMirror');
      const inEditor = Boolean(selection?.focusNode && editor?.contains(selection.focusNode));
      let atEnd = false;
      if (inEditor) {
        const remaining = document.createRange();
        remaining.selectNodeContents(editor);
        remaining.setStart(selection.focusNode, selection.focusOffset);
        atEnd = remaining.toString().length === 0;
      }
      window.__knowraEndObservation = {
        handled: event.defaultPrevented,
        collapsed: selection?.isCollapsed ?? false,
        inEditor,
        atEnd,
        selectedText: selection?.toString() ?? '',
        activeElement: document.activeElement?.tagName ?? null
      };
      document.removeEventListener('keydown', observeEnd);
    };
    document.addEventListener('keydown', observeEnd);
  });
  await editor.press('End');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: '插入图片', exact: true }).click()
  ]);
  const endObservation = await page.evaluate(() => window.__knowraEndObservation);
  assert(
    endObservation?.handled && endObservation.collapsed && endObservation.inEditor && endObservation.atEnd,
    `End 必须在原生默认动作之前同步收起编辑器选区：${JSON.stringify(endObservation)}`
  );
  await chooser.setFiles({
    name: '离线图片.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64'
    )
  });
  await expect(editor.getByRole('img', { name: '离线图片.png', exact: true })).toBeVisible();
  await withWorkspaceStatus(page, status => expect(status).toContainText('已保存到本机'));
  await expect
    .poll(
      async () =>
        (await (await request.get(`${runtime.origin}/api/knowledge/notes/${note.id}`)).json()).data.rawMarkdown
    )
    .toContain('/api/storage/attachments/');
  const saved = (await (await request.get(`${runtime.origin}/api/knowledge/notes/${note.id}`)).json()).data;
  assert(
    saved.rawMarkdown.includes('离线新增中文正文'),
    `插图后保存正文未包含新增文字：${JSON.stringify(saved.rawMarkdown)}`
  );
  assert(saved.rawMarkdown.includes('/api/storage/attachments/'));
  const before = (await (await request.get(`${runtime.origin}/api/local-runtime/status`)).json()).data;
  assert(before.pendingOperations > 0);
  const screenshots = process.env.KNOWRA_E2E_OUTPUT;
  if (screenshots) {
    fs.mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, 'offline-saved.png') });
  }
  await context.close();
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  runtime = await start();
  context = await browser.newContext();
  await context.route('**/*', route =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
  );
  page = await context.newPage();
  page.on('pageerror', error => problems.push(error.message));
  await page.goto(runtime.launchUrl);
  await page.goto(`${runtime.origin}/#/materials/notes/${note.id}`);
  await expect(page.locator('.ProseMirror')).toContainText('离线新增中文正文');
  await expect(page.locator('.ProseMirror').getByRole('img', { name: '离线图片.png', exact: true })).toBeVisible();
  assert(
    await page
      .locator('.ProseMirror')
      .getByRole('img', { name: '离线图片.png', exact: true })
      .evaluate(image => image.complete && image.naturalWidth > 0)
  );
  assert.equal(
    (await (await context.request.get(`${runtime.origin}/api/knowledge/annotations?noteId=${note.id}`)).json()).data
      .length,
    1
  );
  const after = (await (await context.request.get(`${runtime.origin}/api/local-runtime/status`)).json()).data;
  assert.equal(after.pendingOperations, before.pendingOperations);
  assert.equal(after.deviceId, before.deviceId);
  assert.deepEqual(problems, []);
  if (screenshots) await page.screenshot({ path: path.join(screenshots, 'offline-restored.png') });
}

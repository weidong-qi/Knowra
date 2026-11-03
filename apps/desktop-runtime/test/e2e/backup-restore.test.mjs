import { openLocalSync } from './helpers/workspace-status.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { startLocalRuntime } from '../../src/runtime-server.mjs';

test('真实页面：备份选择、完整性检查、确认恢复、重新加载和重启保留恢复结果', { timeout: 60000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-backup-e2e-'));
  const options = {
    dataDirectory: directory,
    distRoot: fileURLToPath(new URL('../../../web/dist/', import.meta.url)),
    syncOptions: { autoSync: false }
  };
  let runtime = await startLocalRuntime(options);
  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await runtime.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(runtime.launchUrl);
  const space = (await (await page.request.post(`${runtime.origin}/api/knowledge/spaces/default`, { data: {} })).json())
    .data;
  const note = (
    await (
      await page.request.post(`${runtime.origin}/api/knowledge/notes`, {
        data: { spaceId: space.id, title: '恢复前确认测试', rawMarkdown: '备份中的正文' }
      })
    ).json()
  ).data;
  const attachment = (
    await (
      await page.request.post(`${runtime.origin}/api/storage/attachments`, {
        data: {
          noteId: note.id,
          fileName: '恢复图片.png',
          contentBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9VQAAAAASUVORK5CYII='
        }
      })
    ).json()
  ).data;
  const draftKey = `knowra:note-draft:v1:${JSON.stringify([space.id, note.id])}`;
  await page.evaluate(
    key =>
      sessionStorage.setItem(key, JSON.stringify({ markdown: '旧资料库未保存草稿', baseMarkdown: '备份中的正文' })),
    draftKey
  );
  await page.reload();
  await openLocalSync(page, /本地资料.*连接云端/);
  await page.getByRole('button', { name: '本机备份与恢复', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '本机备份与恢复' })).toBeVisible();
  await expect(page.getByText('还没有本机备份。先创建一个备份，再从这里检查和恢复。')).toBeVisible();
  await page.getByRole('button', { name: '创建本机备份', exact: true }).click();
  await expect(page.getByText(/备份已保存：/)).toBeVisible();
  const backupId = await page.getByRole('button', { name: /选择备份/ }).textContent();
  assert(backupId);
  const update = await page.request.patch(`${runtime.origin}/api/knowledge/notes/${note.id}`, {
    data: { rawMarkdown: '稍后的正文', expectedUpdatedAt: note.updatedAt }
  });
  assert.equal(update.status(), 200);
  await page.getByRole('button', { name: '检查所选备份' }).click();
  await expect(page.getByRole('heading', { name: '完整性检查通过' })).toBeVisible();
  await expect(page.getByText(/另保留 1 份恢复草稿/)).toBeVisible();
  const restore = page.getByRole('button', { name: '确认恢复所选备份' });
  await expect(restore).toBeDisabled();
  await page
    .getByRole('checkbox', { name: '我确认使用所选备份恢复整个本机资料库' })
    .locator('xpath=ancestor::label')
    .click();
  await expect(restore).toBeEnabled();
  await page.screenshot({ path: '/tmp/knowra-backup-restore-qa.png' });
  await restore.click();
  await expect(page.getByText(/备份已恢复。重新加载后使用恢复的资料/)).toBeVisible();
  assert.equal(runtime.store.state.notes.find(item => item.id === note.id).rawMarkdown, '备份中的正文');
  await page.getByRole('button', { name: '重新加载已恢复资料' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const pageContent = await page.evaluate(
    async noteId => (await (await fetch(`/api/knowledge/notes/${noteId}`)).json()).data.rawMarkdown,
    note.id
  );
  assert.equal(pageContent, '备份中的正文');
  // 原生 img 不经过 fetch 包装，恢复后的资源仍必须可读。
  const loaded = await page.evaluate(
    id =>
      new Promise(resolve => {
        const image = new Image();
        image.onload = () => resolve(true);
        image.onerror = () => resolve(false);
        image.src = `/api/storage/attachments/${id}/content`;
      }),
    attachment.id
  );
  assert.equal(loaded, true);
  await page.goto(`${runtime.origin}/#/materials/notes/${note.id}`);
  await expect(page.getByText('备份中的正文', { exact: true })).toBeVisible();
  // 超过正文自动保存防抖窗口，旧作用域草稿不得回写新资料集。
  await page.waitForTimeout(1000);
  assert.equal(runtime.store.state.notes.find(item => item.id === note.id).rawMarkdown, '备份中的正文');
  assert.match(await page.evaluate(key => sessionStorage.getItem(key), draftKey), /旧资料库未保存草稿/);
  const datasetId = runtime.store.getStatus().datasetId;
  await runtime.close();
  runtime = await startLocalRuntime(options);
  await page.goto(runtime.launchUrl);
  assert.equal(runtime.store.getStatus().datasetId, datasetId);
  await openLocalSync(page, /本地资料.*连接云端/);
  await page.getByRole('button', { name: '本机备份与恢复', exact: true }).click();
  await expect(page.getByRole('button', { name: /选择备份/ })).toBeVisible();
  await page.getByRole('button', { name: /选择备份/ }).click();
  await expect(page.getByRole('option', { name: /恢复前保护/ })).toBeVisible();
  const contentAfterRestart = await page.evaluate(
    async noteId => (await (await fetch(`/api/knowledge/notes/${noteId}`)).json()).data.rawMarkdown,
    note.id
  );
  assert.equal(contentAfterRestart, '备份中的正文');
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { NoteVersion } from '../../../api/src/modules/knowledge/domain/note-version.ts';
import { startLocalRuntime } from '../../src/runtime-server.mjs';

test('真实页面：历史摘要分页、差异对比、恢复和另存后持久化回读', { timeout: 60000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-history-e2e-'));
  const runtime = await startLocalRuntime({
    dataDirectory: directory,
    distRoot: fileURLToPath(new URL('../../../web/dist/', import.meta.url))
  });
  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await runtime.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(runtime.launchUrl);
  const api = page.request;
  const space = (await (await api.post(`${runtime.origin}/api/knowledge/spaces/default`, { data: {} })).json()).data;
  const historyStart = Date.now() - 22 * 11 * 60000;
  const note = (
    await (
      await api.post(`${runtime.origin}/api/knowledge/notes`, {
        data: {
          spaceId: space.id,
          title: '版本历史验收',
          rawMarkdown: '历史第0版',
          createdAt: new Date(historyStart).toISOString(),
          updatedAt: new Date(historyStart).toISOString()
        }
      })
    ).json()
  ).data;
  // 每 11 分钟一个恢复点：20 个普通点加创建基线和当前版本，仍可验证跨页访问。
  runtime.store.runTransaction(() => {
    for (let index = 1; index <= 21; index++)
      runtime.store.state.noteVersions.push(
        new NoteVersion({
          id: `history-fixture-${index}`,
          noteId: note.id,
          content: `历史第${index}版`,
          createdAt: new Date(historyStart + index * 11 * 60000).toISOString()
        })
      );
  });
  const restored = await api.patch(`${runtime.origin}/api/knowledge/notes/${note.id}`, {
    data: {
      rawMarkdown: '历史第5版',
      expectedUpdatedAt: note.updatedAt,
      baseMarkdown: note.rawMarkdown
    }
  });
  assert.equal(restored.status(), 200);
  const summary = (await (await api.get(`${runtime.origin}/api/knowledge/notes/${note.id}/versions?limit=20`)).json())
    .data;
  assert.equal(summary.items.length, 20);
  assert.equal(summary.total, 22);
  assert(summary.items.every(item => !Object.hasOwn(item, 'content')));
  assert.notEqual(summary.currentVersionId, summary.items[0].id);
  await page.goto('about:blank');
  await page.goto(`${runtime.origin}/#/materials/notes/${note.id}`);
  const editor = page.locator('.ProseMirror');
  await expect(editor).toContainText('历史第5版');
  if (!(await page.getByRole('tab', { name: '记录', exact: true }).isVisible()))
    await page.getByRole('button', { name: '切换文档检查器' }).click();
  await page.getByRole('tab', { name: '记录', exact: true }).click();
  const panel = page.getByRole('region', { name: '历史记录', exact: true });
  await expect(panel).toContainText('22 条历史记录');
  await panel.getByRole('button', { name: '加载更早记录' }).click();
  await expect(panel.getByRole('button', { name: '加载更早记录' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /^当前正文/ })).toBeVisible();
  await panel
    .getByRole('button', { name: /^历史正文/ })
    .first()
    .click();
  await expect(panel.getByRole('article', { name: '版本正文预览' })).toContainText('历史第21版');
  await panel.getByRole('button', { name: '与当前正文对比' }).click();
  await expect(panel.locator('[data-diff="removed"]')).toContainText('历史第21版');
  await expect(panel.locator('[data-diff="added"]')).toContainText('历史第5版');
  if (process.env.KNOWRA_E2E_OUTPUT) {
    fs.mkdirSync(process.env.KNOWRA_E2E_OUTPUT, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.KNOWRA_E2E_OUTPUT, 'version-history-diff.png'),
      animations: 'disabled'
    });
  }
  await panel.getByRole('button', { name: '恢复此版本' }).click();
  await page.getByRole('dialog', { name: '恢复历史正文' }).getByRole('button', { name: '确认恢复' }).click();
  await expect(editor).toContainText('历史第21版');
  await expect
    .poll(async () =>
      (await (await api.get(`${runtime.origin}/api/knowledge/notes/${note.id}`)).json()).data.rawMarkdown.trim()
    )
    .toBe('历史第21版');
  await panel.getByRole('button', { name: '另存为新笔记' }).click();
  await expect.poll(() => runtime.store.state.notes.length).toBe(2);
  const savedCopy = runtime.store.state.notes.find(item => item.id !== note.id);
  assert.equal(savedCopy.rawMarkdown.trim(), '历史第21版');
  assert.equal(savedCopy.folderId, note.folderId);
  await page.reload();
  await expect(editor).toContainText('历史第21版');
  const retained = (await (await api.get(`${runtime.origin}/api/knowledge/notes/${note.id}/versions`)).json()).data;
  assert(retained.some(item => item.content === '历史第5版'));
  assert.deepEqual(errors, []);
});

test('真实页面：恢复 A 后继续自动保存 C，恢复前 B 仍可从历史中找回', { timeout: 60000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-restore-checkpoint-e2e-'));
  const runtime = await startLocalRuntime({
    dataDirectory: directory,
    distRoot: fileURLToPath(new URL('../../../web/dist/', import.meta.url))
  });
  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await runtime.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(runtime.launchUrl);
  const api = page.request;
  const space = (await (await api.post(`${runtime.origin}/api/knowledge/spaces/default`, { data: {} })).json()).data;
  const note = (
    await (
      await api.post(`${runtime.origin}/api/knowledge/notes`, {
        data: { spaceId: space.id, title: '恢复检查点', rawMarkdown: '初始正文A' }
      })
    ).json()
  ).data;
  assert.equal(
    (
      await api.patch(`${runtime.origin}/api/knowledge/notes/${note.id}`, {
        data: { rawMarkdown: '恢复前正文B', expectedUpdatedAt: note.updatedAt }
      })
    ).status(),
    200
  );
  await page.goto('about:blank');
  await page.goto(`${runtime.origin}/#/materials/notes/${note.id}`);
  const editor = page.locator('.ProseMirror');
  await expect(editor).toContainText('恢复前正文B');
  if (!(await page.getByRole('tab', { name: '记录', exact: true }).isVisible()))
    await page.getByRole('button', { name: '切换文档检查器' }).click();
  await page.getByRole('tab', { name: '记录', exact: true }).click();
  const panel = page.getByRole('region', { name: '历史记录', exact: true });
  await panel.locator('summary').first().click();
  // 编辑器可能规范化换行，所以按正文找到 A，不能假定第一条非当前版本就是 A。
  const rows = panel.getByRole('button', { name: /^历史正文/ });
  for (let i = 0; i < (await rows.count()); i++) {
    await rows.nth(i).click();
    await expect(panel.getByRole('article', { name: '版本正文预览' })).toBeVisible();
    if ((await panel.getByRole('article', { name: '版本正文预览' }).textContent()).includes('初始正文A')) break;
  }
  await expect(panel.getByRole('article', { name: '版本正文预览' })).toContainText('初始正文A');
  await panel.getByRole('button', { name: '恢复此版本' }).click();
  await page.getByRole('dialog', { name: '恢复历史正文' }).getByRole('button', { name: '确认恢复' }).click();
  await expect(editor).toContainText('初始正文A');
  await expect
    .poll(async () =>
      (await (await api.get(`${runtime.origin}/api/knowledge/notes/${note.id}`)).json()).data.rawMarkdown.trim()
    )
    .toBe('初始正文A');
  await editor.fill('后续正文C');
  await expect
    .poll(async () =>
      (await (await api.get(`${runtime.origin}/api/knowledge/notes/${note.id}`)).json()).data.rawMarkdown.trim()
    )
    .toBe('后续正文C');
  await page.reload();
  await expect(editor).toContainText('后续正文C');
  const versions = (await (await api.get(`${runtime.origin}/api/knowledge/notes/${note.id}/versions`)).json()).data;
  assert(
    versions.some(version => version.content.trim() === '恢复前正文B'),
    '恢复前正文仍持久保留'
  );
});

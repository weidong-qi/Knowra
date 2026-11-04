import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { _electron as electron, expect } from '@playwright/test';
import { executablePath } from './packaged-app-path.mjs';
import { closeTestApplication, launchTestApplication } from './app-lifecycle.mjs';

test('打包应用独立启动，隔离资料库正文在立即退出后落盘并可重启', { timeout: 60000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-mac-smoke-'));
  let app;
  t.after(async () => { await closeTestApplication(app); fs.rmSync(directory, { recursive: true, force: true }); });
  const launch = async () => launchTestApplication(electron, { executablePath, env: { ...process.env, KNOWRA_DESKTOP_SMOKE_DIR: directory }, timeout: 20000 });
  app = await launch();
  let page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect.poll(() => fs.existsSync(path.join(directory, 'ready.json'))).toBe(true);
  t.diagnostic(JSON.stringify(JSON.parse(fs.readFileSync(path.join(directory, 'ready.json')))));
  const result = await page.evaluate(async () => {
    const space = (await (await fetch('/api/knowledge/spaces/default', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()).data;
    return (await (await fetch('/api/knowledge/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spaceId: space.id, title: '打包工程检查', rawMarkdown: '原文' }) })).json()).data;
  });
  assert(result.id);
  await page.reload();
  await page.getByRole('list', { name: '最近编辑', exact: true }).getByRole('button', { name: '继续编辑 打包工程检查', exact: true }).click();
  const editor = page.locator('.ProseMirror');
  await expect(editor).toContainText('原文');
  // 模拟同步/另一端只改元数据，让已打开编辑器的时间戳落后，正文基线保持一致。
  await page.evaluate(async (id) => {
    const response = await fetch(`/api/knowledge/notes/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '元数据已更新' })
    });
    if (!response.ok) throw new Error('元数据更新失败');
  }, result.id);
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText(' 退出前未等防抖的中文');
  const closed = app.waitForEvent('close');
  await app.evaluate(({ app: nativeApp }) => { nativeApp.quit(); });
  await closed;
  app = null;
  const db = new DatabaseSync(path.join(directory, 'offline/local.sqlite'), { readOnly: true });
  const row = db.prepare("SELECT payload FROM entities WHERE collection = 'notes' AND id = ?").get(result.id);
  assert(JSON.parse(row.payload).rawMarkdown.includes('退出前未等防抖的中文'));
  assert.equal(JSON.parse(row.payload).title, '元数据已更新');
  db.close();
  app = await launch();
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.goto(`${new URL(page.url()).origin}/#/materials/notes/${result.id}`);
  await expect(page.locator('.ProseMirror')).toContainText('退出前未等防抖的中文');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  const finalClosed = app.waitForEvent('close');
  await app.evaluate(({ app: nativeApp }) => { nativeApp.quit(); });
  await finalClosed; app = null;
});

test('保存失败时草稿落盘后才能退出，重启可恢复并再次正常保存', { timeout: 90000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-recovery-smoke-'));
  let app;
  t.after(async () => { await closeTestApplication(app); fs.rmSync(directory, { recursive: true, force: true }); });
  const launch = () => launchTestApplication(electron, { executablePath, env: { ...process.env, KNOWRA_DESKTOP_SMOKE_DIR: directory }, timeout: 20000 });
  app = await launch();
  let page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const note = await page.evaluate(async () => {
    const space = (await (await fetch('/api/knowledge/spaces/default', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()).data;
    return (await (await fetch('/api/knowledge/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spaceId: space.id, title: '恢复测试', rawMarkdown: '原文' }) })).json()).data;
  });
  await page.reload();
  await page.getByRole('list', { name: '最近编辑', exact: true }).getByRole('button', { name: '继续编辑 恢复测试', exact: true }).click();
  await expect(page.locator('.ProseMirror')).toContainText('原文');
  await page.route(`**/api/knowledge/notes/${note.id}`, async route => {
    if (route.request().method() === 'PATCH') await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL_SERVER_ERROR', message: '测试保存失败' } }) });
    else await route.continue();
  });
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText(' 必须恢复的正文');
  await expect(page.getByRole('alert')).toContainText('测试保存失败');
  const recoveryPath = path.join(directory, 'offline/recovery-drafts.json');
  await expect.poll(() => fs.existsSync(recoveryPath) && fs.readFileSync(recoveryPath, 'utf8').includes('必须恢复的正文')).toBeTruthy();
  const preserved = fs.readFileSync(recoveryPath, 'utf8');
  // 损坏的恢复文件不能被覆盖，选择保留草稿退出也必须失败。
  fs.writeFileSync(recoveryPath, 'broken');
  await app.evaluate(({ dialog, app: nativeApp }) => {
    globalThis.recoveryDialogCount = 0;
    dialog.showMessageBox = async () => ({ response: ++globalThis.recoveryDialogCount === 1 ? 2 : 0 });
    nativeApp.quit();
  });
  await expect.poll(() => app.evaluate(() => globalThis.recoveryDialogCount)).toBe(2);
  assert.equal(fs.readFileSync(recoveryPath, 'utf8'), 'broken');
  assert.equal(app.windows().length, 1);
  fs.writeFileSync(recoveryPath, preserved);
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 2 }); });
  const closed = app.waitForEvent('close');
  await app.evaluate(({ app: nativeApp }) => nativeApp.quit());
  await closed; app = null;
  assert(fs.readFileSync(recoveryPath, 'utf8').includes('必须恢复的正文'));
  const db = new DatabaseSync(path.join(directory, 'offline/local.sqlite'), { readOnly: true });
  assert.equal(JSON.parse(db.prepare("SELECT payload FROM entities WHERE collection='notes' AND id=?").get(note.id).payload).rawMarkdown, '原文');
  db.close();
  app = await launch(); page = await app.firstWindow();
  await page.getByRole('button', { name: '恢复：恢复测试', exact: true }).click();
  await expect(page.locator('.ProseMirror')).toContainText('必须恢复的正文');
  const finalClosed = app.waitForEvent('close');
  await app.evaluate(({ app: nativeApp }) => nativeApp.quit());
  await finalClosed; app = null;
  assert.deepEqual(JSON.parse(fs.readFileSync(recoveryPath, 'utf8')).drafts, {});
  const saved = new DatabaseSync(path.join(directory, 'offline/local.sqlite'), { readOnly: true });
  assert(JSON.parse(saved.prepare("SELECT payload FROM entities WHERE collection='notes' AND id=?").get(note.id).payload).rawMarkdown.includes('必须恢复的正文'));
  saved.close();
});

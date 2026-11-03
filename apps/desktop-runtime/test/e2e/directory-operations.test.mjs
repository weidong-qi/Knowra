import { withPageFailureDiagnostics } from '../fixtures/page-failure-diagnostics.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { startLocalRuntime } from '../../src/runtime-server.mjs';

test('真实页面：根目录和空白菜单、新建下拉、移动笔记与文件夹并回读', { timeout: 60000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-directory-e2e-'));
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
  await withPageFailureDiagnostics(page, async () => {
    page.setDefaultTimeout(10000);
    await page.goto(runtime.launchUrl);
    const spaceResponse = await page.request.post(`${runtime.origin}/api/knowledge/spaces/default`, { data: {} });
    assert.equal(spaceResponse.ok(), true, `目录夹具创建空间失败：HTTP ${spaceResponse.status()}`);
    const space = (await spaceResponse.json()).data;
    const parentResponse = await page.request.post(`${runtime.origin}/api/knowledge/folders`, {
      data: { spaceId: space.id, name: '目标目录' }
    });
    assert.equal(parentResponse.ok(), true, `目录夹具创建目标文件夹失败：HTTP ${parentResponse.status()}`);
    const parent = (await parentResponse.json()).data;
    const materialsUrl = `${runtime.origin}/#/materials?scope=root`;
    await page.goto(materialsUrl);
    await expect(page).toHaveURL(materialsUrl, { timeout: 10000 });
    const root = page.getByRole('button', { name: /^笔记库\s*\d+/ });
    await expect(root).toBeVisible({ timeout: 10000 });
    await page.reload();
    await expect(page).toHaveURL(materialsUrl, { timeout: 10000 });
    await page.screenshot({ path: '/tmp/knowra-directory-qa.png' });
    await root.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '新建文件夹', exact: true }).click();
    await page.getByRole('textbox', { name: '文件夹名称' }).fill('根目录创建');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await root.click();
    // 索引空白背景菜单。
    const content = page.getByTestId('notes-index-scroll');
    await content.click({ button: 'right', position: { x: 5, y: 5 } });
    await page.getByRole('menuitem', { name: '新建笔记', exact: true }).click();
    await page.getByRole('textbox', { name: '笔记名称' }).fill('待移动笔记');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // 右上新建下拉可选择文件夹。
    const index = page.getByRole('article', { name: '笔记索引', exact: true });
    const create = index
      .getByRole('toolbar', { name: '笔记索引工具栏', exact: true })
      .getByRole('button', { name: '新建', exact: true });
    await expect(create).toBeVisible();
    await create.click();
    const createMenu = page.getByRole('menu', { name: '新建', exact: true });
    for (const name of ['新建笔记', '新建文件夹', '导入 Markdown']) {
      await expect(createMenu.getByRole('menuitem', { name, exact: true })).toBeVisible();
      await expect(createMenu.getByRole('menuitem', { name, exact: true })).toBeEnabled();
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(create).toBeFocused();
    // 侧栏新建同样复用两个选项。
    await page
      .getByRole('complementary', { name: '笔记上下文导航' })
      .getByRole('button', { name: '新建', exact: true })
      .click();
    await expect(page.getByRole('menuitem', { name: '新建笔记', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    for (const [name, kind] of [
      ['待移动笔记', '笔记'],
      ['根目录创建', '文件夹']
    ]) {
      await content.getByRole('button', { name, exact: true }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: '移动到…', exact: true }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /目标目录/ })
        .click();
      if (kind === '文件夹') await expect(page.getByRole('option', { name: /根目录创建/ })).toHaveCount(0);
      await page.getByRole('option', { name: '笔记库 / 目标目录', exact: true }).click();
      await page.getByRole('button', { name: '移动', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    await page.reload();
    const snapshot = runtime.store.exportSnapshot().data;
    assert.equal(snapshot.notes.find(note => note.title === '待移动笔记').folderId, parent.id);
    const moved = snapshot.folders.find(folder => folder.name === '根目录创建');
    assert.equal(moved.parentId, parent.id);
    assert(moved.pathCache.startsWith(parent.pathCache + '/'));
    const cycle = await page.request.patch(`${runtime.origin}/api/knowledge/folders/${parent.id}`, {
      data: { parentId: moved.id }
    });
    assert.equal(cycle.status(), 409);
    // 根目录菜单即使当前进入子目录也必须创建在根目录。
    await content.getByRole('button', { name: '目标目录', exact: true }).click();
    await content.getByRole('button', { name: '待移动笔记', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: '移动到…', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /目标目录/ })
      .click();
    await page.getByRole('option', { name: '笔记库（根目录）', exact: true }).click();
    await page.getByRole('button', { name: '移动', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const returnedNote = runtime.store.state.notes.find(note => note.title === '待移动笔记');
    assert.equal(returnedNote.folderId, null);
    assert.equal(runtime.store.state.noteVersions.filter(version => version.noteId === returnedNote.id).length, 1);
    await root.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '新建笔记', exact: true }).click();
    await page.getByRole('textbox', { name: '笔记名称' }).fill('始终在根目录');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    assert.equal(runtime.store.state.notes.find(note => note.title === '始终在根目录').folderId, null);
  });
});

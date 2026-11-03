import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { startLocalRuntime } from '../../src/runtime-server.mjs';
import { extractNoteLinks } from '@study-accelerator/content-anchor';

// 偶发失败的真实原因：goto(仅 hash 不同的地址) 是同文档导航，紧接着 reload() 在浏览器进程里可能仍按旧的已提交历史项（首页 '/'）重载，
// 重载后地址里的 hash 丢失、页面停在首页，等不到 data-editor-ready。机器越快越容易出现。
// 所以需要“全新加载某个 hash 路由”时，用先到 about:blank 再整页导航，不依赖 goto 加 reload 的先后。
async function openFresh(page, url) {
  await page.goto('about:blank');
  await page.goto(url);
}
async function editorReady(page) {
  try {
    await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  } catch (error) {
    const state = await page
      .evaluate(() => ({
        hash: location.hash,
        title: document.title,
        text: document.body.innerText.slice(0, 200),
        readyState: document.readyState
      }))
      .catch(failure => ({ evaluateFailed: String(failure) }));
    throw new Error(`编辑器未就绪：${page.url()} ${JSON.stringify(state)}`, { cause: error });
  }
}

test('真实SQLite页面：恢复冲突来源草稿时不在不同版本中定位引用', { timeout: 45000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-link-draft-version-'));
  const runtime = await startLocalRuntime({
    dataDirectory: directory,
    distRoot: fileURLToPath(new URL('../../../web/dist/', import.meta.url))
  });
  const browser = await chromium.launch({ executablePath: process.env.KNOWRA_TEST_BROWSER_EXECUTABLE });
  t.after(async () => {
    await browser.close();
    await runtime.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const page = await browser.newPage();
  await page.goto(runtime.launchUrl);
  const post = async (pathname, data) => {
    const response = await page.request.post(runtime.origin + pathname, { data });
    assert.equal(response.ok(), true, await response.text());
    return (await response.json()).data;
  };
  const space = await post('/api/knowledge/spaces/default', {});
  const target = await post('/api/knowledge/notes', {
    id: 'version-target',
    spaceId: space.id,
    title: '版本目标',
    rawMarkdown: '目标正文'
  });
  const url = 'knowra://note/version-target#ref=ref-version-guard';
  const remote = `Remote version [Display](${url})`;
  const local = `Local recovered version [Display](${url})`;
  const source = await post('/api/knowledge/notes', {
    id: 'version-source',
    spaceId: space.id,
    title: '版本来源',
    rawMarkdown: remote
  });
  await openFresh(page, `${runtime.origin}/#/materials/notes/${target.id}`);
  await editorReady(page);
  await page.evaluate(
    ({ spaceId, sourceId, local, url }) => {
      sessionStorage.setItem(
        `knowra:note-draft:v1:${JSON.stringify([spaceId, sourceId])}`,
        JSON.stringify({
          markdown: local,
          baseMarkdown: `Base version [Display](${url})`,
          baseUpdatedAt: '2020-01-01T00:00:00.000Z',
          conflict: '合成恢复草稿冲突'
        })
      );
    },
    { spaceId: space.id, sourceId: source.id, local, url }
  );
  if (!(await page.getByRole('tab', { name: '链接', exact: true }).isVisible()))
    await page.getByRole('button', { name: '切换文档检查器' }).click();
  await page.getByRole('tab', { name: '链接', exact: true }).click();
  await page.getByRole('button', { name: 'Remote versionDisplay', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`notes/${source.id}$`));
  await editorReady(page);
  await expect(page.locator('.ProseMirror')).toContainText('Local recovered version');
  assert.notEqual(await page.evaluate(() => window.getSelection()?.toString()), 'Display');
  await expect(page.getByText('引用位置或来源版本已变化，已打开来源笔记', { exact: true })).toBeVisible();
  const persisted = (await (await page.request.get(`${runtime.origin}/api/knowledge/notes/${source.id}`)).json()).data;
  assert.equal(persisted.rawMarkdown, remote);
});

test('真实页面：已移除或重复引用位置安全回退；保存冲突保留来源草稿', { timeout: 60000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-link-navigation-e2e-'));
  const runtime = await startLocalRuntime({
    dataDirectory: directory,
    distRoot: fileURLToPath(new URL('../../../web/dist/', import.meta.url))
  });
  const browser = await chromium.launch({ executablePath: process.env.KNOWRA_TEST_BROWSER_EXECUTABLE });
  t.after(async () => {
    await browser.close();
    await runtime.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const page = await browser.newPage();
  await page.goto(runtime.launchUrl);
  const post = async (pathname, data) => {
    const response = await page.request.post(runtime.origin + pathname, { data });
    assert.equal(response.ok(), true);
    return (await response.json()).data;
  };
  const space = await post('/api/knowledge/spaces/default', {});
  const target = await post('/api/knowledge/notes', {
    id: 'fallback-target',
    spaceId: space.id,
    title: '回退目标',
    rawMarkdown: '目标正文'
  });
  const firstUrl = 'knowra://note/fallback-target#ref=ref-original';
  const duplicateUrl = 'knowra://note/fallback-target#ref=ref-duplicate';
  const source = await post('/api/knowledge/notes', {
    id: 'fallback-source',
    spaceId: space.id,
    title: '移除来源',
    rawMarkdown: `[原引用](${firstUrl}) 已移除位置`
  });
  const duplicate = await post('/api/knowledge/notes', {
    id: 'fallback-duplicate',
    spaceId: space.id,
    title: '重复来源',
    rawMarkdown: `[相同文字](${duplicateUrl}) 第一副本\n\n[相同文字](${duplicateUrl}) 第二副本`
  });
  await openFresh(page, `${runtime.origin}/#/materials/notes/${target.id}`);
  const ready = () => editorReady(page);
  await ready();
  if (!(await page.getByRole('tab', { name: '链接', exact: true }).isVisible()))
    await page.getByRole('button', { name: '切换文档检查器' }).click();
  await page.getByRole('tab', { name: '链接', exact: true }).click();
  await expect(page.getByRole('button', { name: '原引用已移除位置', exact: true })).toBeVisible();
  const sourceBefore = (await (await page.request.get(`${runtime.origin}/api/knowledge/notes/${source.id}`)).json())
    .data;
  const changed = await page.request.patch(`${runtime.origin}/api/knowledge/notes/${source.id}`, {
    data: { rawMarkdown: '引用已经移除的普通正文', expectedUpdatedAt: sourceBefore.updatedAt }
  });
  assert.equal(changed.ok(), true, await changed.text());
  await page.getByRole('button', { name: '原引用已移除位置', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`notes/${source.id}$`));
  await ready();
  await expect(page.locator('.ProseMirror')).toContainText('引用已经移除');
  await expect(page.getByText('引用位置或来源版本已变化，已打开来源笔记', { exact: true }).first()).toBeVisible();
  await page.goBack();
  await ready();
  await page.getByRole('tab', { name: '链接', exact: true }).click();
  await page.getByRole('button', { name: '相同文字第二副本', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`notes/${duplicate.id}$`));
  await ready();
  await expect(page.getByText('引用位置或来源版本已变化，已打开来源笔记', { exact: true }).first()).toBeVisible();
  assert.notEqual(await page.evaluate(() => window.getSelection()?.toString()), '相同文字');
  const duplicateBefore = (
    await (await page.request.get(`${runtime.origin}/api/knowledge/notes/${duplicate.id}`)).json()
  ).data;
  const remote = await page.request.patch(`${runtime.origin}/api/knowledge/notes/${duplicate.id}`, {
    data: { rawMarkdown: '后台新正文', expectedUpdatedAt: duplicateBefore.updatedAt }
  });
  assert.equal(remote.ok(), true, await remote.text());
  const editor = page.locator('.ProseMirror');
  await editor.locator('p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.insertText('未保存草稿');
  await editor.locator('a[data-note-link]').first().click();
  await expect(page.getByText('正文尚未保存', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`notes/${duplicate.id}$`));
  await expect(editor).toContainText('未保存草稿');
  const actual = (await (await page.request.get(`${runtime.origin}/api/knowledge/notes/${duplicate.id}`)).json()).data;
  assert.equal(actual.rawMarkdown, '后台新正文');
});

test('真实SQLite生产页面：选字搜索创建、取消、重开、正文跳转与逐处反链定位及删除恢复', { timeout: 90000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-note-links-e2e-'));
  let runtime = await startLocalRuntime({
    dataDirectory: directory,
    distRoot: fileURLToPath(new URL('../../../web/dist/', import.meta.url))
  });
  const browser = await chromium.launch({ executablePath: process.env.KNOWRA_TEST_BROWSER_EXECUTABLE });
  t.after(async () => {
    await browser.close();
    await runtime.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const context = await browser.newContext();
  await context.route('**/*', route =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
  );
  let page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(runtime.launchUrl);
  let api = context.request;
  const post = async (pathname, data) => {
    const response = await api.post(`${runtime.origin}${pathname}`, { data });
    assert.equal(response.ok(), true, await response.text());
    return (await response.json()).data;
  };
  const space = await post('/api/knowledge/spaces/default', {});
  const target = await post('/api/knowledge/notes', {
    id: 'page-link-target',
    spaceId: space.id,
    title: '合成链接目标',
    rawMarkdown: '目标正文',
    aiVisibility: 'private'
  });
  const source = await post('/api/knowledge/notes', {
    id: 'page-link-source',
    spaceId: space.id,
    title: '合成引用来源',
    rawMarkdown: '第一处文字\n\n第二处文字\n\n取消处文字'
  });
  const noteContent = async () =>
    (await (await api.get(`${runtime.origin}/api/knowledge/notes/${source.id}`)).json()).data.rawMarkdown;
  await openFresh(page, `${runtime.origin}/#/materials/notes/${source.id}`);
  const editor = () => page.locator('.ProseMirror');
  const ready = () => editorReady(page);
  const selectParagraph = async label => {
    await ready();
    await editor()
      .locator('p')
      .filter({ hasText: label })
      .evaluate(element => {
        element.closest('[contenteditable]').focus();
        const range = document.createRange();
        range.selectNodeContents(element);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
  };
  const dialog = () => page.getByRole('dialog', { name: '插入笔记链接', exact: true });
  await selectParagraph('取消处文字');
  await page.getByRole('toolbar', { name: '选区工具' }).getByRole('button', { name: '内部链接', exact: true }).click();
  await expect(dialog()).toBeVisible();
  await dialog().getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(extractNoteLinks(await noteContent()).occurrences.length, 0);
  await selectParagraph('第一处文字');
  await page.getByRole('button', { name: '标记重点（普通）', exact: true }).click();
  const readAnnotations = async () =>
    (
      await (
        await api.get(`${runtime.origin}/api/knowledge/annotations?noteId=${source.id}&spaceId=${space.id}`)
      ).json()
    ).data;
  await expect.poll(async () => (await readAnnotations()).length).toBe(1);
  const annotation = (await readAnnotations())[0];
  for (const label of ['第一处文字', '第二处文字']) {
    await selectParagraph(label);
    await page
      .getByRole('toolbar', { name: '选区工具' })
      .getByRole('button', { name: '内部链接', exact: true })
      .click();
    await dialog().getByRole('searchbox', { name: '搜索当前空间笔记' }).fill('合成链接目标');
    await dialog().getByRole('button', { name: '合成链接目标 · 未整理', exact: true }).click();
    await dialog().getByRole('button', { name: '确认', exact: true }).click();
    await expect(dialog()).toHaveCount(0);
    try {
      await expect(editor().locator('a[data-note-link]').filter({ hasText: label })).toHaveCount(1);
    } catch (error) {
      console.error('合成链接诊断', await editor().innerHTML(), await noteContent());
      throw error;
    }
  }
  const saved = extractNoteLinks(await noteContent()).occurrences;
  assert.equal(saved.length, 2);
  assert.notEqual(saved[0].occurrenceId, saved[1].occurrenceId);
  const retained = (await readAnnotations())[0];
  assert.equal(retained.id, annotation.id);
  assert.equal(retained.quoteText, '第一处文字');
  assert.equal(retained.anchorStatus, 'resolved');
  // 正文链接跳整篇目标；用户自有私密设置不妨碍手动导航，也不授予AI读取。
  await editor().locator('a').filter({ hasText: '第二处文字' }).click();
  await expect(page).toHaveURL(new RegExp(`notes/${target.id}$`));
  await ready();
  if (!(await page.getByRole('tab', { name: '链接', exact: true }).isVisible()))
    await page.getByRole('button', { name: '切换文档检查器' }).click();
  await page.getByRole('tab', { name: '链接', exact: true }).click();
  await expect(page.getByRole('button', { name: '第一处文字', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '第二处文字', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`notes/${source.id}$`));
  await ready();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('第二处文字');
  await page.reload();
  await ready();
  await expect(editor().locator('a[data-note-link]')).toHaveCount(2);
  const renamed = await api.patch(`${runtime.origin}/api/knowledge/notes/${target.id}`, {
    data: { title: '目标改名' }
  });
  assert.equal(renamed.ok(), true);
  await page.reload();
  await ready();
  await editor().locator('a').filter({ hasText: '第一处文字' }).click();
  await expect(page.getByRole('heading', { name: '目标改名', exact: true })).toBeVisible();
  await page.goBack();
  await ready();
  const deleted = await api.delete(`${runtime.origin}/api/knowledge/notes/${target.id}`);
  assert.equal(deleted.ok(), true);
  await page.reload();
  await ready();
  await expect(editor().locator('[data-note-link-deleted]')).toHaveCount(2);
  await editor().locator('a').first().click();
  await expect(page).toHaveURL(new RegExp(`notes/${source.id}$`));
  const restored = await api.post(`${runtime.origin}/api/knowledge/notes/${target.id}/restore`, { data: {} });
  assert.equal(restored.ok(), true);
  // 重启真实本地服务及浏览器会话，引用身份和两个位置仍来自持久化正文。
  await context.close();
  await runtime.close();
  runtime = await startLocalRuntime({
    dataDirectory: directory,
    distRoot: fileURLToPath(new URL('../../../web/dist/', import.meta.url))
  });
  const nextContext = await browser.newContext();
  page = await nextContext.newPage();
  api = nextContext.request;
  await page.goto(runtime.launchUrl);
  await page.goto(`${runtime.origin}/#/materials/notes/${source.id}`);
  await ready();
  await expect(editor().locator('a[data-note-link]')).toHaveCount(2);
  await expect(editor().locator('[data-note-link-deleted]')).toHaveCount(0);
  assert.deepEqual(
    extractNoteLinks(await noteContent()).occurrences.map(item => item.occurrenceId),
    saved.map(item => item.occurrenceId)
  );
  assert.deepEqual(errors, []);
});

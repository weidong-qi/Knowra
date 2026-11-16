import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { _electron as electron, expect } from '@playwright/test';
import { executablePath } from './packaged-app-path.mjs';
import { closeTestApplication, launchTestApplication } from './app-lifecycle.mjs';

test('打包应用知识草稿退出后恢复原候选 id；旧 CAS 冲突不会覆盖新知识且可再次恢复', { timeout: 90000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-packaged-knowledge-'));
  const recoveryPath = path.join(directory, 'offline/recovery-drafts.json');
  let app;
  // 仅失败清理使用测试专属子进程；成功路径始终走真实退出握手。
  t.after(async () => {
    await closeTestApplication(app);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const launch = () =>
    launchTestApplication(electron, {
      executablePath,
      env: { ...process.env, KNOWRA_DESKTOP_SMOKE_DIR: directory },
      timeout: 20000
    });
  const quit = async (recovery = false) => {
    if (recovery)
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({ response: 2 });
      });
    const closed = app.waitForEvent('close');
    await app.evaluate(({ app: nativeApp }) => nativeApp.quit());
    await closed;
    app = null;
  };
  const readDrafts = () => JSON.parse(fs.readFileSync(recoveryPath, 'utf8')).drafts;
  app = await launch();
  let page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.goto(`${new URL(page.url()).origin}/#/knowledge`);
  // 等待空库加载完成；此时工具栏和空态都有同名入口，按语义范围定位。
  await expect(
    page.getByRole('region', { name: '知识列表内容', exact: true }).getByText('还没有知识', { exact: true })
  ).toBeVisible();
  await page
    .getByRole('toolbar', { name: '知识库工具栏', exact: true })
    .getByRole('button', { name: '新建知识点', exact: true })
    .click();
  await page.getByRole('textbox', { name: '标题', exact: true }).fill('打包知识草稿');
  await page.getByRole('textbox', { name: '核心陈述', exact: true }).fill('退出前未提交的候选陈述');
  await expect
    .poll(
      () =>
        fs.existsSync(recoveryPath) &&
        Object.values(readDrafts()).some(draft => draft.value?.canonicalStatement === '退出前未提交的候选陈述')
    )
    .toBeTruthy();
  const [key, original] = Object.entries(readDrafts()).find(([key]) => key.startsWith('knowra:knowledge-draft:v1:'));
  const runtime = await page.evaluate(() => globalThis.knowraRuntime);
  assert(JSON.parse(key.slice('knowra:knowledge-draft:v1:'.length))[0].includes(runtime.datasetId));
  await quit(true);
  assert.equal(readDrafts()[key].candidateId, original.candidateId);
  const database = new DatabaseSync(path.join(directory, 'offline/local.sqlite'), { readOnly: true });
  assert.equal(
    database.prepare("SELECT count(*) AS count FROM entities WHERE collection = 'knowledgeItems'").get().count,
    0
  );
  database.close();

  app = await launch();
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('dialog', { name: '恢复草稿', exact: true })).toHaveCount(0);
  await page.goto(`${new URL(page.url()).origin}/#/knowledge`);
  await page.getByRole('button', { name: '恢复草稿：打包知识草稿', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '核心陈述', exact: true })).toHaveValue('退出前未提交的候选陈述');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '新建知识点', exact: true })).toHaveCount(0);
  await expect.poll(() => readDrafts()).toEqual({});
  const item = await page.evaluate(
    async id => (await (await fetch(`/api/knowledge/items/${id}`)).json()).data,
    original.candidateId
  );
  assert.equal(item.id, original.candidateId);
  assert.equal(item.reviewStatus, 'candidate');

  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('textbox', { name: '我的解释', exact: true }).fill('冲突仍要保留的输入');
  await page.evaluate(async item => {
    const response = await fetch(`/api/knowledge/items/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '另一端已修改', expectedUpdatedAt: item.updatedAt })
    });
    if (!response.ok) throw new Error(`无法建立并发修改：${response.status}`);
  }, item);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('本次输入已保留');
  await quit(true);
  assert.equal(readDrafts()[key].expectedUpdatedAt, item.updatedAt);

  app = await launch();
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.goto(`${new URL(page.url()).origin}/#/knowledge`);
  await page.getByRole('button', { name: '恢复草稿：打包知识草稿', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '我的解释', exact: true })).toHaveValue('冲突仍要保留的输入');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('本次输入已保留');
  const current = await page.evaluate(
    async id => (await (await fetch(`/api/knowledge/items/${id}`)).json()).data,
    item.id
  );
  assert.equal(current.title, '另一端已修改');
  assert.equal(current.userExplanation, '');
  await page
    .getByRole('dialog', { name: '编辑知识', exact: true })
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect.poll(() => readDrafts()).toEqual({});
  await quit();
});

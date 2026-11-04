import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect } from '@playwright/test';
import { executablePath } from './packaged-app-path.mjs';
import { closeTestApplication, launchTestApplication } from './app-lifecycle.mjs';

test('打包 Mac 模型设置经原生 IPC 保存、重启、保留、替换和移除，密钥仅加密落盘', { timeout: 120000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-packaged-ai-'));
  const filePath = path.join(directory, 'shell', 'ai-provider.json');
  const firstKey = 'knowra-packaged-synthetic-first-key';
  const replacementKey = 'knowra-packaged-synthetic-replacement-key';
  let app, page;
  t.after(async () => { await closeTestApplication(app); fs.rmSync(directory, { recursive: true, force: true }); });
  const launch = async () => {
    app = await launchTestApplication(electron, { executablePath, env: { ...process.env, KNOWRA_DESKTOP_SMOKE_DIR: directory }, timeout: 20000 });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: '账户与设置', exact: true }).click();
    await page.getByRole('menuitem', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: /模型接入/ }).click();
    await expect(page.getByRole('heading', { name: '模型接入', exact: true })).toBeVisible();
  };
  const assertEncrypted = async expected => {
    const contents = fs.readFileSync(filePath, 'utf8');
    const saved = JSON.parse(contents);
    assert.equal(contents.includes(firstKey), false);
    assert.equal(contents.includes(replacementKey), false);
    assert.equal(Object.hasOwn(saved, 'apiKey'), false);
    assert.equal(typeof saved.secret, 'string');
    assert.equal(saved.modelId, 'deepseek-flash');
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
    // 真正的 Electron safeStorage 在主进程验证；不把解密结果返回渲染器。
    assert.equal(await app.evaluate(({ safeStorage }, { encrypted, expected }) =>
      safeStorage.isEncryptionAvailable() && safeStorage.decryptString(Buffer.from(encrypted, 'base64')) === expected,
    { encrypted: saved.secret, expected }), true, '原生安全存储必须能解密测试密钥');
    const status = await page.evaluate(() => window.knowraDesktop.modelSettings('status'));
    assert.equal(status.configured, true);
    assert.equal(status.modelSupported, true);
    assert.deepEqual(status.supportedModelIds, ['deepseek-flash']);
    assert.equal(JSON.stringify(status).includes(firstKey), false);
    assert.equal(JSON.stringify(status).includes(replacementKey), false);
    assert.equal(Object.hasOwn(status, 'secret'), false);
    await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
    return contents;
  };

  await launch();
  assert.equal(await page.evaluate(() => typeof window.knowraDesktop?.modelSettings), 'function');
  assert.equal(await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable()), true, '验收机器须有可用的系统钥匙串，不能静默跳过加密验证');
  await expect(page.getByText('尚未配置', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '检查连接', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '保存配置', exact: true })).toBeDisabled();
  await page.getByLabel('API Key', { exact: true }).fill(firstKey);
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.getByText('配置已保存，尚未检查连接。', { exact: true })).toBeVisible();
  const original = await assertEncrypted(firstKey);

  await closeTestApplication(app);
  app = null;
  await launch();
  await expect(page.getByText('已配置 · deepseek-flash', { exact: true })).toBeVisible();
  assert.equal(await assertEncrypted(firstKey), original);
  await expect(page.getByText('当前配置尚无有效的连接检查结果。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '检查连接', exact: true })).toBeEnabled();
  // 全程不点击连接检查或发送 AI 任务；合成密钥绝不访问真实供应商。
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.getByText('配置已保存，尚未检查连接。', { exact: true })).toBeVisible();
  assert.equal(await assertEncrypted(firstKey), original, '空白保存应原样保留密钥和引用');

  await page.getByLabel('API Key', { exact: true }).fill(replacementKey);
  await expect(page.getByRole('button', { name: '检查连接', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  const replaceDialog = page.getByRole('dialog', { name: '替换已保存的密钥？', exact: true });
  await expect(replaceDialog).toBeVisible();
  await replaceDialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(replaceDialog).toBeHidden();
  assert.equal(fs.readFileSync(filePath, 'utf8'), original, '取消替换不得写入凭据');
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue(replacementKey);
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await replaceDialog.getByRole('button', { name: '确认替换', exact: true }).click();
  await expect(replaceDialog).toBeHidden();
  const replaced = await assertEncrypted(replacementKey);
  assert.notEqual(JSON.parse(replaced).secret, JSON.parse(original).secret);
  assert.notEqual(JSON.parse(replaced).credentialRef, JSON.parse(original).credentialRef);

  await page.getByRole('button', { name: '移除配置', exact: true }).click();
  const removeDialog = page.getByRole('dialog', { name: '移除已保存的密钥？', exact: true });
  await expect(removeDialog).toBeVisible();
  await removeDialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(removeDialog).toBeHidden();
  assert.equal(fs.readFileSync(filePath, 'utf8'), replaced, '取消移除不得删除凭据');
  await page.getByRole('button', { name: '移除配置', exact: true }).click();
  await removeDialog.getByRole('button', { name: '确认移除', exact: true }).click();
  await expect(removeDialog).toBeHidden();
  await expect(page.getByText('尚未配置', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '检查连接', exact: true })).toBeDisabled();
  assert.equal(fs.existsSync(filePath), false);
  const removedStatus = await page.evaluate(() => window.knowraDesktop.modelSettings('status'));
  assert.equal(removedStatus.configured, false);
  assert.equal(removedStatus.modelId, 'deepseek-flash');
});

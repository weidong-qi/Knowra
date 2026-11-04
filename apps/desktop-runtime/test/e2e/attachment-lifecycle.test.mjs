import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { NoteVersion } from '../../../api/src/modules/knowledge/domain/note-version.ts';
import { startLocalRuntime } from '../../src/runtime-server.mjs';

test('真实 V4 附件缺失核验、原文件恢复、删除预检与本机保留反馈', { timeout: 60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-attachment-page-'));
  const runtime = await startLocalRuntime({
    dataDirectory: root,
    distRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
    syncOptions: { autoSync: false }
  });
  const browser = await chromium.launch({
    ...(process.env.V4_BROWSER_CHANNEL === 'chrome' ? { channel: 'chrome' } : {})
  });
  t.after(async () => {
    await browser.close();
    await runtime.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const context = await browser.newContext();
  await context.route('**/*', route =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(runtime.launchUrl);
  const space = (
    await (await context.request.post(`${runtime.origin}/api/knowledge/spaces/default`, { data: {} })).json()
  ).data;
  const note = (
    await (
      await context.request.post(`${runtime.origin}/api/knowledge/notes`, {
        data: { spaceId: space.id, title: '附件页面验收', rawMarkdown: '正文无附件引用' }
      })
    ).json()
  ).data;
  await page.reload();
  await page
    .getByRole('list', { name: '最近编辑', exact: true })
    .getByRole('button', { name: '继续编辑 附件页面验收', exact: true })
    .click();
  await expect(page.locator('.ProseMirror')).toContainText('正文无附件引用');
  if (!(await page.getByRole('button', { name: '上传附件', exact: true }).isVisible()))
    await page.getByRole('button', { name: '切换文档检查器' }).click();
  await page
    .getByLabel('选择要上传的附件')
    .setInputFiles({ name: '原文件.txt', mimeType: 'text/plain', buffer: Buffer.from('original') });
  const target = page.getByRole('button', { name: '打开附件 原文件.txt', exact: true });
  await expect(target).toBeVisible();
  const attachment = (
    await (await context.request.get(`${runtime.origin}/api/storage/attachments?noteId=${note.id}`)).json()
  ).data[0];
  const file = path.join(root, 'uploads', `${attachment.id}-${attachment.fileName}`);
  fs.unlinkSync(file);
  await target.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '核验文件' }).click();
  await expect(target).toContainText('文件缺失');
  await page.getByRole('button', { name: '恢复原文件', exact: true }).scrollIntoViewIfNeeded();
  const output = process.env.KNOWRA_E2E_OUTPUT;
  if (output) {
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ animations: 'disabled', path: path.join(output, 'attachment-missing.png') });
  }
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: '恢复原文件', exact: true }).click()
  ]);
  await chooser.setFiles({ name: '原文件.txt', mimeType: 'text/plain', buffer: Buffer.from('original') });
  await expect(target).toContainText('可用');
  assert.equal(fs.readFileSync(file, 'utf8'), 'original');
  await page.getByRole('button', { name: '删除附件 原文件.txt' }).click();
  await expect(page.getByRole('button', { name: '删除附件', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '删除附件', exact: true }).click();
  await expect(page.getByText('附件记录已删除，本机副本按同步与恢复规则保留', { exact: true })).toBeVisible();
  assert(fs.existsSync(file));
  assert.equal(
    (await (await context.request.get(`${runtime.origin}/api/storage/attachments?noteId=${note.id}`)).json()).data
      .length,
    0
  );
  if (output)
    await page.screenshot({ animations: 'disabled', path: path.join(output, 'attachment-retained-local.png') });
  const historical = (
    await (
      await context.request.post(`${runtime.origin}/api/storage/attachments`, {
        data: { noteId: note.id, fileName: '历史附件.txt', contentBase64: Buffer.from('history').toString('base64') }
      })
    ).json()
  ).data;
  let baseline = (await (await context.request.get(`${runtime.origin}/api/knowledge/notes/${note.id}`)).json()).data;
  // 使用已导入的历史检查点，而非会被合并的瞬时自动保存中间版本。
  const historicalContent = `[历史附件](/api/storage/attachments/${historical.id.replace(/^a/, '%61')}/content#attachment=wrong)`;
  runtime.store.runTransaction(() =>
    runtime.store.state.noteVersions.push(
      new NoteVersion({
        id: 'attachment-history-fixture',
        noteId: note.id,
        content: historicalContent,
        createdAt: new Date(Date.now() - 20 * 60000).toISOString(),
        createdBy: 'import'
      })
    )
  );
  const first = await context.request.patch(`${runtime.origin}/api/knowledge/notes/${note.id}`, {
    data: { expectedUpdatedAt: baseline.updatedAt, rawMarkdown: historicalContent }
  });
  assert.equal(first.status(), 200);
  baseline = (await first.json()).data;
  const second = await context.request.patch(`${runtime.origin}/api/knowledge/notes/${note.id}`, {
    data: { expectedUpdatedAt: baseline.updatedAt, rawMarkdown: '已移除正文引用，历史仍保留' }
  });
  assert.equal(second.status(), 200);
  assert(
    runtime.store.state.noteVersions.some(
      version => version.noteId === note.id && version.content.includes(historical.id.replace(/^a/, '%61'))
    ),
    '先确认历史引用样本仍然存在'
  );
  await page.reload();
  if (!(await page.getByRole('button', { name: '上传附件', exact: true }).isVisible()))
    await page.getByRole('button', { name: '切换文档检查器' }).click();
  await expect(page.getByRole('button', { name: '打开附件 历史附件.txt' })).toBeVisible();
  await page.getByRole('button', { name: '删除附件 历史附件.txt' }).click();
  await expect(page.getByText('保留的资产仍引用此附件，暂时不能删除。')).toBeVisible();
  await expect(page.getByRole('button', { name: '删除附件', exact: true })).toBeDisabled();
  if (output)
    await page.screenshot({ animations: 'disabled', path: path.join(output, 'attachment-history-blocked.png') });
  assert.deepEqual(errors, []);
});
